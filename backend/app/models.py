"""Domain and API Pydantic models for DockPilot."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal
from pydantic import BaseModel, Field


def utc_now_iso() -> str:
    """Return RFC3339 UTC timestamp string."""
    return datetime.now(timezone.utc).isoformat()


class WorkflowStage(str, Enum):
    """Finite state machine stages controlling prompt cards and legal tools."""

    IDENTIFY = "IDENTIFY"
    RECONCILE = "RECONCILE"
    APPROVE = "APPROVE"
    COMMIT = "COMMIT"
    HOLD_EXCEPTION = "HOLD_EXCEPTION"
    REVERSED = "REVERSED"


class ActorRole(str, Enum):
    """Role boundary enforcing separation between dock receiver and supervisor."""

    RECEIVER = "RECEIVER"
    SUPERVISOR = "SUPERVISOR"


class SKU(BaseModel):
    """Synthetic product master record with base-unit pack conversions."""

    sku_id: str
    name: str
    warehouse_id: str = "DOCK-1"
    unit_cost_inr: int
    gst_rate_pct: int = 18
    hsn_code: str = "8481"
    pack_conversions: dict[str, int]
    ambiguous_units: list[str] = Field(default_factory=list)


class EWayBill(BaseModel):
    """Synthetic GST e-Way Bill header for dock verification."""

    eway_bill_no: str
    valid_until_iso: str
    vehicle_no: str
    consignor_gstin: str
    declared_value_inr: int
    status: Literal["ACTIVE", "EXPIRED", "CANCELLED"] = "ACTIVE"


class PurchaseOrder(BaseModel):
    """Synthetic Purchase Order line expected at receiving dock."""

    po_number: str
    vendor_id: str
    vendor_name: str
    vendor_gstin: str
    invoice_no: str
    challan_no: str
    eway_bill: EWayBill
    sku_id: str
    ordered_cartons: int
    pack_unit: str
    expected_pieces: int
    open_pieces: int


class DraftRevision(BaseModel):
    """Versioned count calculation computed deterministically in code."""

    revision_id: int
    po_number: str
    sku_id: str
    cartons: int
    pack_unit: str
    pack_size: int
    loose_pieces: int
    total_pieces: int
    expected_pieces: int
    shortage_pieces: int
    overage_pieces: int
    shortage_value_inr: int
    status: Literal["DRAFT", "CONFIRMED", "SUPERSEDED", "APPROVED", "COMMITTED", "BLOCKED"]
    requires_supervisor_approval: bool
    hold_reasons: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=utc_now_iso)
    confirmed_by: str | None = None
    confirmed_at: str | None = None
    spoken_transcript: str = ""


class PolicyCitation(BaseModel):
    """Compact <=150-token excerpt returned by RAG-as-tool."""

    doc_id: str
    title: str
    clause: str
    revision: str
    effective_date: str
    excerpt: str
    source_backend: Literal["vertex_rag", "local_index"] = "local_index"


class ApprovalRecord(BaseModel):
    """Role-checked human-in-the-loop approval bound to one exact revision."""

    approval_id: str
    workflow_id: str
    revision_id: int
    approver_id: str
    approver_role: ActorRole
    decision: Literal["APPROVED", "REJECTED"]
    reason: str
    citation_clause: str | None = None
    approved_at: str = Field(default_factory=utc_now_iso)


class SupplierDebitNotePack(BaseModel):
    """Auto-generated GST / e-Way Bill discrepancy draft emitted on commit."""

    claim_id: str
    grn_id: str
    po_number: str
    invoice_no: str
    eway_bill_no: str
    vendor_name: str
    vendor_gstin: str
    sku_id: str
    short_pieces: int
    unit_cost_inr: int
    taxable_shortage_inr: int
    cgst_inr: float
    sgst_inr: float
    total_debit_note_inr: float
    policy_clause: str
    supervisor_id: str
    revision_id: int
    status: Literal["DRAFT", "NONE"] = "DRAFT"
    synthetic_disclaimer: str = "Synthetic adapter payload for operational review; not a tax filing."
    created_at: str = Field(default_factory=utc_now_iso)


class GoodsReceiptNote(BaseModel):
    """Atomic committed receipt record."""

    grn_id: str
    workflow_id: str
    po_number: str
    sku_id: str
    revision_id: int
    received_pieces: int
    shortage_pieces: int
    shortage_value_inr: int
    idempotency_key: str
    approver_id: str | None = None
    claim_id: str | None = None
    reversed: bool = False
    committed_at: str = Field(default_factory=utc_now_iso)


class StockMovement(BaseModel):
    """Append-only inventory delta ledger entry."""

    movement_id: str
    workflow_id: str
    grn_id: str
    warehouse_id: str
    sku_id: str
    delta_pieces: int
    balance_before: int
    balance_after: int
    kind: Literal["RECEIPT", "REVERSAL"]
    reason: str
    created_at: str = Field(default_factory=utc_now_iso)


class AuditEvent(BaseModel):
    """Immutable workflow and guardrail audit timeline entry."""

    event_id: str
    workflow_id: str
    stage: WorkflowStage
    event_type: str
    actor_id: str
    actor_role: str
    revision_id: int | None = None
    detail: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=utc_now_iso)


class WorkflowSnapshot(BaseModel):
    """Full authoritative workflow state hydrated by UI and reconnect handlers."""

    workflow_id: str
    stage: WorkflowStage
    write_gate_open: bool
    po_number: str | None = None
    sku_id: str | None = None
    inventory_balance: int = 1000
    current_revision_id: int | None = None
    revisions: list[DraftRevision] = Field(default_factory=list)
    citations: list[PolicyCitation] = Field(default_factory=list)
    approval: ApprovalRecord | None = None
    grn: GoodsReceiptNote | None = None
    claim_pack: SupplierDebitNotePack | None = None
    movements: list[StockMovement] = Field(default_factory=list)
    audit_events: list[AuditEvent] = Field(default_factory=list)
    updated_at: str = Field(default_factory=utc_now_iso)


class DomainRuleError(Exception):
    """Structured domain failure carrying HTTP/tool status code and error code."""

    def __init__(self, status_code: int, code: str, message: str, detail: dict[str, Any] | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.detail = detail or {}
