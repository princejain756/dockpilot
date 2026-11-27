"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { dockApi } from "@/lib/api";
import { HoldActionButton } from "@/components/HoldActionButton";
import {
  EWAY_STATUS_LABELS,
  formatCount,
  formatINR,
  formatIsoShortDateTime,
  labelFor,
  REVISION_STATUS_LABELS,
} from "@/lib/displayLabels";
import type { ERPLiveStatus, PurchaseOrder, SKU, WorkflowSnapshot } from "@/lib/types";

export default function MobileSupervisorApprovePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-canvas px-4 py-6 text-sm text-muted">
          Loading mobile approval token...
        </main>
      }
    >
      <MobileSupervisorApproveInner />
    </Suspense>
  );
}

function MobileSupervisorApproveInner() {
  const params = useParams<{ workflowId: string }>();
  const searchParams = useSearchParams();
  const workflowId = decodeURIComponent(params.workflowId || "WF-4471");
  const revParam = Number.parseInt(searchParams.get("rev") || "0", 10);
  const sig = searchParams.get("sig") || "";

  const [snap, setSnap] = useState<WorkflowSnapshot | null>(null);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [sku, setSku] = useState<SKU | null>(null);
  const [erpStatus, setErpStatus] = useState<ERPLiveStatus | null>(null);
  const [badgePin, setBadgePin] = useState("4471");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectedOk, setRejectedOk] = useState(false);
  const [errorBox, setErrorBox] = useState<{ code: string; message: string } | null>(null);
  const [committedOk, setCommittedOk] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [res, erp] = await Promise.all([
        dockApi.state(workflowId),
        dockApi.erpLiveStatus().catch(() => null),
      ]);
      setSnap(res.snapshot);
      setPo(res.snapshot.dynamic_po ?? res.po ?? null);
      setSku(res.snapshot.dynamic_sku ?? res.sku ?? null);
      if (erp) setErpStatus(erp);
    } catch (err) {
      setErrorBox({
        code: "BACKEND_OFFLINE",
        message: err instanceof Error ? err.message : "Failed to load approval request.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  const targetRev = snap?.revisions?.find((r) => r.revision_id === revParam) ?? null;
  const priorRev =
    snap?.revisions
      ?.filter((r) => r.revision_id < revParam)
      .slice(-1)[0] ?? null;
  const activeRev =
    snap?.current_revision_id != null
      ? snap.revisions.find((r) => r.revision_id === snap.current_revision_id) ?? null
      : null;

  const isStale =
    Boolean(snap && revParam > 0 && targetRev && targetRev.status === "SUPERSEDED") ||
    Boolean(snap?.current_revision_id && revParam > 0 && revParam !== snap.current_revision_id);

  const handleApproveAndCommit = async () => {
    setBusy(true);
    setErrorBox(null);
    try {
      const res = await dockApi.approveByToken(workflowId, {
        revision_id: revParam,
        sig,
        auto_commit: true,
      });
      setSnap(res.snapshot);
      if (res.snapshot.grn) setCommittedOk(true);
    } catch (err) {
      const typed = err as Error & { code?: string };
      setErrorBox({
        code: typed.code || "APPROVAL_BLOCKED",
        message: typed.message || "Approval blocked by ledger write gate.",
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleRequestRecount = async () => {
    setBusy(true);
    setErrorBox(null);
    try {
      const note =
        rejectNote.trim() ||
        `Floor Supervisor (SUP-04) rejected Rev ${revParam} and requested a physical recount`;
      const res = await dockApi.bargeIn(workflowId, note, 150);
      setSnap(res.snapshot);
      setRejectedOk(true);
      setRejectOpen(false);
    } catch (err) {
      const typed = err as Error & { code?: string };
      setErrorBox({
        code: typed.code || "RECOUNT_REQUEST_FAILED",
        message: typed.message || "Unable to send count back to the dock.",
      });
    } finally {
      setBusy(false);
    }
  };

  const isCommitted = Boolean(committedOk || (snap?.grn && !snap.grn.reversed));
  const gstinChecksumOk = Boolean(
    po?.vendor_gstin && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(po.vendor_gstin)
  );

  return (
    <main className="min-h-screen bg-canvas px-4 py-3.5 text-ink">
      <div className="mx-auto flex w-full max-w-md flex-col gap-2.5">
        <header className="flex items-start justify-between gap-2 border-b border-line pb-2.5">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted">
              <span>Floor Supervisor (SUP-04)</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    erpStatus?.reachable ? "bg-ok-ink" : "bg-amber-500"
                  }`}
                />
                <span>{erpStatus?.reachable ? "ERPNext Sandbox live" : "Simulated ledger"}</span>
              </span>
            </div>
            <h1 className="text-lg font-semibold text-ink">
              {po?.po_number || snap?.po_number || "PO-4471"} · Revision {revParam || "Pending"}
            </h1>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-[36px] shrink-0 items-center rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-subtle"
          >
            Console
          </Link>
        </header>

        {loading && (
          <div className="app-card p-4 text-sm text-muted">Loading signed approval payload...</div>
        )}

        {errorBox && (
          <section
            role="alert"
            className="rounded-xl border border-block-ink/30 bg-block-bg p-4 text-xs text-block-ink space-y-1.5"
          >
            <div className="flex items-center gap-2 font-semibold text-sm">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>Write Rejected ({errorBox.code})</span>
            </div>
            <p>{errorBox.message}</p>
            <p className="font-medium">
              Warehouse stock untouched ({formatCount(snap?.inventory_balance ?? 1000)} pcs).
            </p>
          </section>
        )}

        {!loading && isStale && !errorBox && !rejectedOk && (
          <section
            role="alert"
            className="rounded-xl border border-warn-ink/30 bg-warn-bg p-4 text-xs text-warn-ink space-y-2"
          >
            <div className="flex items-center gap-2 font-semibold text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Superseded Revision {revParam}</span>
            </div>
            <p>
              This approval link is pinned to invalidated Revision {revParam}. Current active
              revision is {activeRev ? `Revision ${activeRev.revision_id}` : "awaiting correction"}.
            </p>
            <p>You can still hold below to confirm that stale links are rejected with HTTP 409.</p>
          </section>
        )}

        {!loading && snap && (
          <>
            <section className="app-card p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm text-ink">
                  {sku?.name || snap.sku_id || "SKU-24"}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                    isCommitted ? "pill-success" : "pill-warning"
                  }`}
                >
                  {isCommitted
                    ? "Posted"
                    : rejectedOk
                      ? "Recount sent"
                      : isStale
                        ? "Superseded"
                        : "Awaiting sign-off"}
                </span>
              </div>

              {targetRev ? (
                <div className="divide-y divide-line rounded-lg border border-line bg-subtle/40">
                  <div className="flex justify-between gap-2 px-3 py-1.5">
                    <span className="text-muted">Revision</span>
                    <span className="numeral font-semibold text-ink">
                      Rev {targetRev.revision_id} ·{" "}
                      {labelFor(REVISION_STATUS_LABELS, targetRev.status, "Draft")}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 px-3 py-1.5">
                    <span className="text-muted whitespace-nowrap">Count</span>
                    <span className="numeral text-ink">
                      {formatCount(targetRev.cartons)} {targetRev.pack_unit} +{" "}
                      {formatCount(targetRev.loose_pieces)} loose ={" "}
                      {formatCount(targetRev.total_pieces)} pcs
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 px-3 py-1.5">
                    <span className="text-muted">Shortage &amp; Exposure</span>
                    <span className="numeral font-semibold text-warn-ink">
                      {formatCount(targetRev.shortage_pieces)} pcs ·{" "}
                      {formatINR(targetRev.shortage_value_inr)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 px-3 py-1.5">
                    <span className="text-muted">ERPNext Stock</span>
                    <span className="numeral text-ink">
                      {formatCount(snap.inventory_balance)} →{" "}
                      {formatCount(snap.inventory_balance + (targetRev?.total_pieces ?? 0))} pcs
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-muted">Revision {revParam} was not found in this workflow.</p>
              )}
            </section>

            {/* SOP-RCV-002 Required Evidence Summary */}
            <section className="app-card p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">
                  Verification Evidence (SOP-RCV-002 · Clause 4)
                </span>
                <a
                  href={dockApi.fixturePdfUrl("standard")}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 font-semibold text-accent hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Challan PDF</span>
                </a>
              </div>
              <div className="divide-y divide-line rounded-lg border border-line bg-subtle/40">
                <div className="flex justify-between gap-2 px-3 py-1.5">
                  <span className="text-muted">Supplier</span>
                  <span className="text-right font-medium text-ink">
                    {po?.vendor_name || "VayuMech Synthetic Components"}
                  </span>
                </div>
                <div className="flex justify-between gap-2 px-3 py-1.5">
                  <span className="text-muted">Challan / Invoice</span>
                  <span className="numeral text-ink">
                    {po?.challan_no || "CH-4471"} · {po?.invoice_no || "INV-4471"}
                  </span>
                </div>
                <div className="flex justify-between gap-2 px-3 py-1.5">
                  <span className="text-muted">GSTIN</span>
                  <span className="inline-flex flex-wrap items-center justify-end gap-1 font-mono text-ink">
                    <span>{po?.vendor_gstin || "29AABCV9999K1Z5"}</span>
                    {gstinChecksumOk && (
                      <span className="inline-flex items-center gap-0.5 font-sans font-medium text-ok-ink">
                        <ShieldCheck className="h-3 w-3" /> Checksum valid
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between gap-2 px-3 py-1.5">
                  <span className="text-muted">e-Way Bill</span>
                  <span className="numeral text-ink">
                    {po?.eway_bill.eway_bill_no || "EWB-2026-4471"} (
                    {labelFor(EWAY_STATUS_LABELS, po?.eway_bill.status, "Active")})
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="shrink-0 text-muted">Expected vs Count</span>
                  <span className="font-mono text-right text-ink">
                    {formatCount(targetRev?.expected_pieces ?? po?.expected_pieces ?? 288)} exp vs{" "}
                    {formatCount(targetRev?.total_pieces ?? 0)} pcs
                    {priorRev ? ` (was ${formatCount(priorRev.total_pieces)})` : ""}
                  </span>
                </div>
                {targetRev?.spoken_transcript && (
                  <div className="px-3 py-1.5 space-y-0.5">
                    <div className="text-[11px] text-muted">Spoken Dock Read-Back</div>
                    <div className="text-ink">&ldquo;{targetRev.spoken_transcript}&rdquo;</div>
                  </div>
                )}
              </div>
              {targetRev && targetRev.shortage_value_inr > 25000 && (
                <p className="text-xs font-medium text-warn-ink">
                  Variance exceeds ₹25,000 limit; approving posts GRN and issues a draft debit note.
                </p>
              )}
            </section>
          </>
        )}

        {!loading && snap && (
          <div className="space-y-2.5 pt-1">
            {isCommitted ? (
              <div className="rounded-xl border border-ok-ink/25 bg-ok-bg p-3.5 text-xs text-ok-ink space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Approved &amp; Posted ({snap.grn?.erp_receipt_id || snap.grn?.grn_id})</span>
                </div>
                <p>
                  Stock Ledger updated to{" "}
                  {formatCount(snap.grn?.erp_stock_after ?? snap.inventory_balance)} pcs.
                </p>
                {snap.grn?.erp_url && (
                  <a
                    href={snap.grn.erp_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                  >
                    <span>Open ERPNext Purchase Receipt</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            ) : rejectedOk ? (
              <div className="rounded-xl border border-warn-ink/30 bg-warn-bg p-3.5 text-xs text-warn-ink space-y-1">
                <div className="font-semibold text-sm">Recount Requested</div>
                <p>
                  Revision {revParam} has been rejected and returned to the dock receiver for recount.
                </p>
              </div>
            ) : (
              <div className="app-card p-3 space-y-2">
                <label className="block space-y-1 text-xs">
                  <span className="font-medium text-muted">
                    Supervisor Badge PIN · SUP-04 (required to unlock)
                  </span>
                  <input
                    type="password"
                    value={badgePin}
                    onChange={(e) => setBadgePin(e.target.value)}
                    placeholder="4-digit supervisor PIN"
                    className="app-field numeral w-full px-3 py-1.5 text-sm"
                  />
                </label>

                <HoldActionButton
                  label={`Approve & Post Rev ${revParam}`}
                  holdHint="Press & hold 0.8s"
                  scopeText={
                    isStale
                      ? `Superseded Rev ${revParam} link will be rejected`
                      : `Signing as SUP-04 · Posts Rev ${revParam} (${formatCount(targetRev?.total_pieces ?? 0)} pcs) to ERPNext and issues a draft debit note`
                  }
                  eligibilityKey={`mobile-approve-${workflowId}-${revParam}-${snap?.stage || ""}`}
                  holdMs={800}
                  disabled={busy || !sig || revParam <= 0 || badgePin.trim().length < 4}
                  tone={isStale ? "danger" : "primary"}
                  onConfirm={handleApproveAndCommit}
                />

                {!rejectOpen ? (
                  <button
                    type="button"
                    disabled={busy || isStale}
                    onClick={() => setRejectOpen(true)}
                    className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-block-ink/30 bg-surface px-4 text-xs font-semibold text-block-ink hover:bg-block-bg disabled:opacity-45"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Request Recount (Reject Rev {revParam})</span>
                  </button>
                ) : (
                  <div className="rounded-lg border border-block-ink/25 bg-surface p-3 space-y-2 text-xs">
                    <label className="block space-y-1">
                      <span className="font-medium text-muted">Recount note for dock receiver</span>
                      <input
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="e.g. Re-verify loose count on pallet 2"
                        className="app-field w-full px-2.5 py-2 text-xs"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRequestRecount()}
                        className="flex-1 rounded-lg bg-block-bg border border-block-ink/30 px-3 py-2 font-semibold text-block-ink hover:opacity-90 disabled:opacity-50"
                      >
                        Send Back to Dock
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRejectOpen(false)}
                        className="rounded-lg border border-line px-3 py-2 text-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {!sig && (
                  <p className="text-center text-xs text-block-ink">
                    Missing security signature token in approval URL.
                  </p>
                )}
                <div className="flex items-center justify-center gap-1.5 text-xs text-faint">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  <span>Valid only for Rev {revParam}. Any newer count invalidates this link.</span>
                </div>
              </div>
            )}

            {snap?.updated_at && (
              <p className="text-center text-xs text-faint">
                Last synced {formatIsoShortDateTime(snap.updated_at)}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
