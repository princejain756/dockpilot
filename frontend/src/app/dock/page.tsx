"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  Check,
  FileUp,
  Hand,
  Lock,
  Mic,
  MicOff,
  Smartphone,
  Truck,
  Waves,
} from "lucide-react";
import { TopBar } from "@/components/TopBar";
import {
  deriveGatePresentation,
  deriveRevisionLifecycle,
  formatCount,
  formatINR,
  formatIsoShortDateTime,
  labelFor,
  STAGE_LABELS,
} from "@/lib/displayLabels";
import { dockApi } from "@/lib/api";
import type { ApprovalLinkResponse } from "@/lib/types";
import { useDockSession } from "@/lib/useDockSession";

export default function MobileFloorHud() {
  const dock = useDockSession("WF-4471");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cartons, setCartons] = useState("11");
  const [loose, setLoose] = useState("20");
  const [approvalLink, setApprovalLink] = useState<ApprovalLinkResponse | null>(null);

  const snap = dock.snapshot;
  const { eligibleRev, latestSuperseded, isInterruptedHold } = deriveRevisionLifecycle(snap);
  const gate = deriveGatePresentation(snap);
  const isCommitted = Boolean(snap?.grn && !snap.grn.reversed);
  const needsSupervisorSignoff = Boolean(
    eligibleRev?.requires_supervisor_approval && !snap?.approval && !isCommitted
  );

  useEffect(() => {
    if (!needsSupervisorSignoff || !eligibleRev) {
      setApprovalLink(null);
      return;
    }
    dockApi
      .approvalLink("WF-4471", eligibleRev.revision_id)
      .then(setApprovalLink)
      .catch(() => setApprovalLink(null));
  }, [needsSupervisorSignoff, eligibleRev]);

  const canConfirm = Boolean(
    eligibleRev && eligibleRev.status === "DRAFT" && !isInterruptedHold && !isCommitted && !dock.busyAction
  );

  const packUnit = dock.activePo?.pack_unit || "peti";
  const packSize = dock.activeSku?.pack_conversions?.[packUnit] ?? 24;
  const expectedTotal = eligibleRev?.expected_pieces ?? dock.activePo?.expected_pieces ?? 288;
  const shortagePieces = eligibleRev?.shortage_pieces ?? (isCommitted ? snap?.grn?.shortage_pieces ?? 0 : 0);
  const previewTotal =
    (Math.max(0, Number.parseInt(cartons, 10) || 0) * packSize) +
    Math.max(0, Number.parseInt(loose, 10) || 0);

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = Math.max(0, Number.parseInt(cartons, 10) || 0);
    const l = Math.max(0, Number.parseInt(loose, 10) || 0);
    const targetPo = snap?.po_number || dock.activePo?.po_number || "PO-4471";
    await dock.runAction("hud-draft", () =>
      dockApi.draft("WF-4471", {
        po_number: targetPo,
        cartons: c,
        loose_pieces: l,
        pack_unit: packUnit,
        transcript: `Floor HUD entry: ${c} ${packUnit}, ${l} loose`,
      })
    );
  };

  return (
    <div
      className="min-h-screen bg-canvas text-ink"
      data-state={isInterruptedHold ? "hold" : snap?.grn ? "commit" : "reconcile"}
    >
      <TopBar
        activeRoute="hud"
        wsConnected={dock.wsConnected}
        liveBackend={dock.liveBackend}
        activeRegion={dock.activeRegion || dock.health?.region || "asia-south1"}
        healthy={dock.health?.status === "ok"}
        erpReachable={dock.erpStatus?.reachable}
        eventCount={snap?.audit_events?.length ?? 0}
        hasProgress={Boolean((snap?.revisions?.length ?? 0) > 0 || snap?.grn)}
        busy={Boolean(dock.busyAction)}
        onOpenTrace={() => {}}
        onReset={async () => {
          await dock.runAction("reset", () => dockApi.reset("WF-4471"));
        }}
      />

      <main className="mx-auto flex max-w-md flex-col gap-3 px-4 py-4 pb-10">
        {/* Single Authoritative Status Banner */}
        <section
          aria-label="Workflow status"
          className={`rounded-xl border px-4 py-3 text-xs ${
            gate.tone === "danger"
              ? "border-block-ink/25 bg-block-bg text-block-ink"
              : gate.tone === "warning"
                ? "border-warn-ink/25 bg-warn-bg text-warn-ink"
                : gate.tone === "success"
                  ? "border-ok-ink/25 bg-ok-bg text-ok-ink"
                  : "border-line bg-surface text-ink"
          }`}
        >
          <div className="flex items-center justify-between font-semibold">
            <span>
              {snap?.po_number || "PO-4471"} ·{" "}
              {isCommitted
                ? "Posted"
                : isInterruptedHold
                  ? "Hold"
                  : labelFor(STAGE_LABELS, snap?.stage, "Identify")}
            </span>
            <span>{gate.statusLabel}</span>
          </div>
          <p className="mt-1 opacity-90">{gate.reason}</p>
        </section>

        {/* Primary Receiving Counter */}
        <section className="app-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-muted">
              {dock.activeSku?.name || "Industrial Precision Valve Pack"}
            </span>
            {eligibleRev ? (
              <span className="numeral pill-neutral rounded px-2 py-0.5 text-[11px] font-medium">
                Rev {eligibleRev.revision_id}
              </span>
            ) : latestSuperseded ? (
              <span className="pill-warning rounded px-2 py-0.5 text-[11px] font-medium">
                Rev {latestSuperseded.revision_id} superseded
              </span>
            ) : null}
          </div>

          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="numeral text-3xl font-semibold tracking-tight text-ink">
              {eligibleRev
                ? formatCount(eligibleRev.total_pieces)
                : formatCount(expectedTotal)}
            </span>
            <span className="text-base font-medium text-muted">
              {eligibleRev ? "pcs counted" : "pcs expected"}
            </span>
          </div>

          <p className="mt-1 text-xs text-muted">
            {eligibleRev ? (
              <>
                <span>
                  {formatCount(eligibleRev.cartons)} {eligibleRev.pack_unit} +{" "}
                  {formatCount(eligibleRev.loose_pieces)} loose ·{" "}
                </span>
                <span
                  className={
                    eligibleRev.shortage_pieces > 0
                      ? "font-semibold text-warn-ink"
                      : "text-muted"
                  }
                >
                  {formatCount(eligibleRev.shortage_pieces)} short (
                  {formatINR(eligibleRev.shortage_value_inr)})
                </span>
              </>
            ) : isInterruptedHold ? (
              "Enter the corrected cartons and loose pieces below or speak in Hinglish."
            ) : (
              "Upload a challan or tap Voice Count to speak the carton count."
            )}
          </p>

          <div className="mt-3 grid grid-cols-[repeat(3,minmax(0,1fr))] divide-x divide-line rounded-lg border border-line bg-subtle/40 py-2 text-center text-xs">
            <div className="min-w-0 px-2">
              <div className="text-[11px] text-faint">
                {dock.erpStatus?.reachable ? "ERPNext Stock" : "Simulated Stock"}
              </div>
              <div className="numeral mt-0.5 truncate font-semibold text-ink">
                {formatCount(snap?.grn?.erp_stock_after ?? snap?.inventory_balance ?? 1000)} pcs
              </div>
            </div>
            <div className="min-w-0 px-2">
              <div className="text-[11px] text-faint">Expected</div>
              <div className="numeral mt-0.5 truncate font-semibold text-ink">
                {formatCount(expectedTotal)} pcs
              </div>
            </div>
            <div className="min-w-0 px-2">
              <div className="text-[11px] text-faint">Shortage</div>
              <div
                className={`mt-0.5 truncate font-semibold ${
                  isInterruptedHold
                    ? "text-warn-ink"
                    : shortagePieces > 0
                      ? "numeral text-warn-ink"
                      : "numeral text-ink"
                }`}
              >
                {isInterruptedHold && !eligibleRev
                  ? "Pending"
                  : `${formatCount(shortagePieces)} pcs`}
              </div>
            </div>
          </div>
        </section>

        {needsSupervisorSignoff && approvalLink && (
          <section className="app-card border-warn-ink/30 p-3.5 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2 font-semibold text-ink">
              <span className="inline-flex items-center gap-1.5">
                <Smartphone className="h-4 w-4 text-accent" />
                <span>Supervisor Sign-Off Required (&gt; ₹25,000)</span>
              </span>
              <span className="numeral pill-warning rounded px-2 py-0.5 text-[11px]">
                Rev {approvalLink.revision_id}
              </span>
            </div>
            <p className="text-muted">
              Send this revision-bound sign-off link to the Floor Supervisor so stock stays locked
              until approved.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <a
                href={approvalLink.whatsapp_share_url}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[48px] items-center justify-center rounded-xl bg-accent px-2.5 text-center font-semibold text-accent-ink hover:opacity-95"
              >
                Send Sign-Off Link
              </a>
              <Link
                href={`/approve/WF-4471?rev=${approvalLink.revision_id}&sig=${encodeURIComponent(
                  approvalLink.sig
                )}`}
                className="flex min-h-[48px] items-center justify-center rounded-xl border border-line-strong bg-surface px-2.5 text-center font-semibold text-ink hover:bg-subtle"
              >
                Supervisor View
              </Link>
            </div>
          </section>
        )}

        {isCommitted && snap?.driver_gate_pass && (
          <Link
            href={`/gate-pass/WF-4471?sig=${encodeURIComponent(snap.driver_gate_pass.sig)}`}
            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink hover:opacity-95"
          >
            <Truck className="h-5 w-5" />
            <span>Open Bilingual Driver Gate-Pass</span>
          </Link>
        )}

        {dock.banner && (
          <div
            role="status"
            className="app-card px-3.5 py-2.5 text-xs text-ink flex items-center justify-between gap-2"
          >
            <div>
              <span className="font-semibold">{dock.banner.label}: </span>
              <span className="text-muted">{dock.banner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => dock.setBanner(null)}
              className="shrink-0 font-medium text-muted underline"
            >
              Close
            </button>
          </div>
        )}

        {(dock.agentTranscript || eligibleRev?.spoken_transcript) && (
          <div className="app-card px-4 py-3 text-sm">
            <div className="flex items-center justify-between text-[11px] font-medium text-muted">
              <span>Latest Voice Read-Back</span>
              <span className="numeral">
                {formatIsoShortDateTime(dock.transcriptAt || eligibleRev?.created_at)}
              </span>
            </div>
            <p className="mt-1 text-ink">
              {dock.agentTranscript || eligibleRev?.spoken_transcript}
            </p>
          </div>
        )}

        {/* Camera & Quick Count Input */}
        {isCommitted ? (
          <div className="app-card flex items-center gap-2.5 px-4 py-3 text-xs font-medium text-muted">
            <Lock className="h-4 w-4 shrink-0 text-ok-ink" />
            <span>
              Receipt {snap?.grn?.erp_receipt_id || snap?.grn?.grn_id} posted · Count &amp; document capture locked
            </span>
          </div>
        ) : (
          <form onSubmit={handleSubmitCorrection} className="app-card p-3.5 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink">Quick Count Entry ({packUnit} × {packSize})</span>
              <span className="numeral font-medium text-muted">{formatCount(previewTotal)} pcs</span>
            </div>
            {needsSupervisorSignoff && eligibleRev && (
              <p className="rounded-lg border border-warn-ink/25 bg-warn-bg px-2.5 py-1.5 text-[11px] font-medium text-warn-ink">
                Saving a new count supersedes Rev {eligibleRev.revision_id} and invalidates sent sign-off links.
              </p>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
              <label className="min-w-0 space-y-1">
                <span className="block text-[11px] font-medium text-muted">
                  Packed {packUnit} (× {packSize})
                </span>
                <input
                  type="number"
                  min={0}
                  value={cartons}
                  onChange={(e) => setCartons(e.target.value)}
                  aria-label="Packed cartons count"
                  className="app-field numeral w-full min-h-[44px] px-3 text-sm"
                />
              </label>
              <label className="min-w-0 space-y-1">
                <span className="block text-[11px] font-medium text-muted">Loose pieces</span>
                <input
                  type="number"
                  min={0}
                  value={loose}
                  onChange={(e) => setLoose(e.target.value)}
                  aria-label="Loose pieces count"
                  className="app-field numeral w-full min-h-[44px] px-3 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={Boolean(dock.busyAction)}
                className="min-h-[44px] rounded-xl bg-subtle border border-line-strong px-3.5 font-semibold text-ink hover:bg-rail-hover disabled:cursor-not-allowed disabled:opacity-45"
              >
                Save Count
              </button>
            </div>
          </form>
        )}

        {/* Gloved-Thumb Primary Controls (>=54px targets) */}
        <div className="space-y-2.5">
          {!isCommitted && (
            <button
              type="button"
              onClick={() => void dock.toggleMic()}
              className={`flex min-h-[58px] w-full items-center justify-center gap-2.5 rounded-xl text-base font-semibold transition-opacity ${
                dock.micActive
                  ? "border border-block-ink/30 bg-block-bg text-block-ink"
                  : needsSupervisorSignoff
                    ? "border border-line-strong bg-surface text-ink hover:bg-subtle"
                    : "bg-accent text-accent-ink hover:opacity-95"
              }`}
            >
              {dock.micActive ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              <span>{dock.micActive ? "Mute Dock Mic" : "Voice Count (Hinglish)"}</span>
            </button>
          )}

          {!isInterruptedHold && !isCommitted && (
            <button
              type="button"
              onClick={() => void dock.triggerBargeIn("Ruko, nineteen nahi, twenty loose")}
              className="flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-xl border border-warn-ink/30 bg-warn-bg text-base font-semibold text-warn-ink hover:opacity-95"
            >
              <Hand className="h-5 w-5" />
              <span>Stop &amp; Correct</span>
            </button>
          )}

          {eligibleRev && !isCommitted && (
            canConfirm ? (
              <button
                type="button"
                onClick={() => {
                  if (!eligibleRev) return;
                  void dock.runAction("mobile-confirm", () =>
                    dockApi.confirm("WF-4471", eligibleRev.revision_id)
                  );
                }}
                className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-accent text-base font-semibold text-accent-ink hover:opacity-95"
              >
                <Check className="h-5 w-5" />
                <span>Confirm Revision {eligibleRev.revision_id}</span>
              </button>
            ) : (
              <div className="flex items-center justify-center gap-1.5 rounded-xl border border-ok-ink/25 bg-ok-bg px-3 py-2.5 text-xs font-semibold text-ok-ink">
                <Check className="h-4 w-4 shrink-0" />
                <span>
                  Rev {eligibleRev.revision_id} confirmed · Waiting on Floor Supervisor
                </span>
              </div>
            )
          )}

          <div className="grid grid-cols-2 gap-2.5 pt-0.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void dock.runAction(
                  "hud-challan-upload",
                  () => dockApi.ingestChallan("WF-4471", { file }),
                  (res) => ({
                    kind: "success",
                    code: "CHALLAN_INGESTED",
                    label: "Challan loaded",
                    text: `${res.snapshot.po_number} verified (${res.po?.expected_pieces ?? 0} pcs expected).`,
                  })
                );
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={isCommitted}
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-45"
            >
              <FileUp className="h-4 w-4 text-muted" />
              <span>Upload Challan</span>
            </button>

            <button
              type="button"
              disabled={isCommitted}
              onClick={() => void dock.toggleCamera(videoRef.current)}
              className={`flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45 ${
                dock.cameraActive
                  ? "border-accent bg-ok-bg text-ok-ink"
                  : "border-line bg-surface text-ink hover:bg-subtle"
              }`}
            >
              <Camera className="h-4 w-4 text-muted" />
              <span>{dock.cameraActive ? "Cam Live" : "Live Camera"}</span>
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-line bg-subtle/40 px-3 py-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Waves className="h-3.5 w-3.5" />
              <span>Acoustic noise filter</span>
            </span>
            <button
              type="button"
              onClick={() =>
                void dock.changeFilterMode(dock.filterMode === "raw" ? "web-rnnoise" : "raw")
              }
              className="font-semibold text-ink underline underline-offset-2"
            >
              {dock.filterMode === "web-rnnoise" ? "Active" : "Bypassed"}
            </button>
          </div>

          {!isCommitted && snap?.driver_gate_pass && (
            <Link
              href={`/gate-pass/WF-4471?sig=${encodeURIComponent(snap.driver_gate_pass.sig)}`}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-ok-ink/25 bg-ok-bg text-xs font-semibold text-ok-ink"
            >
              <Truck className="h-4 w-4" />
              <span>Open Bilingual Driver Gate-Pass</span>
            </Link>
          )}
        </div>

        {dock.cameraActive && (
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-44 w-full rounded-xl border border-line bg-black object-cover"
          />
        )}
      </main>
    </div>
  );
}
