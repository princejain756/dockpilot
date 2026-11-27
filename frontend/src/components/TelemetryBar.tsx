"use client";

import React from "react";
import {
  deriveRevisionLifecycle,
  formatCount,
  formatINR,
  labelFor,
  REVISION_STATUS_LABELS,
} from "@/lib/displayLabels";
import type { ERPLiveStatus, PurchaseOrder, SKU, WorkflowSnapshot } from "@/lib/types";

interface TelemetryBarProps {
  snapshot: WorkflowSnapshot | null;
  po: PurchaseOrder | null;
  sku: SKU | null;
  erpStatus: ERPLiveStatus | null;
}

export function TelemetryBar({ snapshot, po, sku, erpStatus }: TelemetryBarProps) {
  const { eligibleRev, latestSuperseded, isInterruptedHold } = deriveRevisionLifecycle(snapshot);

  const skuCode = snapshot?.sku_id || po?.sku_id || sku?.sku_id || "SKU-24";
  const stockBalance =
    snapshot?.grn && snapshot.grn.erp_stock_after !== undefined && snapshot.grn.erp_stock_after !== null
      ? snapshot.grn.erp_stock_after
      : snapshot?.inventory_balance ?? erpStatus?.sku24_balance ?? 1000;

  const expectedTotal = eligibleRev?.expected_pieces ?? po?.expected_pieces ?? 288;
  const orderedCartons = po?.ordered_cartons ?? 12;
  const packUnit = po?.pack_unit ?? "peti";
  const packSize = sku?.pack_conversions?.[packUnit] ?? 24;

  const countDisplay = snapshot?.grn && !snapshot.grn.reversed
    ? `${formatCount(snapshot.grn.received_pieces)} pcs`
    : eligibleRev
      ? `${formatCount(eligibleRev.total_pieces)} pcs`
      : isInterruptedHold
        ? "Count held"
        : "Awaiting count";

  const countSub = snapshot?.grn && !snapshot.grn.reversed
    ? `Committed on Rev ${snapshot.grn.revision_id}`
    : eligibleRev
      ? `Rev ${eligibleRev.revision_id} · ${labelFor(REVISION_STATUS_LABELS, eligibleRev.status, "Draft")}`
      : latestSuperseded
        ? `Rev ${latestSuperseded.revision_id} superseded`
        : "Speak or enter dock count";

  const shortageInr = snapshot?.grn && !snapshot.grn.reversed
    ? snapshot.grn.shortage_value_inr
    : eligibleRev
      ? eligibleRev.shortage_value_inr
      : 0;

  const shortagePcs = snapshot?.grn && !snapshot.grn.reversed
    ? snapshot.grn.shortage_pieces
    : eligibleRev
      ? eligibleRev.shortage_pieces
      : 0;

  const approvalText = snapshot?.grn && !snapshot.grn.reversed
    ? shortagePcs > 0
      ? `${formatCount(shortagePcs)} pcs short · Debit note ready`
      : "Full receipt · No debit note"
    : eligibleRev
      ? eligibleRev.requires_supervisor_approval
        ? `${formatCount(shortagePcs)} pcs short · Supervisor required`
        : shortagePcs > 0
          ? `${formatCount(shortagePcs)} pcs short · Self-post eligible`
          : "Full receipt · No variance"
      : isInterruptedHold
        ? latestSuperseded
          ? `Prior Rev ${latestSuperseded.revision_id}: ${formatINR(latestSuperseded.shortage_value_inr)} · Recount needed`
          : "Recount required"
        : "Approval threshold: ₹25,000";

  return (
    <section
      aria-label="Warehouse receiving summary"
      className="app-card grid grid-cols-2 divide-y divide-line overflow-hidden xl:grid-cols-4 xl:divide-x xl:divide-y-0"
    >
      <div className="px-4 py-3">
        <div className="text-[11px] font-medium text-muted">
          {erpStatus?.reachable ? "ERPNext Stock" : "Dock Stock"} · {skuCode}
        </div>
        <div className="numeral mt-1 text-[20px] font-semibold leading-tight text-ink">
          {formatCount(stockBalance)} pcs
        </div>
        <div className="mt-1 text-xs text-faint">
          {snapshot?.grn?.erp_receipt_id
            ? `Receipt ${snapshot.grn.erp_receipt_id}`
            : erpStatus?.reachable
              ? "Live ERPNext balance (Dock 1)"
              : "Dock 1 bin balance"}
        </div>
      </div>

      <div className="border-l border-line px-4 py-3 xl:border-l-0">
        <div className="text-[11px] font-medium text-muted">
          PO Expected · {po?.po_number || snapshot?.po_number || "PO-4471"}
        </div>
        <div className="numeral mt-1 text-[20px] font-semibold leading-tight text-ink">
          {formatCount(expectedTotal)} pcs
        </div>
        <div className="mt-1 text-xs text-faint">
          {formatCount(orderedCartons)} {packUnit} × {formatCount(packSize)} pcs
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="text-[11px] font-medium text-muted">Active Received Count</div>
        <div
          className={`mt-1 text-[20px] font-semibold leading-tight ${
            isInterruptedHold ? "text-warn-ink" : "text-ink"
          } ${eligibleRev || (snapshot?.grn && !snapshot.grn.reversed) ? "numeral" : ""}`}
        >
          {countDisplay}
        </div>
        <div className="mt-1 text-xs text-faint">{countSub}</div>
      </div>

      <div className="border-l border-line px-4 py-3 xl:border-l-0">
        <div className="text-[11px] font-medium text-muted">Shortage Exposure</div>
        <div
          className={`mt-1 text-[20px] font-semibold leading-tight ${
            isInterruptedHold
              ? "text-warn-ink"
              : shortageInr > 25000
                ? "numeral text-warn-ink"
                : "numeral text-ink"
          }`}
        >
          {isInterruptedHold && !eligibleRev && !(snapshot?.grn && !snapshot.grn.reversed)
            ? "Pending"
            : formatINR(shortageInr)}
        </div>
        <div className="mt-1 text-xs text-faint">{approvalText}</div>
      </div>
    </section>
  );
}
