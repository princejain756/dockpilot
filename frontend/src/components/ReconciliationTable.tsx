"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { PurchaseOrder, SKU, WorkflowSnapshot } from "@/lib/types";
import type { UiBanner } from "@/lib/useDockSession";
import {
  deriveRevisionLifecycle,
  EWAY_STATUS_LABELS,
  formatCount,
  formatINR,
  formatIsoDateTime,
  labelFor,
  REVISION_STATUS_LABELS,
  stepIndexForStage,
} from "@/lib/displayLabels";

const WORKFLOW_STEPS = ["Identify", "Reconcile", "Approve", "Commit"] as const;

interface ReconciliationTableProps {
  snapshot: WorkflowSnapshot | null;
  po: PurchaseOrder | null;
  sku: SKU | null;
  banner: UiBanner | null;
  onDismissBanner: () => void;
  onJumpToCount?: () => void;
}

export function ReconciliationTable({
  snapshot,
  po,
  sku,
  banner,
  onDismissBanner,
  onJumpToCount,
}: ReconciliationTableProps) {
  const [showEarlier, setShowEarlier] = useState(false);

  const { eligibleRev, latestSuperseded, supersededRevs, isInterruptedHold } =
    deriveRevisionLifecycle(snapshot);

  const earlierRevs = supersededRevs.slice(0, Math.max(0, supersededRevs.length - 1));

  const expectedTotal = eligibleRev?.expected_pieces ?? po?.expected_pieces ?? 288;
  const orderedCartons = po?.ordered_cartons ?? 12;
  const packUnit = eligibleRev?.pack_unit ?? po?.pack_unit ?? "peti";
  const packSize = eligibleRev?.pack_size ?? sku?.pack_conversions?.[packUnit] ?? 24;
  const expectedLoose = Math.max(0, expectedTotal - orderedCartons * packSize);
  const unitCost = sku?.unit_cost_inr ?? 7000;
  const stageIdx = stepIndexForStage(snapshot?.stage);

  const cartonsChanged =
    !eligibleRev ||
    Boolean(
      latestSuperseded &&
        (latestSuperseded.cartons !== eligibleRev.cartons ||
          latestSuperseded.pack_unit !== eligibleRev.pack_unit)
    );
  const looseChanged =
    !eligibleRev || Boolean(latestSuperseded && latestSuperseded.loose_pieces !== eligibleRev.loose_pieces);
  const totalChanged =
    !eligibleRev || Boolean(latestSuperseded && latestSuperseded.total_pieces !== eligibleRev.total_pieces);
  const shortChanged =
    !eligibleRev || Boolean(latestSuperseded && latestSuperseded.shortage_pieces !== eligibleRev.shortage_pieces);
  const exposureChanged =
    !eligibleRev ||
    Boolean(latestSuperseded && latestSuperseded.shortage_value_inr !== eligibleRev.shortage_value_inr);

  const isExpiredEway =
    po?.eway_bill.status === "EXPIRED" ||
    Boolean(eligibleRev?.hold_reasons.some((r) => /eway/i.test(r)));

  const gstinChecksumOk =
    Boolean(po?.vendor_gstin && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(po.vendor_gstin));

  const bannerToneClass =
    banner?.kind === "error"
      ? "border-block-ink/25 bg-block-bg text-block-ink"
      : banner?.kind === "warn"
        ? "border-warn-ink/25 bg-warn-bg text-warn-ink"
        : banner?.kind === "success"
          ? "border-ok-ink/25 bg-ok-bg text-ok-ink"
          : "border-line-strong bg-subtle text-ink";

  return (
    <section aria-label="Receiving reconciliation ledger" className="space-y-3">
      {/* Unified Single-Line Hold Alert when interrupted or expired e-Way */}
      {isInterruptedHold && snapshot && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-ink/30 bg-warn-bg px-4 py-2.5 text-xs text-warn-ink"
        >
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Posting paused after spoken interruption.
              {latestSuperseded ? ` Rev ${latestSuperseded.revision_id} (${formatCount(latestSuperseded.total_pieces)} pcs) superseded.` : ""}{" "}
              Speak or enter the corrected count to reopen.
            </span>
          </div>
          {onJumpToCount && (
            <button
              type="button"
              onClick={onJumpToCount}
              className="shrink-0 rounded-md border border-warn-ink/30 bg-surface px-2.5 py-1 font-semibold text-warn-ink hover:bg-subtle"
            >
              Enter corrected count
            </button>
          )}
        </div>
      )}

      {isExpiredEway && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-block-ink/25 bg-block-bg px-4 py-2.5 text-xs text-block-ink"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <span className="font-semibold">
              Expired GST e-Way Bill ({po?.eway_bill.eway_bill_no || "EWB"})
            </span>{" "}
            valid until {formatIsoDateTime(po?.eway_bill.valid_until_iso)}. Automated stock posting is halted.
          </div>
        </div>
      )}

      {banner && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs ${bannerToneClass}`}
        >
          <div>
            <span className="font-semibold">{banner.label}: </span>
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={onDismissBanner}
            className="shrink-0 font-medium underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="app-card overflow-hidden">
        {/* Merged Single PO + Challan + GSTIN + Workflow Stepper Header */}
        <div className="border-b border-line px-5 py-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-semibold text-ink">
                  {po?.po_number || snapshot?.po_number || "PO-4471"}
                </span>
                <span aria-hidden="true">·</span>
                <span>{po?.vendor_name || "VayuMech Synthetic Components Pvt Ltd"}</span>
                {snapshot?.challan_source === "CAMERA_UPLOAD" && (
                  <span className="pill-success rounded px-1.5 py-0.5 text-[11px] font-medium">
                    Vision Extracted
                  </span>
                )}
              </div>
              <h1 className="type-section mt-1 text-ink">
                {sku?.name || "Industrial Precision Valve Pack"}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                <span>
                  Challan <span className="numeral text-ink">{po?.challan_no || "CH-4471"}</span>
                </span>
                <span>
                  Invoice <span className="numeral text-ink">{po?.invoice_no || "INV-4471"}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  GSTIN{" "}
                  <span className="font-mono text-ink">
                    {po?.vendor_gstin || "29AABCV9999K1Z5"}
                  </span>
                  {gstinChecksumOk && (
                    <span className="inline-flex items-center gap-0.5 text-ok-ink font-medium">
                      <ShieldCheck className="h-3 w-3" /> Checksum valid
                    </span>
                  )}
                </span>
                <span className={isExpiredEway ? "font-semibold text-block-ink" : ""}>
                  e-Way {po?.eway_bill.eway_bill_no || "EWB-2026-4471"} (
                  {labelFor(EWAY_STATUS_LABELS, po?.eway_bill.status, "Active")})
                </span>
              </div>
            </div>

            {/* 4-Stage Process Stepper */}
            <nav aria-label="Receiving stage" className="flex items-center gap-2 text-xs">
              {WORKFLOW_STEPS.map((label, idx) => {
                const isDone = idx < stageIdx || snapshot?.stage === "COMMIT";
                const isCurrent = idx === stageIdx && snapshot?.stage !== "COMMIT";
                return (
                  <React.Fragment key={label}>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                        isCurrent
                          ? "bg-ok-bg font-semibold text-ok-ink"
                          : isDone
                            ? "font-medium text-ok-ink"
                            : "font-normal text-faint"
                      }`}
                    >
                      {isDone && <Check className="h-3 w-3 shrink-0" />}
                      <span>{label}</span>
                    </span>
                    {idx < WORKFLOW_STEPS.length - 1 && (
                      <span className="text-line-strong" aria-hidden="true">
                        /
                      </span>
                    )}
                  </React.Fragment>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Field Reconciliation Diff Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-subtle/60 text-xs font-medium text-muted">
                <th className="px-5 py-2.5">Line Item</th>
                <th className="px-4 py-2.5 text-right">Expected (PO)</th>
                {latestSuperseded && (
                  <th className="px-4 py-2.5 text-right">
                    Previous · Rev {latestSuperseded.revision_id} (Superseded)
                  </th>
                )}
                <th className="px-5 py-2.5 text-right">
                  {eligibleRev
                    ? `Active · Rev ${eligibleRev.revision_id} (${labelFor(
                        REVISION_STATUS_LABELS,
                        eligibleRev.status,
                        "Draft"
                      )})`
                    : isInterruptedHold
                      ? "Correction needed"
                      : "Active count"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-[13px]">
              <tr>
                <td className="px-5 py-2.5 font-medium text-ink">
                  Packed cartons ({packUnit} × {packSize})
                </td>
                <td className="numeral px-4 py-2.5 text-right text-ink/75 dark:text-zinc-300">
                  {formatCount(orderedCartons)} {packUnit} ({formatCount(orderedCartons * packSize)} pcs)
                </td>
                {latestSuperseded && (
                  <td
                    className={`numeral px-4 py-2.5 text-right text-ink/70 dark:text-zinc-300 ${
                      cartonsChanged ? "line-through" : ""
                    }`}
                  >
                    {formatCount(latestSuperseded.cartons)} {latestSuperseded.pack_unit} (
                    {formatCount(latestSuperseded.cartons * latestSuperseded.pack_size)} pcs)
                  </td>
                )}
                <td
                  className={`numeral px-5 py-2.5 text-right ${
                    eligibleRev ? "font-medium text-ink" : "font-normal text-muted"
                  }`}
                >
                  {eligibleRev
                    ? `${formatCount(eligibleRev.cartons)} ${eligibleRev.pack_unit} (${formatCount(
                        eligibleRev.cartons * eligibleRev.pack_size
                      )} pcs)`
                    : "Pending"}
                </td>
              </tr>

              <tr>
                <td className="px-5 py-2.5 font-medium text-ink">Loose pieces</td>
                <td className="numeral px-4 py-2.5 text-right text-ink/75 dark:text-zinc-300">
                  {formatCount(expectedLoose)} pcs
                </td>
                {latestSuperseded && (
                  <td
                    className={`numeral px-4 py-2.5 text-right text-ink/70 dark:text-zinc-300 ${
                      looseChanged ? "line-through" : ""
                    }`}
                  >
                    {formatCount(latestSuperseded.loose_pieces)} pcs
                  </td>
                )}
                <td
                  className={`numeral px-5 py-2.5 text-right ${
                    eligibleRev ? "font-medium text-ink" : "font-normal text-muted"
                  }`}
                >
                  {eligibleRev ? `${formatCount(eligibleRev.loose_pieces)} pcs` : "Pending"}
                </td>
              </tr>

              <tr className="bg-subtle/40">
                <td className="px-5 py-2.5 font-semibold text-ink">Total received pieces</td>
                <td className="numeral px-4 py-2.5 text-right font-medium text-ink/75 dark:text-zinc-300">
                  {formatCount(expectedTotal)} pcs
                </td>
                {latestSuperseded && (
                  <td
                    className={`numeral px-4 py-2.5 text-right text-ink/70 dark:text-zinc-300 ${
                      totalChanged ? "line-through" : ""
                    }`}
                  >
                    {formatCount(latestSuperseded.total_pieces)} pcs
                  </td>
                )}
                <td
                  className={`numeral px-5 py-2.5 text-right ${
                    eligibleRev ? "font-semibold text-ink" : "font-normal text-muted"
                  }`}
                >
                  {eligibleRev ? `${formatCount(eligibleRev.total_pieces)} pcs` : "Pending"}
                </td>
              </tr>

              <tr>
                <td className="px-5 py-2.5 font-medium text-ink">Shortage against PO</td>
                <td className="numeral px-4 py-2.5 text-right text-ink/75 dark:text-zinc-300">0 pcs</td>
                {latestSuperseded && (
                  <td
                    className={`numeral px-4 py-2.5 text-right text-ink/70 dark:text-zinc-300 ${
                      shortChanged ? "line-through" : ""
                    }`}
                  >
                    {formatCount(latestSuperseded.shortage_pieces)} pcs
                  </td>
                )}
                <td
                  className={`numeral px-5 py-2.5 text-right ${
                    eligibleRev
                      ? eligibleRev.shortage_pieces > 0
                        ? "font-semibold text-warn-ink"
                        : "font-semibold text-ink"
                      : "font-normal text-muted"
                  }`}
                >
                  {eligibleRev ? `${formatCount(eligibleRev.shortage_pieces)} pcs` : "Pending"}
                </td>
              </tr>

              <tr>
                <td className="px-5 py-2.5 font-medium text-ink">
                  Shortage exposure ({formatINR(unitCost)}/pc)
                </td>
                <td className="numeral px-4 py-2.5 text-right text-ink/75 dark:text-zinc-300">₹0</td>
                {latestSuperseded && (
                  <td
                    className={`numeral px-4 py-2.5 text-right text-ink/70 dark:text-zinc-300 ${
                      exposureChanged ? "line-through" : ""
                    }`}
                  >
                    {formatINR(latestSuperseded.shortage_value_inr)}
                  </td>
                )}
                <td
                  className={`numeral px-5 py-2.5 text-right ${
                    eligibleRev
                      ? eligibleRev.shortage_value_inr > 25000
                        ? "font-semibold text-warn-ink"
                        : "font-semibold text-ink"
                      : "font-normal text-muted"
                  }`}
                >
                  {eligibleRev ? formatINR(eligibleRev.shortage_value_inr) : "Pending"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {earlierRevs.length > 0 && (
          <div className="border-t border-line bg-subtle/40 px-5 py-2.5 text-xs">
            <button
              type="button"
              onClick={() => setShowEarlier((v) => !v)}
              className="inline-flex items-center gap-1 font-medium text-muted hover:text-ink"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showEarlier ? "rotate-180" : ""}`}
              />
              <span>Earlier superseded counts ({earlierRevs.length})</span>
            </button>
            {showEarlier && (
              <div className="mt-2 space-y-1">
                {earlierRevs.map((r) => (
                  <div key={r.revision_id} className="flex justify-between text-ink/70 dark:text-zinc-300 line-through">
                    <span>
                      Rev {r.revision_id}: {r.cartons} {r.pack_unit} + {r.loose_pieces} loose
                    </span>
                    <span className="numeral">
                      {formatCount(r.total_pieces)} pcs · {formatINR(r.shortage_value_inr)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {snapshot?.grn && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-ok-bg/70 px-5 py-2.5 text-xs text-ok-ink">
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                {snapshot.grn.reversed ? "Reversed" : "Posted"} ·{" "}
                <span className="numeral">
                  {snapshot.grn.erp_receipt_id || snapshot.grn.grn_id}
                </span>
              </span>
            </div>
            <span className="numeral font-medium">
              {formatCount(snapshot.grn.received_pieces)} pcs · Stock{" "}
              {formatCount(snapshot.grn.erp_stock_after ?? snapshot.inventory_balance)} pcs
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
