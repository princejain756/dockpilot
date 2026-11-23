"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileSpreadsheet,
  Lock,
  Play,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Unlock,
} from "lucide-react";
import { AudioAuditWidget } from "@/components/AudioAuditWidget";
import { ManishTelemetryStrip } from "@/components/ManishTelemetryStrip";
import { dockApi } from "@/lib/api";
import { useDockSession } from "@/lib/useDockSession";

const BANNER_STYLES = {
  info: "border-sky-500/40 bg-sky-950/60 text-sky-200",
  success: "border-emerald-500/40 bg-emerald-950/60 text-emerald-200",
  warn: "border-amber-500/40 bg-amber-950/60 text-amber-200",
  error: "border-rose-500/50 bg-rose-950/70 text-rose-200",
} as const;

export default function OperationsCommandCenter() {
  const dock = useDockSession("WF-4471");
  const [utterance, setUtterance] = useState("PO-4471, 11 peti aur 20 loose count hua hai");
  const [sopQuery, setSopQuery] = useState("shortage approval 25000 debit note");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const snap = dock.snapshot;
  const activeRevId = snap?.current_revision_id ?? 1;
  const latestRev = snap?.revisions?.find((r) => r.revision_id === activeRevId) ?? null;

  return (
    <main className="mx-auto flex min-h-screen max-w-[1440px] flex-col gap-3 px-4 py-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/90 px-4 py-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold tracking-tight text-white">
              DockPilot Command Center
            </h1>
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-300">
              PS 02: Gemini Enterprise
            </span>
            <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
              WF-4471 | Stage: {snap?.stage ?? "IDENTIFY"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Barge-in safe Hinglish voice + 1 FPS challan receiving with single-store atomic revision lock and GST discrepancy pack.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dock"
            className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25"
          >
            <Smartphone className="h-3.5 w-3.5" />
            Open OnePlus 7 Dock HUD
          </Link>
          <button
            type="button"
            disabled={Boolean(dock.busyAction)}
            onClick={() =>
              void dock.runAction(
                "reset",
                () => dockApi.reset("WF-4471"),
                () => ({
                  kind: "info",
                  code: "DEMO_RESET",
                  text: "Workflow reset to baseline: SKU-24 stock 1,000, stage IDENTIFY.",
                })
              )
            }
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset WF-4471
          </button>
        </div>
      </header>

      <ManishTelemetryStrip
        telemetry={dock.telemetry}
        health={dock.health}
        wsConnected={dock.wsConnected}
        liveBackend={dock.liveBackend}
      />

      {dock.banner && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs ${
            BANNER_STYLES[dock.banner.kind]
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="rounded bg-black/30 px-2 py-0.5 font-mono font-bold">
              {dock.banner.code}
            </span>
            <span>{dock.banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => dock.setBanner(null)}
            className="text-[11px] opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* Column 1: Live Dock Controls, Audio Audit, Prompt Card & RAG */}
        <div className="flex flex-col gap-3 lg:col-span-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">
                Canonical PO-4471 Torture Scenario
              </h2>
              <span className="font-mono text-[11px] text-slate-400">20 SKUs | 10 POs</span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                disabled={Boolean(dock.busyAction)}
                onClick={() =>
                  void dock.runAction(
                    "resolve-po",
                    () => dockApi.resolvePo("WF-4471", "PO-4471"),
                    () => ({
                      kind: "success",
                      code: "PO_RESOLVED",
                      text: "PO-4471 linked to SKU-24 (288 pcs expected, e-Way Bill ACTIVE).",
                    })
                  )
                }
                className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 font-medium text-slate-200 hover:border-emerald-500/60"
              >
                <Play className="h-3 w-3 text-emerald-400" />
                1. Resolve PO-4471
              </button>

              <button
                type="button"
                disabled={Boolean(dock.busyAction)}
                onClick={() =>
                  void dock.runAction(
                    "draft-rev1",
                    () =>
                      dockApi.draft("WF-4471", {
                        po_number: "PO-4471",
                        cartons: 11,
                        loose_pieces: 18,
                        pack_unit: "peti",
                        transcript: "PO 4471 ka gyarah peti aur athara loose hai",
                      }),
                    (res) => ({
                      kind: "info",
                      code: "REV_1_DRAFT",
                      text: `Rev 1 drafted: ${res.snapshot.revisions.at(-1)?.total_pieces ?? 282} pcs (6 short = INR 42,000, >25K HITL).`,
                    })
                  )
                }
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 font-medium text-slate-200 hover:border-sky-500/60"
              >
                2. Draft Rev 1 (282 pcs)
              </button>

              <button
                type="button"
                disabled={Boolean(dock.busyAction)}
                onClick={() => void dock.triggerBargeIn("Ruko, eighteen nahi, twenty loose")}
                className="rounded-lg border border-amber-500/50 bg-amber-500/15 px-2.5 py-2 font-semibold text-amber-200 hover:bg-amber-500/25"
              >
                3. Barge-In (&quot;Ruko 20&quot;)
              </button>

              <button
                type="button"
                disabled={Boolean(dock.busyAction)}
                onClick={() =>
                  void dock.runAction(
                    "draft-rev2",
                    () =>
                      dockApi.draft("WF-4471", {
                        po_number: "PO-4471",
                        cartons: 11,
                        loose_pieces: 20,
                        pack_unit: "peti",
                        transcript: "Ruko, athara nahi bees loose hai, total 284",
                      }),
                    () => ({
                      kind: "success",
                      code: "REV_2_SUPERSEDED_1",
                      text: "Rev 2 minted (284 pcs, 4 short = INR 28,000). Rev 1 permanently SUPERSEDED.",
                    })
                  )
                }
                className="rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-2 font-semibold text-emerald-200 hover:bg-emerald-500/25"
              >
                4. Revise Rev 2 (284 pcs)
              </button>

              <button
                type="button"
                disabled={Boolean(dock.busyAction)}
                onClick={() =>
                  void dock.runAction(
                    "confirm-rev",
                    () => dockApi.confirm("WF-4471", activeRevId),
                    () => ({
                      kind: "success",
                      code: `REV_${activeRevId}_CONFIRMED`,
                      text: `Receiver confirmed Rev ${activeRevId}. Ready for Supervisor check.`,
                    })
                  )
                }
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 font-medium text-slate-200 hover:border-emerald-500/60"
              >
                5. Confirm Rev {activeRevId}
              </button>

              <button
                type="button"
                disabled={Boolean(dock.busyAction)}
                onClick={() =>
                  void dock.runAction(
                    "request-approval",
                    () =>
                      dockApi.requestApproval(
                        "WF-4471",
                        activeRevId,
                        "Shortage INR 28,000 exceeds INR 25,000 policy limit"
                      ),
                    () => ({
                      kind: "info",
                      code: "ROUTED_SUPERVISOR",
                      text: `Rev ${activeRevId} locked and routed to Supervisor Meera.`,
                    })
                  )
                }
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 font-medium text-slate-200 hover:border-sky-500/60"
              >
                6. Route Supervisor
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-800 pt-3 text-[11px]">
              <button
                type="button"
                disabled={Boolean(dock.busyAction)}
                onClick={() => void dock.runAction("exp-eway", () => dockApi.resolvePo("WF-4471", "PO-4472"))}
                className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-rose-200 hover:bg-rose-500/20"
              >
                Edge: Expired e-Way PO-4472
              </button>
              <button
                type="button"
                disabled={Boolean(dock.busyAction)}
                onClick={() => void dock.toggleCamera(videoRef.current)}
                className="flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-200 hover:border-slate-500"
              >
                <Camera className="h-3 w-3 text-sky-400" />
                {dock.cameraActive ? "Stop 1 FPS Camera" : "Start 1 FPS Challan Cam"}
              </button>
            </div>

            {dock.cameraActive && (
              <video
                ref={videoRef}
                muted
                playsInline
                className="mt-2 h-36 w-full rounded-lg border border-slate-700 bg-black object-cover"
              />
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void dock.sendTextTurn(utterance);
              }}
              className="mt-3 flex gap-2"
            >
              <input
                value={utterance}
                onChange={(e) => setUtterance(e.target.value)}
                placeholder="Send Hinglish turn over live WebSocket..."
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
              />
              <button
                type="submit"
                className="flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
              >
                <Send className="h-3 w-3" /> Send
              </button>
            </form>

            {dock.agentTranscript && (
              <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-[11px] text-emerald-300">
                Agent: {dock.agentTranscript}
              </div>
            )}
          </div>

          <AudioAuditWidget
            micActive={dock.micActive}
            filterMode={dock.filterMode}
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

          <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-100">Active Stage Prompt Card</span>
              <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-sky-300">
                {dock.promptCard?.stage ?? "IDENTIFY"} ({dock.promptCard?.approx_tokens ?? 72} tok)
              </span>
            </div>
            <p className="mt-2 rounded-lg border border-slate-800 bg-slate-950/70 p-2.5 font-mono text-[11px] leading-relaxed text-slate-300">
              {dock.promptCard?.text ?? "Loading prompt card..."}
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void dock.runSopQuery(sopQuery);
              }}
              className="mt-3 flex gap-2"
            >
              <input
                value={sopQuery}
                onChange={(e) => setSopQuery(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
              <button
                type="submit"
                className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 hover:border-sky-500"
              >
                <Search className="h-3 w-3" /> Cite SOP
              </button>
            </form>

            {snap && snap.citations.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {snap.citations.slice(-2).map((c) => (
                  <div
                    key={`${c.doc_id}-${c.clause}`}
                    className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-2 text-[11px]"
                  >
                    <div className="font-mono font-semibold text-emerald-300">
                      {c.doc_id} | {c.clause} ({c.source_backend})
                    </div>
                    <div className="mt-0.5 text-slate-300">{c.excerpt}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Column 2: Deterministic Ledger, Fault Injection & GST Claim Pack */}
        <div className="flex flex-col gap-3 lg:col-span-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Atomic Single-Store Ledger</h2>
              <span
                className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
                  snap?.write_gate_open
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-amber-500/20 text-amber-300"
                }`}
              >
                {snap?.write_gate_open ? (
                  <>
                    <Unlock className="h-3 w-3" /> WRITE GATE OPEN
                  </>
                ) : (
                  <>
                    <Lock className="h-3 w-3" /> BARGE-IN LOCKED
                  </>
                )}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  SKU-24 Stock
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-emerald-300 tabular-nums">
                  {snap?.inventory_balance?.toLocaleString() ?? "1,000"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Active Rev</div>
                <div className="mt-1 font-mono text-xl font-bold text-slate-100 tabular-nums">
                  {snap?.current_revision_id ? `Rev ${snap.current_revision_id}` : "None"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  Draft Total
                </div>
                <div className="mt-1 font-mono text-xl font-bold text-sky-300 tabular-nums">
                  {latestRev ? `${latestRev.total_pieces} pcs` : "0 pcs"}
                </div>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <div className="text-xs font-semibold text-slate-300">Revision History</div>
              {(!snap || snap.revisions.length === 0) && (
                <div className="rounded-lg border border-dashed border-slate-800 p-3 text-center text-xs text-slate-500">
                  No count drafts yet. Start step 1 to resolve PO-4471.
                </div>
              )}
              {snap?.revisions.map((rev) => (
                <div
                  key={rev.revision_id}
                  className={`rounded-lg border p-2.5 text-xs ${
                    rev.status === "SUPERSEDED"
                      ? "border-slate-800 bg-slate-950/50 text-slate-400 line-through"
                      : "border-slate-700 bg-slate-950 text-slate-100"
                  }`}
                >
                  <div className="flex items-center justify-between font-mono">
                    <span className="font-semibold">
                      Rev {rev.revision_id}: {rev.cartons} {rev.pack_unit} + {rev.loose_pieces} loose ={" "}
                      {rev.total_pieces} pcs
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        rev.status === "COMMITTED"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : rev.status === "SUPERSEDED"
                          ? "bg-slate-800 text-slate-400"
                          : "bg-sky-500/20 text-sky-300"
                      }`}
                    >
                      {rev.status}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-slate-400 tabular-nums">
                    <span>
                      Shortage: {rev.shortage_pieces} pcs (INR{" "}
                      {rev.shortage_value_inr.toLocaleString()})
                    </span>
                    <span>{rev.requires_supervisor_approval ? "HITL > 25K" : "Under limit"}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldAlert className="h-4 w-4 text-rose-400" />
              Judge Torture-Test Fault Injectors
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Prove deterministic guardrails block stale revisions and duplicate network retries.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={Boolean(dock.busyAction)}
                onClick={() =>
                  void dock.runAction(
                    "stale-test",
                    () => dockApi.testStaleCommit("WF-4471"),
                    (res) => ({
                      kind: res.blocked ? "error" : "warn",
                      code: res.error_code || "STALE_BLOCKED",
                      text:
                        res.message ||
                        "Stale Revision 1 blocked before any inventory write.",
                    })
                  )
                }
                className="rounded-lg border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/25"
              >
                Inject Stale Rev 1 Commit
              </button>

              <button
                type="button"
                disabled={Boolean(dock.busyAction)}
                onClick={() =>
                  void dock.runAction(
                    "dup-test",
                    () => dockApi.testDuplicateCommit("WF-4471"),
                    (res) => ({
                      kind: res.blocked ? "warn" : "success",
                      code: res.idempotent_replay ? "IDEMPOTENT_REPLAY_200" : "DUP_CHECK",
                      text: res.idempotent_replay
                        ? `Duplicate retry returned existing GRN (${res.snapshot.grn?.grn_id}); SKU-24 held cleanly at ${res.snapshot.inventory_balance}.`
                        : res.message || "Executed duplicate check.",
                    })
                  )
                }
                className="rounded-lg border border-sky-500/50 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/25"
              >
                Fire Duplicate Commit Retry
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-white">
                <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                GST & e-Way Discrepancy Pack
              </div>
              <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                {snap?.claim_pack?.status ?? "PENDING COMMIT"}
              </span>
            </div>

            {snap?.claim_pack ? (
              <div className="mt-3 space-y-1.5 rounded-lg border border-emerald-500/30 bg-slate-950/80 p-3 font-mono text-[11px] tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-400">Claim Ref</span>
                  <span className="text-emerald-300">{snap.claim_pack.claim_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">GRN / e-Way Bill</span>
                  <span>
                    {snap.claim_pack.grn_id} | {snap.claim_pack.eway_bill_no}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Vendor GSTIN</span>
                  <span>{snap.claim_pack.vendor_gstin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Taxable Shortage ({snap.claim_pack.short_pieces} pcs)</span>
                  <span>INR {snap.claim_pack.taxable_shortage_inr.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">CGST + SGST (18%)</span>
                  <span>
                    INR {(snap.claim_pack.cgst_inr + snap.claim_pack.sgst_inr).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-800 pt-1.5 text-sm font-bold text-emerald-300">
                  <span>Total Debit Note (DRAFT)</span>
                  <span>INR {snap.claim_pack.total_debit_note_inr.toLocaleString()}</span>
                </div>
                <div className="pt-1 text-[10px] text-slate-500">
                  {snap.claim_pack.synthetic_disclaimer}
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-slate-800 p-3 text-center text-[11px] text-slate-500">
                Auto-generated atomically in the exact commit transaction whenever shortage &gt; 0.
              </div>
            )}
          </div>
        </div>

        {/* Column 3: Supervisor HITL Approval Pane + Immutable Audit Stream */}
        <div className="flex flex-col gap-3 lg:col-span-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Role-Separated Supervisor Pane
              </div>
              <span className="font-mono text-[11px] text-slate-400">sup-meera</span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
              <button
                type="button"
                disabled={Boolean(dock.busyAction)}
                onClick={() =>
                  void dock.runAction("self-approve-test", () =>
                    dockApi.approve(
                      "WF-4471",
                      activeRevId,
                      "receiver-01",
                      "RECEIVER",
                      "Self approval probe"
                    )
                  )
                }
                className="flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-medium text-rose-200 hover:bg-rose-500/20"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Test Receiver Self-Approval (Must 403)
              </button>

              <button
                type="button"
                disabled={Boolean(dock.busyAction)}
                onClick={() =>
                  void dock.runAction(
                    "supervisor-approve",
                    () =>
                      dockApi.approve(
                        "WF-4471",
                        activeRevId,
                        "sup-meera",
                        "SUPERVISOR",
                        "Verified physical count and CH-4471 against SOP-RCV-002 Clause 4"
                      ),
                    () => ({
                      kind: "success",
                      code: "SUPERVISOR_APPROVED",
                      text: `Supervisor Meera approved exact Rev ${activeRevId}. Ready for atomic commit.`,
                    })
                  )
                }
                className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2.5 font-semibold text-white hover:bg-emerald-500"
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve Rev {activeRevId} as Supervisor Meera
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={Boolean(dock.busyAction)}
                  onClick={() =>
                    void dock.runAction(
                      "commit-grn",
                      () => dockApi.commit("WF-4471", activeRevId, `idem-ui-rev-${activeRevId}`),
                      (res) => ({
                        kind: "success",
                        code: "GRN_COMMITTED",
                        text: `Posted ${res.snapshot.grn?.grn_id}: SKU-24 balance is now ${res.snapshot.inventory_balance}.`,
                      })
                    )
                  }
                  className="rounded-lg border border-emerald-500/60 bg-emerald-500/20 px-3 py-2 font-semibold text-emerald-200 hover:bg-emerald-500/30"
                >
                  7. Atomic Commit GRN
                </button>

                <button
                  type="button"
                  disabled={Boolean(dock.busyAction)}
                  onClick={() =>
                    void dock.runAction(
                      "reverse-grn",
                      () => dockApi.reverse("WF-4471", "Demo compensating reversal verification"),
                      (res) => ({
                        kind: "warn",
                        code: "GRN_REVERSED",
                        text: `Compensating reversal posted. SKU-24 restored to ${res.snapshot.inventory_balance}.`,
                      })
                    )
                  }
                  className="rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-2 font-medium text-amber-200 hover:bg-amber-500/25"
                >
                  8. Reverse GRN (-delta)
                </button>
              </div>
            </div>

            {snap?.approval && (
              <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-2.5 text-[11px] text-emerald-200">
                <div className="font-mono font-semibold">
                  {snap.approval.approval_id} | Rev {snap.approval.revision_id} |{" "}
                  {snap.approval.approver_id} ({snap.approval.approver_role})
                </div>
                <div className="mt-0.5 text-slate-300">{snap.approval.reason}</div>
              </div>
            )}
          </div>

          <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/90 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Immutable Audit Stream</h2>
              <span className="font-mono text-[11px] text-slate-400">
                {snap?.audit_events?.length ?? 0} events
              </span>
            </div>
            <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {[...(snap?.audit_events ?? [])].reverse().map((ev) => (
                <div
                  key={ev.event_id}
                  className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 text-[11px]"
                >
                  <div className="flex items-center justify-between gap-2 font-mono">
                    <span
                      className={`font-semibold ${
                        ev.event_type.includes("BLOCKED") || ev.event_type.includes("FORBIDDEN")
                          ? "text-rose-300"
                          : ev.event_type.includes("COMMITTED") || ev.event_type.includes("APPROVED")
                          ? "text-emerald-300"
                          : ev.event_type.includes("BARGE")
                          ? "text-amber-300"
                          : "text-sky-300"
                      }`}
                    >
                      {ev.event_type}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {ev.actor_id} | {ev.revision_id ? `Rev ${ev.revision_id}` : ev.stage}
                    </span>
                  </div>
                  <div className="mt-1 break-all font-mono text-[10px] text-slate-400">
                    {JSON.stringify(ev.detail)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
