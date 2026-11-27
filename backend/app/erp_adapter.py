"""Idempotent ERPNext Frappe REST integration for closed-loop Purchase Receipt posting."""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from app.models import PurchaseOrder, SKU


class ERPNextSyncError(RuntimeError):
    """Raised when external ERPNext synchronization fails."""


class ERPNextAdapter:
    """Real Frappe REST API client closing DockPilot commits into ERPNext Stock Ledger."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        api_secret: str,
        company: str = "VayuMech Receiving Sandbox",
        warehouse: str = "Dock 1 - VRS",
    ) -> None:
        self.base_url = base_url.strip().rstrip("/")
        self.api_key = api_key.strip()
        self.api_secret = api_secret.strip()
        self.company = company.strip()
        self.warehouse = warehouse.strip()

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key and self.api_secret)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"token {self.api_key}:{self.api_secret}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _client(self, timeout: float = 20.0) -> httpx.Client:
        return httpx.Client(base_url=self.base_url, headers=self._headers(), timeout=timeout)

    def health_check(self) -> dict[str, Any]:
        if not self.configured:
            return {"configured": False, "reachable": False, "base_url": self.base_url or None}
        t0 = time.monotonic()
        try:
            with self._client(timeout=6.0) as client:
                r = client.get("/api/method/ping")
                r.raise_for_status()
                return {
                    "configured": True,
                    "reachable": True,
                    "base_url": self.base_url,
                    "company": self.company,
                    "warehouse": self.warehouse,
                    "latency_ms": round((time.monotonic() - t0) * 1000.0, 1),
                }
        except Exception as exc:
            return {
                "configured": True,
                "reachable": False,
                "base_url": self.base_url,
                "error": str(exc),
                "latency_ms": round((time.monotonic() - t0) * 1000.0, 1),
            }

    def get_item_balance(self, sku_id: str) -> int | None:
        if not self.configured:
            return None
        with self._client() as client:
            r = client.get(
                "/api/resource/Bin",
                params={
                    "fields": json.dumps(["actual_qty"]),
                    "filters": json.dumps([["item_code", "=", sku_id], ["warehouse", "=", self.warehouse]]),
                    "limit_page_length": 1,
                },
            )
            r.raise_for_status()
            rows = r.json().get("data", [])
            if not rows:
                return 0
            return int(round(float(rows[0].get("actual_qty", 0))))

    def get_recent_receipts(self, limit: int = 5) -> list[dict[str, Any]]:
        if not self.configured:
            return []
        with self._client() as client:
            r = client.get(
                "/api/resource/Purchase Receipt",
                params={
                    "fields": json.dumps(
                        [
                            "name",
                            "supplier",
                            "posting_date",
                            "total_qty",
                            "grand_total",
                            "docstatus",
                            "dockpilot_delivery_id",
                            "dockpilot_revision_id",
                            "dockpilot_workflow_id",
                        ]
                    ),
                    "order_by": "modified desc",
                    "limit_page_length": limit,
                },
            )
            r.raise_for_status()
            rows = r.json().get("data", [])
            for row in rows:
                row["url"] = f"{self.base_url}/app/purchase-receipt/{row['name']}"
            return rows

    def _ensure_supplier(self, client: httpx.Client, supplier_name: str) -> str:
        r = client.get(
            "/api/resource/Supplier",
            params={
                "fields": json.dumps(["name"]),
                "filters": json.dumps([["supplier_name", "=", supplier_name]]),
                "limit_page_length": 1,
            },
        )
        r.raise_for_status()
        rows = r.json().get("data", [])
        if rows:
            return str(rows[0]["name"])
        by_name = client.get(f"/api/resource/Supplier/{supplier_name}")
        if by_name.status_code == 200:
            return supplier_name
        created = client.post(
            "/api/resource/Supplier",
            json={
                "supplier_name": supplier_name,
                "supplier_group": "All Supplier Groups",
                "supplier_type": "Company",
                "country": "India",
            },
        )
        created.raise_for_status()
        return str(created.json()["data"]["name"])

    def _ensure_item(self, client: httpx.Client, sku: SKU) -> str:
        by_code = client.get(f"/api/resource/Item/{sku.sku_id}")
        if by_code.status_code == 200:
            return sku.sku_id
        created = client.post(
            "/api/resource/Item",
            json={
                "item_code": sku.sku_id,
                "item_name": sku.name[:140],
                "item_group": "All Item Groups",
                "stock_uom": "Nos",
                "is_stock_item": 1,
                "include_item_in_manufacturing": 0,
                "standard_rate": float(sku.unit_cost_inr),
                "valuation_rate": float(sku.unit_cost_inr),
                "opening_stock": 0,
            },
        )
        created.raise_for_status()
        return str(created.json()["data"]["name"])

    def ensure_po_and_item(self, po: PurchaseOrder, sku: SKU) -> str:
        """Ensure Supplier, Item, and a submitted Purchase Order matching po.po_number exist in ERPNext."""
        if not self.configured:
            raise ERPNextSyncError("ERPNext adapter is not configured.")
        with self._client() as client:
            r = client.get(
                "/api/resource/Purchase Order",
                params={
                    "fields": json.dumps(["name", "docstatus"]),
                    "filters": json.dumps([["dockpilot_po_code", "=", po.po_number], ["docstatus", "=", 1]]),
                    "limit_page_length": 1,
                },
            )
            r.raise_for_status()
            rows = r.json().get("data", [])
            if rows:
                return str(rows[0]["name"])

            supplier_id = self._ensure_supplier(client, po.vendor_name)
            item_code = self._ensure_item(client, sku)

            po_create = client.post(
                "/api/resource/Purchase Order",
                json={
                    "company": self.company,
                    "supplier": supplier_id,
                    "currency": "INR",
                    "schedule_date": "2026-12-31",
                    "set_warehouse": self.warehouse,
                    "dockpilot_po_code": po.po_number,
                    "items": [
                        {
                            "item_code": item_code,
                            "qty": float(po.expected_pieces),
                            "rate": float(sku.unit_cost_inr),
                            "warehouse": self.warehouse,
                            "schedule_date": "2026-12-31",
                        }
                    ],
                },
            )
            po_create.raise_for_status()
            po_doc = po_create.json()["data"]
            sub = client.post("/api/method/frappe.client.submit", json={"doc": po_doc})
            sub.raise_for_status()
            return str(sub.json()["message"]["name"])

    def _find_receipt_by_delivery_id(self, client: httpx.Client, delivery_id: str) -> dict[str, Any] | None:
        r = client.get(
            "/api/resource/Purchase Receipt",
            params={
                "fields": json.dumps(["name", "docstatus", "total_qty", "dockpilot_revision_id"]),
                "filters": json.dumps([["dockpilot_delivery_id", "=", delivery_id], ["docstatus", "<", 2]]),
                "limit_page_length": 1,
            },
        )
        r.raise_for_status()
        rows = r.json().get("data", [])
        return rows[0] if rows else None

    def _read_stock_ledger_entry(self, client: httpx.Client, voucher_no: str, sku_id: str) -> dict[str, Any] | None:
        r = client.get(
            "/api/resource/Stock Ledger Entry",
            params={
                "fields": json.dumps(["name", "actual_qty", "qty_after_transaction", "warehouse", "is_cancelled"]),
                "filters": json.dumps(
                    [
                        ["voucher_type", "=", "Purchase Receipt"],
                        ["voucher_no", "=", voucher_no],
                        ["item_code", "=", sku_id],
                        ["is_cancelled", "=", 0],
                    ]
                ),
                "limit_page_length": 1,
            },
        )
        r.raise_for_status()
        rows = r.json().get("data", [])
        return rows[0] if rows else None

    def post_purchase_receipt_idempotent(
        self,
        *,
        workflow_id: str,
        po: PurchaseOrder,
        sku: SKU,
        received_pieces: int,
        delivery_id: str,
        revision_id: int,
    ) -> dict[str, Any]:
        """Post one submitted Purchase Receipt bound to delivery_id and verify Stock Ledger Entry."""
        if not self.configured:
            return {
                "erp_sync_status": "NOT_CONFIGURED",
                "erp_verified": False,
                "erp_receipt_id": None,
                "erp_po_id": None,
                "erp_stock_after": None,
                "erp_url": None,
            }

        erp_po_id = self.ensure_po_and_item(po, sku)
        with self._client() as client:
            existing = self._find_receipt_by_delivery_id(client, delivery_id)
            if existing:
                rec_name = str(existing["name"])
                if int(existing.get("docstatus", 0)) == 0:
                    full_doc = client.get(f"/api/resource/Purchase Receipt/{rec_name}").json()["data"]
                    sub = client.post("/api/method/frappe.client.submit", json={"doc": full_doc})
                    sub.raise_for_status()
                sle = self._read_stock_ledger_entry(client, rec_name, sku.sku_id)
                bal = self.get_item_balance(sku.sku_id)
                return {
                    "erp_sync_status": "POSTED",
                    "erp_verified": bool(sle is not None),
                    "erp_receipt_id": rec_name,
                    "erp_po_id": erp_po_id,
                    "erp_stock_after": int(round(float(sle["qty_after_transaction"]))) if sle else bal,
                    "erp_url": f"{self.base_url}/app/purchase-receipt/{rec_name}",
                    "idempotent_replay": True,
                }

            po_full = client.get(f"/api/resource/Purchase Order/{erp_po_id}")
            po_full.raise_for_status()
            po_doc = po_full.json()["data"]
            po_items = po_doc.get("items", [])
            po_item_name = po_items[0]["name"] if po_items else None
            supplier_id = po_doc["supplier"]

            pr_payload: dict[str, Any] = {
                "company": self.company,
                "supplier": supplier_id,
                "currency": "INR",
                "set_warehouse": self.warehouse,
                "supplier_delivery_note": po.challan_no,
                "dockpilot_delivery_id": delivery_id,
                "dockpilot_revision_id": revision_id,
                "dockpilot_workflow_id": workflow_id,
                "items": [
                    {
                        "item_code": sku.sku_id,
                        "qty": float(received_pieces),
                        "rate": float(sku.unit_cost_inr),
                        "warehouse": self.warehouse,
                        **({"purchase_order": erp_po_id, "purchase_order_item": po_item_name} if po_item_name else {}),
                    }
                ],
            }

            try:
                pr_create = client.post("/api/resource/Purchase Receipt", json=pr_payload)
                pr_create.raise_for_status()
                pr_doc = pr_create.json()["data"]
                sub = client.post("/api/method/frappe.client.submit", json={"doc": pr_doc})
                sub.raise_for_status()
                submitted = sub.json()["message"]
                rec_name = str(submitted["name"])
            except httpx.HTTPStatusError:
                reconciled = self._find_receipt_by_delivery_id(client, delivery_id)
                if not reconciled:
                    raise
                rec_name = str(reconciled["name"])
                if int(reconciled.get("docstatus", 0)) == 0:
                    full_doc = client.get(f"/api/resource/Purchase Receipt/{rec_name}").json()["data"]
                    sub = client.post("/api/method/frappe.client.submit", json={"doc": full_doc})
                    sub.raise_for_status()

            sle = self._read_stock_ledger_entry(client, rec_name, sku.sku_id)
            if not sle:
                raise ERPNextSyncError(f"Submitted Purchase Receipt {rec_name} missing verified Stock Ledger Entry.")
            stock_after = int(round(float(sle["qty_after_transaction"])))
            return {
                "erp_sync_status": "POSTED",
                "erp_verified": True,
                "erp_receipt_id": rec_name,
                "erp_po_id": erp_po_id,
                "erp_stock_after": stock_after,
                "erp_url": f"{self.base_url}/app/purchase-receipt/{rec_name}",
                "idempotent_replay": False,
            }

    def cancel_receipts_for_workflow(self, workflow_id: str) -> list[str]:
        """Cancel submitted ERPNext Purchase Receipts tied to workflow_id on reset/reversal."""
        if not self.configured:
            return []
        cancelled: list[str] = []
        with self._client() as client:
            r = client.get(
                "/api/resource/Purchase Receipt",
                params={
                    "fields": json.dumps(["name", "docstatus"]),
                    "filters": json.dumps([["dockpilot_workflow_id", "=", workflow_id], ["docstatus", "=", 1]]),
                    "limit_page_length": 20,
                },
            )
            r.raise_for_status()
            for row in r.json().get("data", []):
                name = str(row["name"])
                c = client.post("/api/method/frappe.client.cancel", json={"doctype": "Purchase Receipt", "name": name})
                c.raise_for_status()
                cancelled.append(name)
        return cancelled
