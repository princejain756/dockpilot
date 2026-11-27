"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  Hand,
  Lock,
  Mic,
  MicOff,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Truck,
} from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { TelemetryBar } from "@/components/TelemetryBar";
import { ReconciliationTable } from "@/components/ReconciliationTable";
import { HoldActionButton } from "@/components/HoldActionButton";
import { FinOpsChart } from "@/components/FinOpsChart";
import { AudioAuditPanel } from "@/components/AudioAuditPanel";
import { TraceDrawer } from "@/components/TraceDrawer";
import { QrMatrix } from "@/components/QrMatrix";
import {
  CLAIM_STATUS_LABELS,
  deriveGatePresentation,
  deriveRevisionLifecycle,
  formatCount,
  formatINR,
  formatIsoShortDateTime,
  labelFor,
  RAG_BACKEND_LABELS,
} from "@/lib/displayLabels";
import { dockApi } from "@/lib/api";
import type { ApprovalLinkResponse } from "@/lib/types";
import { useDockSession } from "@/lib/useDockSession";

export default function DockPilotWorkbench() {
  const dock = useDockSession("WF-4471");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cartonsInputRef = useRef<HTMLInputElement | null>(null);

  const [utterance, setUtterance] = useState("PO-4471, 11 peti aur 20 loose count hua hai");
  const [sopQuery, setSopQuery] = useState("shortage approval 25000 debit note");
  const [manualCartons, setManualCartons] = useState("11");
  const [manualLoose, setManualLoose] = useState("20");
  const [scenario, setScenario] = useState<"PO-4471" | "PO-4472">("PO-4471");
  const [voiceDemoOpen, setVoiceDemoOpen] = useState(false);
  const [sandboxTestsOpen, setSandboxTestsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [terminalOverrideOpen, setTerminalOverrideOpen] = useState(false);
  const [supervisorBadge, setSupervisorBadge] = useState("SUP-04");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [reversalOpen, setReversalOpen] = useState(false);
  const [reversalReason, setReversalReason] = useState("");
  const [traceOpen, setTraceOpen] = useState(false);
  const [approvalLink, setApprovalLink] = useState<ApprovalLinkResponse | null>(null);
  const sopAutoKeyRef = useRef<string | null>(null);

  const snap = dock.snapshot;
  const { eligibleRev, latestSuperseded, isInterruptedHold } = deriveRevisionLifecycle(snap);
  const gate = deriveGatePresentation(snap);
  const isCommitted = Boolean(snap?.grn && !snap.grn.reversed);

  // Sync mobile supervisor QR approval link when supervisor hold is active
  useEffect(() => {
    if (!eligibleRev || !eligibleRev.requires_supervisor_approval || snap?.approval || !snap?.po_number) {
      setApprovalLink(null);
      return;
    }
    dockApi
      .approvalLink("WF-4471", eligibleRev.revision_id)
      .then(setApprovalLink)
      .catch(() => setApprovalLink(null));
  }, [eligibleRev, snap?.approval, snap?.po_number]);

  // Auto-surface SOP clause 4 when supervisor hold activates
  useEffect(() => {
    const hasClause4 = snap?.citations?.some((c) => c.doc_id === "SOP-RCV-002");
    if (!eligibleRev || !eligibleRev.requires_supervisor_approval || hasClause4) {
      return;
    }
    const key = `${snap?.po_number || "PO"}-rev-${eligibleRev.revision_id}`;
    if (sopAutoKeyRef.current === key || dock.busyAction) return;
    sopAutoKeyRef.current = key;
    void dock.runSopQuery("shortage approval 25000 debit note", { quiet: true });
  }, [eligibleRev, snap?.citations, snap?.po_number, dock]);

  const jumpToCount = () => {
    cartonsInputRef.current?.focus();
    cartonsInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const nextDemoStep = () => {
    if (!snap || snap.stage === "IDENTIFY" || snap.po_number !== scenario) {
      return {
        label: `Step 1 · Resolve ${scenario}`,
        run: () =>
          dock.runAction("demo-1", () => dockApi.resolvePo("WF-4471", scenario)),
      };
    }
    if ((snap.revisions?.length ?? 0) === 0) {
      const draftBody =
        scenario === "PO-4472"
          ? { cartons: 9, loose_pieces: 10, pack_unit: "peti", transcript: "PO-4472 expired check" }
          : {
              cartons: 11,
              loose_pieces: 18,
              pack_unit: dock.activePo?.pack_unit || "peti",
              transcript: "PO 4471 ka gyarah peti aur athara loose hai",
            };
      return {
        label: `Step 2 · Draft Rev 1 (${draftBody.cartons} ${draftBody.pack_unit} + ${draftBody.loose_pieces} loose)`,
        run: () =>
          dock.runAction("demo-2", () =>
            dockApi.draft("WF-4471", { po_number: scenario, ...draftBody })
          ),
      };
    }
    if (scenario === "PO-4471" && snap.write_gate_open && (snap.revisions?.length ?? 0) === 1) {
      return {
        label: "Step 3 · Trigger Barge-In Correction (Pause Gate)",
        run: () => dock.triggerBargeIn("Ruko, eighteen nahi, twenty loose"),
      };
    }
    if (scenario === "PO-4471" && (!snap.write_gate_open || !eligibleRev)) {
      return {
        label: "Step 4 · Record Correction Rev 2 (284 pcs)",
        run: () =>
          dock.runAction("demo-4", () =>
            dockApi.draft("WF-4471", {
              po_number: "PO-4471",
              cartons: 11,
              loose_pieces: 20,
              pack_unit: "peti",
              transcript: "Ruko, eighteen nahi, twenty loose",
            })
          ),
      };
    }
    return null;
  };

  const scenarioStep = nextDemoStep();
  const claim = snap?.claim_pack ?? null;
  const gstRate = dock.activeSku?.gst_rate_pct ?? 18;
  const poExpectedUnitCost = dock.activeSku?.unit_cost_inr ?? 7000;
  const packUnit = dock.activePo?.pack_unit || "peti";
  const packSize = dock.activeSku?.pack_conversions?.[packUnit] ?? 24;
  const liveCountPreview =
    (Math.max(0, Number.parseInt(manualCartons, 10) || 0) * packSize) +
    Math.max(0, Number.parseInt(manualLoose, 10) || 0);

  const projectedShortValue = eligibleRev?.shortage_value_inr ?? 0;
  const projectedHalfGst = Math.round(projectedShortValue * (gstRate / 2)) / 100;
  const projectedTotalNote = projectedShortValue + projectedHalfGst * 2;

  const isHealthy = dock.health?.status === "ok";
  const rootDataState = !isHealthy && !dock.wsConnected
    ? "degraded"
    : isInterruptedHold
      ? "hold"
      : snap?.grn && !snap.grn.reversed
        ? "commit"
        : snap?.stage === "REVERSED"
          ? "reversed"
          : snap?.stage === "APPROVE"
            ? "approve"
            : snap?.po_number
              ? "reconcile"
              : "identify";

  return (
    <div className="min-h-screen bg-canvas text-ink" data-state={rootDataState}>
      <TopBar
        activeRoute="operations"
        wsConnected={dock.wsConnected}
        liveBackend={dock.liveBackend}
        activeRegion={dock.activeRegion || dock.health?.region || "asia-south1"}
        healthy={isHealthy}
        erpReachable={dock.erpStatus?.reachable}
        meteredInrPerMin={dock.telemetry?.metered_inr_per_min ?? 0}
        turns={dock.telemetry?.turns ?? 0}
        eventCount={snap?.audit_events?.length ?? 0}
        hasProgress={Boolean((snap?.revisions?.length ?? 0) > 0 || snap?.grn)}
        busy={Boolean(dock.busyAction)}
        onOpenTrace={() => setTraceOpen(true)}
        onReset={async () => {
          await dock.runAction("reset", () => dockApi.reset("WF-4471"));
          setApprovalLink(null);
        }}
      />

      <main className="mx-auto max-w-[1440px] space-y-3 px-4 py-3 lg:px-6 lg:py-4">
        {/* Top 4 Warehouse Receiving Metrics First */}
        <TelemetryBar
          snapshot={snap}
          po={dock.activePo}
          sku={dock.activeSku}
          erpStatus={dock.erpStatus}
        />

        {/* 70 / 30 Asymmetric Operations Layout */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          {/* Left 70% Workhorse Ledger & Input */}
          <div className="space-y-3 lg:col-span-8">
            <ReconciliationTable
              snapshot={snap}
              po={dock.activePo}
              sku={dock.activeSku}
              banner={dock.banner}
              onDismissBanner={() => dock.setBanner(null)}
              onJumpToCount={jumpToCount}
            />

            {/* Challan & Document Check + Voice + Numeric Count Composer */}
            <section aria-label="Challan ingestion and count entry" className="app-card p-3.5 space-y-3">
              {/* Row 1: Any-Challan Upload + Live Camera + Document Guard Badge */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
                <div>
                  <h2 className="text-sm font-semibold text-ink">
                    Challan &amp; Document Check
                  </h2>
                  <p className="text-xs text-muted">
                    Upload a supplier GST challan or invoice (PDF/photo). Security screening blocks tampered prompts before draft creation.
                  </p>
                </div>
                {snap?.model_armor_last_check ? (
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
                      snap.model_armor_last_check.safe ? "pill-success" : "pill-danger"
                    }`}
                  >
                    {snap.model_armor_last_check.safe ? (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {snap.model_armor_last_check.safe ? "Challan Screened" : "Injection Blocked"}
                    </span>
                  </span>
                ) : (
                  <span className="pill-neutral inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium">
                    <ShieldCheck className="h-3.5 w-3.5 text-ok-ink" />
                    <span>Document Guard Active</span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void dock.runAction(
                      "ingest-file",
                      () => dockApi.ingestChallan("WF-4471", { file }),
                      (res) => ({
                        kind: "success",
                        code: "CHALLAN_INGESTED",
                        label: "Challan extracted",
                        text: `Verified ${res.snapshot.po_number} (${res.po?.vendor_name}, ${formatCount(res.po?.expected_pieces ?? 0)} pcs expected).`,
                      })
                    );
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={Boolean(dock.busyAction) || isCommitted}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 font-semibold text-ink hover:bg-subtle disabled:opacity-45"
                >
                  <FileUp className="h-3.5 w-3.5 text-muted" />
                  <span>Upload GST Challan (PDF/Photo)</span>
                </button>

                <button
                  type="button"
                  disabled={isCommitted}
                  onClick={() => void dock.toggleCamera(videoRef.current)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium disabled:opacity-45 ${
                    dock.cameraActive
                      ? "border-accent bg-ok-bg text-ok-ink"
                      : "border-line bg-surface text-ink hover:bg-subtle"
                  }`}
                >
                  <Camera className="h-3.5 w-3.5" />
                  <span>{dock.cameraActive ? "Camera Live" : "Live Camera"}</span>
                </button>
              </div>

              {/* Row 2: Dock Count Entry + Voice Controls */}
              <div className="border-t border-line pt-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-ink">
                    Dock Count Entry
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isCommitted}
                      onClick={() => void dock.toggleMic()}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${
                        dock.micActive
                          ? "border border-block-ink/30 bg-block-bg text-block-ink"
                          : isCommitted || eligibleRev || isInterruptedHold
                            ? "border border-line-strong bg-surface text-ink hover:bg-subtle"
                            : "bg-accent text-accent-ink hover:opacity-95"
                      }`}
                    >
                      {dock.micActive ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                      <span>{dock.micActive ? "Mute Mic" : "Voice Count (Hinglish)"}</span>
                    </button>

                    <button
                      type="button"
                      disabled={isCommitted || Boolean(dock.busyAction) || (!eligibleRev && !dock.micActive)}
                      onClick={() => void dock.triggerBargeIn("Ruko, eighteen nahi, twenty loose")}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-warn-ink/30 bg-warn-bg px-3 py-1.5 text-xs font-semibold text-warn-ink hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Hand className="h-3.5 w-3.5" />
                      <span>Stop &amp; Correct</span>
                    </button>
                  </div>
                </div>

                {isCommitted && (
                  <div className="flex items-center gap-2 rounded-lg border border-line bg-subtle/70 px-3 py-2 text-xs font-medium text-muted">
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    <span>Receipt posted to ERPNext · Count capture locked</span>
                  </div>
                )}

                {dock.cameraActive && (
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className="h-44 w-full rounded-lg border border-line bg-black object-cover"
                  />
                )}

                {/* Direct Numeric Cartons + Loose Fields */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (isCommitted) return;
                    const c = Math.max(0, Number.parseInt(manualCartons, 10) || 0);
                    const l = Math.max(0, Number.parseInt(manualLoose, 10) || 0);
                    const targetPo = snap?.po_number || dock.activePo?.po_number || scenario;
                    void dock.runAction("numeric-draft", () =>
                      dockApi.draft("WF-4471", {
                        po_number: targetPo,
                        cartons: c,
                        loose_pieces: l,
                        pack_unit: packUnit,
                        transcript: `Count recorded: ${c} ${packUnit}, ${l} loose`,
                      })
                    );
                  }}
                  className="grid grid-cols-1 gap-2.5 rounded-lg border border-line bg-subtle/40 p-3 text-xs sm:grid-cols-4"
                >
                  <label className="space-y-1">
                    <span className="block text-[11px] font-medium text-muted">
                      Packed {packUnit} (× {packSize})
                    </span>
                    <input
                      ref={cartonsInputRef}
                      type="number"
                      min={0}
                      disabled={isCommitted}
                      value={manualCartons}
                      onChange={(e) => setManualCartons(e.target.value)}
                      className="app-field numeral w-full px-2.5 py-1.5 text-sm disabled:opacity-55"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] font-medium text-muted">Loose pieces</span>
                    <input
                      type="number"
                      min={0}
                      disabled={isCommitted}
                      value={manualLoose}
                      onChange={(e) => setManualLoose(e.target.value)}
                      className="app-field numeral w-full px-2.5 py-1.5 text-sm disabled:opacity-55"
                    />
                  </label>
                  <div className="space-y-1">
                    <span className="block text-[11px] font-medium text-muted">
                      {isInterruptedHold || !eligibleRev ? "Draft total" : "Calculated total"}
                    </span>
                    <div className="numeral flex h-[34px] items-center rounded-lg border border-line bg-canvas px-2.5 font-semibold text-ink">
                      {formatCount(liveCountPreview)} pcs
                    </div>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      disabled={isCommitted || Boolean(dock.busyAction)}
                      className={`h-[34px] w-full rounded-lg px-3 font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${
                        isInterruptedHold && !isCommitted
                          ? "bg-accent text-accent-ink hover:opacity-95"
                          : "border border-line-strong bg-surface text-ink hover:bg-subtle"
                      }`}
                    >
                      {isInterruptedHold ? "Save Corrected Count" : "Save Count"}
                    </button>
                  </div>
                </form>

                {(dock.agentTranscript || eligibleRev?.spoken_transcript) && (
                  <div className="rounded-lg border border-line bg-subtle/60 px-3.5 py-2.5 text-xs">
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

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setVoiceDemoOpen((v) => !v)}
                    className="inline-flex items-center gap-1 font-medium text-muted hover:text-ink"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${voiceDemoOpen ? "rotate-180" : ""}`}
                    />
                    <span>Hinglish Turn Input &amp; Guided Walkthrough ({scenario})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSandboxTestsOpen((v) => !v)}
                    className="inline-flex items-center gap-1 font-medium text-muted hover:text-ink"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${sandboxTestsOpen ? "rotate-180" : ""}`}
                    />
                    <span>Sandbox &amp; Security Tests (Demo)</span>
                  </button>
                </div>

                {voiceDemoOpen && (
                  <div className="space-y-2.5 rounded-lg border border-line bg-subtle/30 p-3 text-xs">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void dock.sendTextTurn(utterance);
                      }}
                      className="flex gap-2"
                    >
                      <input
                        value={utterance}
                        onChange={(e) => setUtterance(e.target.value)}
                        aria-label="Hinglish voice utterance"
                        className="app-field flex-1 px-3 py-1.5 text-xs"
                      />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>Send Turn</span>
                      </button>
                    </form>
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {(["PO-4471", "PO-4472"] as const).map((sc) => (
                          <button
                            key={sc}
                            type="button"
                            onClick={() => setScenario(sc)}
                            className={`rounded-md px-2.5 py-1 font-medium ${
                              scenario === sc
                                ? "border border-line bg-subtle text-ink shadow-sm"
                                : "text-muted hover:text-ink"
                            }`}
                          >
                            {sc === "PO-4471" ? "PO-4471 Standard" : "PO-4472 Expired e-Way"}
                          </button>
                        ))}
                      </div>
                      {scenarioStep && (
                        <button
                          type="button"
                          disabled={Boolean(dock.busyAction)}
                          onClick={() => void scenarioStep.run()}
                          className="rounded-lg border border-line-strong bg-surface px-3 py-1 font-semibold text-ink hover:bg-subtle disabled:opacity-50"
                        >
                          {scenarioStep.label}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {sandboxTestsOpen && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line bg-subtle/30 p-3 text-xs">
                    <button
                      type="button"
                      disabled={Boolean(dock.busyAction)}
                      onClick={() =>
                        void dock.runAction(
                          "ingest-kaveri",
                          () => dockApi.ingestChallan("WF-4471", { fixtureId: "alt-kaveri" }),
                          (res) => ({
                            kind: "success",
                            code: "CHALLAN_INGESTED",
                            label: "Unfamiliar vendor minted",
                            text: `Minted ${res.snapshot.po_number} (${res.po?.vendor_name}, 8 cartons × 15 = 120 pcs) cleanly.`,
                          })
                        )
                      }
                      className="rounded-lg border border-line bg-surface px-2.5 py-1.5 font-medium text-ink hover:bg-rail-hover disabled:opacity-45"
                    >
                      Test Unfamiliar Kaveri Challan
                    </button>

                    <button
                      type="button"
                      disabled={Boolean(dock.busyAction)}
                      onClick={() =>
                        void dock.runAction("ingest-trap", () =>
                          dockApi.ingestChallan("WF-4471", { fixtureId: "injection-trap" })
                        )
                      }
                      className="rounded-lg border border-block-ink/25 bg-block-bg px-2.5 py-1.5 font-medium text-block-ink hover:opacity-90 disabled:opacity-45"
                    >
                      Test Injection Trap (Model Armor)
                    </button>

                    <a
                      href={dockApi.fixturePdfUrl("standard")}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 font-medium text-muted hover:text-ink"
                    >
                      <Download className="h-3 w-3" />
                      <span>Sample PDF</span>
                    </a>
                  </div>
                )}
              </div>
            </section>

            {/* Secondary Diagnostics: FinOps Cost + 78 dB Acoustic Audit + ERPNext Live Links */}
            <section className="app-card p-4">
              <button
                type="button"
                onClick={() => setDiagnosticsOpen((v) => !v)}
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <div className="text-sm font-semibold text-ink">
                    Voice FinOps Meter, 78 dB Acoustic Filter &amp; ERPNext Ledger Links
                  </div>
                  <div className="text-xs text-muted">
                    Sliding-window prompt cost vs 20K baseline, raw vs denoised replay, and direct ERPNext Stock Ledger links.
                  </div>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted transition-transform ${diagnosticsOpen ? "rotate-180" : ""}`}
                />
              </button>

              {diagnosticsOpen && (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FinOpsChart telemetry={dock.telemetry} liveBackend={dock.liveBackend} />
                    <AudioAuditPanel
                      micActive={dock.micActive}
                      filterMode={dock.filterMode}
                      audioSource={dock.audioSource}
                      liveSnrDb={dock.liveSnrDb}
                      droppedFrames={dock.droppedFrames}
                      snrBeforeDb={dock.telemetry?.snr_before_db ?? null}
                      snrAfterDb={dock.telemetry?.snr_after_db ?? null}
                      hasRawClip={dock.hasRawClip}
                      hasFilteredClip={dock.hasFilteredClip}
                      onToggleMic={() => void dock.toggleMic()}
                      onChangeMode={(m) => void dock.changeFilterMode(m)}
                      onRunSyntheticAudit={() => void dock.runSyntheticAudit()}
                      onPlayClip={(m) => dock.playClip(m)}
                    />
                  </div>
                  {dock.erpStatus?.reachable && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-subtle/40 px-3.5 py-2.5 text-xs">
                      <span className="text-muted">
                        ERPNext Sandbox ({dock.erpStatus.warehouse}) · Balance{" "}
                        <strong className="numeral text-ink">
                          {formatCount(dock.erpStatus.sku24_balance ?? 1000)} pcs
                        </strong>
                      </span>
                      {dock.erpStatus.stock_ledger_url && (
                        <a
                          href={dock.erpStatus.stock_ledger_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
                        >
                          <span>Open ERPNext Stock Ledger</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* Right 30% Decision Inspector & Closed-Loop Settlement */}
          <aside aria-label="Decision inspector" className="space-y-4 lg:col-span-4 lg:sticky lg:top-[68px]">
            {/* Posting & Out-of-Band Supervisor Sign-Off */}
            <section className="app-card p-4 space-y-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-muted" />
                  <h2 className="text-sm font-semibold text-ink">Posting &amp; Sign-Off</h2>
                </div>
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                    gate.tone === "success"
                      ? "pill-success"
                      : gate.tone === "warning"
                        ? "pill-warning"
                        : gate.tone === "danger"
                          ? "pill-danger"
                          : "pill-neutral"
                  }`}
                >
                  {gate.statusLabel}
                </span>
              </div>

              <p className="text-xs leading-relaxed text-muted">{gate.reason}</p>

              {/* Posting Review Summary (consistent lifecycle state, separate shortage & approver) */}
              {(eligibleRev || latestSuperseded) && (
                <div className="rounded-lg border border-line bg-subtle/50 p-3 text-xs space-y-1.5">
                  <div className="font-semibold text-ink">Posting Review Summary</div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted">Active Revision</span>
                    <span className="numeral font-medium text-ink">
                      {eligibleRev
                        ? `Rev ${eligibleRev.revision_id} · ${formatCount(eligibleRev.total_pieces)} pcs`
                        : `None (Rev ${latestSuperseded?.revision_id} superseded)`}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted">Shortage Variance</span>
                    <span className="numeral font-medium text-ink">
                      {eligibleRev
                        ? `${formatCount(eligibleRev.shortage_pieces)} pcs (${formatINR(eligibleRev.shortage_value_inr)})`
                        : "Pending updated count"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted">
                      {snap?.approval ? "Approved By" : "Required Approval"}
                    </span>
                    <span className="text-right font-medium text-ink">
                      {eligibleRev
                        ? eligibleRev.requires_supervisor_approval
                          ? snap?.approval
                            ? `Floor Supervisor (SUP-04) · ${formatIsoShortDateTime(
                                snap.approval.approved_at
                              )}`
                            : "Supervisor (> ₹25,000)"
                          : "Receiver confirmation"
                        : "Corrected count required"}
                    </span>
                  </div>
                </div>
              )}

              {/* Primary Named Action Button */}
              {gate.primaryAction === "confirm" && eligibleRev && (
                <button
                  type="button"
                  disabled={Boolean(dock.busyAction)}
                  onClick={() =>
                    void dock.runAction("confirm", () =>
                      dockApi.confirm("WF-4471", eligibleRev.revision_id)
                    )
                  }
                  className="w-full rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold text-accent-ink hover:opacity-95 disabled:opacity-50"
                >
                  {gate.ctaLabel}
                </button>
              )}

              {gate.primaryAction === "approve" && eligibleRev && (
                <div className="space-y-3">
                  {/* Out-of-Band Supervisor Phone Sign-Off Card */}
                  {approvalLink && (
                    <div className="rounded-lg border border-accent/35 bg-canvas/70 p-3 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2 font-semibold text-ink">
                        <span className="inline-flex items-center gap-1.5">
                          <Smartphone className="h-3.5 w-3.5 text-accent" />
                          <span>Supervisor Phone Sign-Off</span>
                        </span>
                        <span className="pill-warning rounded px-2 py-0.5 text-[11px] font-medium">
                          Expires 30m
                        </span>
                      </div>
                      <div className="flex items-start gap-3">
                        <QrMatrix
                          value={approvalLink.approve_url}
                          size={104}
                          label="Supervisor mobile approval QR"
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <p className="text-xs leading-snug text-muted">
                            Valid only for Rev {approvalLink.revision_id}; any recount invalidates this link.
                          </p>
                          <a
                            href={approvalLink.whatsapp_share_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex w-full items-center justify-center rounded-md bg-accent px-3 py-2 text-xs font-semibold text-accent-ink hover:opacity-95"
                          >
                            Send Sign-Off Link (WhatsApp)
                          </a>
                          <Link
                            href={`/approve/WF-4471?rev=${approvalLink.revision_id}&sig=${encodeURIComponent(
                              approvalLink.sig
                            )}`}
                            className="inline-flex text-[11px] font-medium text-muted underline underline-offset-2 hover:text-ink"
                          >
                            Open Supervisor Sign-Off View
                          </Link>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Explicit Reject / Request Recount (Demoted Secondary) */}
                  {!rejectOpen ? (
                    <button
                      type="button"
                      disabled={Boolean(dock.busyAction)}
                      onClick={() => setRejectOpen(true)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-block-ink underline underline-offset-2 hover:opacity-85 disabled:opacity-45"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Request Recount on Rev {eligibleRev.revision_id}</span>
                    </button>
                  ) : (
                    <div className="rounded-lg border border-block-ink/25 bg-subtle/40 p-2.5 space-y-2 text-xs">
                      <label className="block space-y-1">
                        <span className="font-medium text-muted">Recount note for dock team</span>
                        <input
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="e.g. Re-check open carton 11 loose count"
                          className="app-field w-full px-2.5 py-1.5 text-xs"
                        />
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={Boolean(dock.busyAction)}
                          onClick={async () => {
                            await dock.triggerBargeIn(
                              rejectReason.trim() ||
                                `Supervisor requested recount for Rev ${eligibleRev.revision_id}`
                            );
                            setRejectOpen(false);
                            setRejectReason("");
                          }}
                          className="flex-1 rounded-md border border-block-ink/30 bg-block-bg px-2.5 py-1.5 font-semibold text-block-ink"
                        >
                          Confirm Request Recount
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectOpen(false)}
                          className="rounded-md border border-line px-2.5 py-1.5 text-muted hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Collapsible Authenticated Floor Terminal Override */}
                  <div className="border-t border-line pt-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setTerminalOverrideOpen((v) => !v)}
                      className="inline-flex items-center gap-1 font-medium text-muted hover:text-ink"
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${terminalOverrideOpen ? "rotate-180" : ""}`}
                      />
                      <span>Authenticated Floor Terminal Override</span>
                    </button>
                    {terminalOverrideOpen && (
                      <div className="mt-2.5 space-y-2.5 rounded-lg border border-line bg-subtle/40 p-2.5">
                        <label className="block space-y-1">
                          <span className="text-[11px] font-medium text-muted">
                            Signing as Floor Supervisor ({supervisorBadge.trim() || "SUP-04"}) · Badge ID
                          </span>
                          <input
                            value={supervisorBadge}
                            onChange={(e) => setSupervisorBadge(e.target.value)}
                            className="app-field w-full px-2.5 py-1.5 text-xs"
                          />
                        </label>
                        <HoldActionButton
                          label={gate.ctaLabel}
                          scopeText={`Authorizes Rev ${eligibleRev.revision_id} only; does not post stock to ERPNext yet`}
                          eligibilityKey={`approve-${eligibleRev.revision_id}-${snap?.stage || ""}`}
                          holdMs={800}
                          disabled={Boolean(dock.busyAction) || supervisorBadge.trim().length < 2}
                          tone="primary"
                          onConfirm={async () => {
                            await dock.runAction(
                              "approve",
                              () =>
                                dockApi.approve(
                                  "WF-4471",
                                  eligibleRev.revision_id,
                                  "sup-meera",
                                  "SUPERVISOR",
                                  `Floor Terminal Override (${supervisorBadge.trim()}) approved shortage ${formatCount(
                                    eligibleRev.shortage_pieces
                                  )} pcs`
                                ),
                              () => ({
                                kind: "success",
                                code: "SUPERVISOR_APPROVED",
                                label: "Supervisor authorized",
                                text: `Revision ${eligibleRev.revision_id} unlocked to post to ERPNext.`,
                              })
                            );
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {gate.primaryAction === "commit" && eligibleRev && (
                <HoldActionButton
                  label={gate.ctaLabel}
                  scopeText={`Posts Rev ${eligibleRev.revision_id} (${formatCount(eligibleRev.total_pieces)} pcs) to ERPNext`}
                  eligibilityKey={`commit-${eligibleRev.revision_id}-${snap?.stage || ""}`}
                  holdMs={800}
                  disabled={Boolean(dock.busyAction)}
                  tone="primary"
                  onConfirm={async () => {
                    await dock.runAction(
                      "commit",
                      () =>
                        dockApi.commit(
                          "WF-4471",
                          eligibleRev.revision_id,
                          `grn-rev-${eligibleRev.revision_id}-${Date.now()}`
                        ),
                      () => null
                    );
                  }}
                />
              )}

              {isCommitted && snap?.grn && (
                <div className="space-y-2.5">
                  {snap.grn.erp_url && (
                    <a
                      href={snap.grn.erp_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold text-accent-ink hover:opacity-95"
                    >
                      <span>Open Purchase Receipt in ERPNext</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}

                  {claim && (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <a
                        href={dockApi.tallyXmlUrl("WF-4471")}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-2 font-semibold text-ink hover:bg-subtle"
                      >
                        <Download className="h-3.5 w-3.5 text-muted" />
                        <span>TallyPrime XML</span>
                      </a>
                      <a
                        href={dockApi.debitNotePdfUrl("WF-4471")}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-2 font-semibold text-ink hover:bg-subtle"
                      >
                        <Download className="h-3.5 w-3.5 text-muted" />
                        <span>CGST Rule 53 PDF</span>
                      </a>
                    </div>
                  )}

                  {snap?.driver_gate_pass && (
                    <Link
                      href={`/gate-pass/WF-4471?sig=${encodeURIComponent(snap.driver_gate_pass.sig)}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-ok-ink/25 bg-ok-bg px-3 py-2 text-xs font-semibold text-ok-ink"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Truck className="h-3.5 w-3.5" />
                        <span>Driver Bilingual Gate-Pass (HI/EN)</span>
                      </span>
                      <span>
                        {snap.driver_gate_pass.acknowledged_by_driver ? "Signed" : "Open"}
                      </span>
                    </Link>
                  )}

                  {/* Demoted Secondary Compensating Reversal Disclosure */}
                  <div className="border-t border-line pt-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setReversalOpen((v) => !v)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted hover:text-ink"
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${reversalOpen ? "rotate-180" : ""}`}
                      />
                      <span>Need a compensating reversal?</span>
                    </button>
                    {reversalOpen && (
                      <div className="mt-2.5 space-y-2.5 rounded-lg border border-block-ink/25 bg-subtle/40 p-2.5">
                        <label className="block space-y-1">
                          <span className="text-[11px] font-medium text-muted">
                            Required reversal reason (min 5 chars)
                          </span>
                          <input
                            value={reversalReason}
                            onChange={(e) => setReversalReason(e.target.value)}
                            placeholder="e.g. Wrong PO matched on unloading sheet"
                            className="app-field w-full px-2.5 py-1.5 text-xs"
                          />
                        </label>
                        <HoldActionButton
                          label={`Reverse ${snap.grn.erp_receipt_id || snap.grn.grn_id}`}
                          holdHint="Hold 1.5s"
                          scopeText="Cancels the ERPNext Purchase Receipt and restores opening balance"
                          eligibilityKey={`reverse-${snap.grn.grn_id}-${snap?.stage || ""}`}
                          holdMs={1500}
                          disabled={Boolean(dock.busyAction) || reversalReason.trim().length < 5}
                          tone="danger"
                          onConfirm={async () => {
                            await dock.runAction("reverse", () =>
                              dockApi.reverse("WF-4471", reversalReason.trim())
                            );
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {gate.primaryAction === "none" && (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    disabled
                    className="w-full cursor-not-allowed rounded-lg border border-line bg-subtle/60 px-4 py-2.5 text-xs font-medium text-muted opacity-55"
                  >
                    {gate.ctaLabel}
                  </button>
                  <p className="text-center text-xs text-muted">{gate.ctaHint}</p>
                </div>
              )}
            </section>

            {/* Policy SOP Citation Card */}
            <section className="app-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">Receiving Policy</h2>
                <span className="pill-neutral rounded px-2 py-0.5 text-[11px] font-medium">
                  {snap && snap.citations.length > 0
                    ? `${labelFor(
                        RAG_BACKEND_LABELS,
                        snap.citations[snap.citations.length - 1].source_backend,
                        "Local SOP index"
                      )} · ${snap.citations.length} matched`
                    : labelFor(RAG_BACKEND_LABELS, dock.health?.rag_backend, "Local SOP index")}
                </span>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void dock.runSopQuery(sopQuery);
                }}
                className="flex gap-2"
              >
                <input
                  value={sopQuery}
                  onChange={(e) => setSopQuery(e.target.value)}
                  aria-label="Search receiving SOP"
                  className="app-field min-w-0 flex-1 px-2.5 py-1.5 text-xs"
                />
                <button
                  type="submit"
                  disabled={Boolean(dock.busyAction)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-subtle disabled:opacity-45"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>Look up SOP</span>
                </button>
              </form>

              {snap && snap.citations.length > 0 ? (
                <div className="space-y-2">
                  {(() => {
                    const supCit = eligibleRev?.requires_supervisor_approval
                      ? snap.citations.find((c) => c.doc_id === "SOP-RCV-002")
                      : undefined;
                    const displayCits = supCit ? [supCit] : snap.citations.slice(-1);
                    return displayCits;
                  })().map((c) => {
                    const parts = c.excerpt.split("INR 25,000");
                    return (
                      <div
                        key={`${c.doc_id}-${c.clause}`}
                        className="rounded-lg border border-line bg-subtle/50 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2 font-semibold text-ink">
                          <span>
                            {c.doc_id} · {c.clause}
                          </span>
                          <span className="text-[11px] font-normal text-faint">{c.revision}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-faint">
                          {c.title} · Effective {c.effective_date}
                        </div>
                        <p className="mt-1.5 leading-relaxed text-muted">
                          {parts.length > 1 ? (
                            <>
                              {parts[0]}
                              <span className="rounded bg-warn-bg px-1 py-0.5 font-semibold text-warn-ink">
                                ₹25,000
                              </span>
                              {parts.slice(1).join("₹25,000")}
                            </>
                          ) : (
                            c.excerpt
                          )}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-faint">
                  Run a policy lookup to cite the governing clause.
                </p>
              )}
            </section>

            {/* GST Commercial Shortage Claim + TallyPrime XML + CGST Rule 53 PDF + Driver Gate-Pass */}
            <section className="app-card p-4 space-y-3 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted" />
                  <h2 className="text-sm font-semibold text-ink">
                    GST Debit Note &amp; Accounting
                  </h2>
                </div>
                <span className="pill-neutral rounded px-2 py-0.5 text-[11px] font-medium">
                  {claim
                    ? labelFor(CLAIM_STATUS_LABELS, claim.status, "Draft debit note")
                    : snap?.grn
                      ? "No debit note"
                      : "Pre-commit"}
                </span>
              </div>

              {claim ? (
                <div className="space-y-2.5 min-w-0">
                  <div className="space-y-1.5 rounded-lg border border-line bg-subtle/40 p-3 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">Claim Reference</span>
                      <span className="numeral font-semibold text-ink">{claim.claim_id}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">
                        Taxable ({formatCount(claim.short_pieces)} × {formatINR(claim.unit_cost_inr)})
                      </span>
                      <span className="numeral font-medium text-ink">
                        {formatINR(claim.taxable_shortage_inr, { decimals: 2 })}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">CGST + SGST ({gstRate}%)</span>
                      <span className="numeral text-ink">
                        {formatINR(claim.cgst_inr + claim.sgst_inr, { decimals: 2 })}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2 border-t border-line pt-2 text-sm font-semibold text-ink">
                      <span>Total Debit Note</span>
                      <span className="numeral">
                        {formatINR(claim.total_debit_note_inr, { decimals: 2 })}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <a
                      href={dockApi.tallyXmlUrl("WF-4471")}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-2 font-semibold text-ink hover:bg-subtle"
                    >
                      <Download className="h-3.5 w-3.5 text-muted" />
                      <span>TallyPrime XML</span>
                    </a>
                    <a
                      href={dockApi.debitNotePdfUrl("WF-4471")}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-2 font-semibold text-ink hover:bg-subtle"
                    >
                      <Download className="h-3.5 w-3.5 text-muted" />
                      <span>CGST Rule 53 PDF</span>
                    </a>
                  </div>

                  {snap?.driver_gate_pass && (
                    <Link
                      href={`/gate-pass/WF-4471?sig=${encodeURIComponent(
                        snap.driver_gate_pass.sig
                      )}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-ok-ink/25 bg-ok-bg px-3 py-2 text-xs font-semibold text-ok-ink"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Truck className="h-3.5 w-3.5" />
                        <span>Driver Bilingual Gate-Pass (HI/EN)</span>
                      </span>
                      <span>
                        {snap.driver_gate_pass.acknowledged_by_driver ? "Signed" : "Open"}
                      </span>
                    </Link>
                  )}
                </div>
              ) : eligibleRev && eligibleRev.shortage_pieces > 0 ? (
                <div className="rounded-lg border border-dashed border-line p-3 text-xs space-y-1.5 min-w-0">
                  <div className="font-medium text-ink">
                    Projected Debit Note (Post-Commit)
                  </div>
                  <div className="flex justify-between gap-2 text-muted">
                    <span>
                      Taxable ({formatCount(eligibleRev.shortage_pieces)} × {formatINR(poExpectedUnitCost)})
                    </span>
                    <span className="numeral text-ink">{formatINR(projectedShortValue)}</span>
                  </div>
                  <div className="flex justify-between gap-2 text-muted">
                    <span>GST ({gstRate}%)</span>
                    <span className="numeral text-ink">{formatINR(projectedHalfGst * 2)}</span>
                  </div>
                  <div className="flex justify-between gap-2 border-t border-line pt-1.5 font-semibold text-ink">
                    <span>Total Projection</span>
                    <span className="numeral">{formatINR(projectedTotalNote)}</span>
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-faint">
                  {snap?.grn
                    ? "No debit note required for zero-shortage receipt."
                    : "TallyPrime XML & CGST Rule 53 PDF unlock upon GRN commit."}
                </p>
              )}
            </section>
          </aside>
        </div>
      </main>

      <TraceDrawer
        open={traceOpen}
        onClose={() => setTraceOpen(false)}
        snapshot={snap}
        promptCard={dock.promptCard}
        telemetry={dock.telemetry}
        health={dock.health}
        erpStatus={dock.erpStatus}
        wsConnected={dock.wsConnected}
        liveBackend={dock.liveBackend}
        activeRegion={dock.activeRegion || dock.health?.region || "asia-south1"}
        lastHealthCheckedAt={dock.lastHealthCheckedAt}
        snrAfterDb={dock.audioSource !== "idle" ? dock.liveSnrDb ?? dock.telemetry?.snr_after_db ?? null : null}
        snrBeforeDb={dock.audioSource !== "idle" ? dock.telemetry?.snr_before_db ?? null : null}
        busyAction={dock.busyAction}
        onTestStaleCommit={() =>
          void dock.runAction(
            "stale-test",
            () => dockApi.testStaleCommit("WF-4471"),
            (res) => ({
              kind: res.blocked ? "error" : "warn",
              code: res.error_code || "STALE_REVISION",
              label: "Stale revision · HTTP 409",
              text: res.message || "Stale Revision 1 blocked before any write.",
            })
          )
        }
        onTestSelfApprove={() => {
          if (!eligibleRev) return;
          void dock.runAction("self-approve-test", () =>
            dockApi.approve(
              "WF-4471",
              eligibleRev.revision_id,
              "receiver-01",
              "RECEIVER",
              "Self approval check"
            )
          );
        }}
        onTestDuplicateCommit={() =>
          void dock.runAction(
            "dup-test",
            () => dockApi.testDuplicateCommit("WF-4471"),
            (res) => ({
              kind: res.blocked ? "warn" : "success",
              code: "IDEMPOTENT_REPLAY",
              label: "Idempotency check",
              text: res.idempotent_replay
                ? `Returned existing ${res.snapshot.grn?.grn_id}; ERPNext stock held at ${formatCount(
                    res.snapshot.grn?.erp_stock_after ?? res.snapshot.inventory_balance
                  )} pcs.`
                : res.message || "Duplicate retry executed.",
            })
          )
        }
      />
    </div>
  );
}
