"use client";

import React, { useEffect, useRef } from "react";
import { ShieldCheck, X } from "lucide-react";
import type {
  ERPLiveStatus,
  HealthResponse,
  PromptCard,
  TelemetrySnapshot,
  WorkflowSnapshot,
} from "@/lib/types";
import {
  AUDIT_EVENT_LABELS,
  formatActor,
  formatCount,
  formatINR,
  formatIsoTime,
  labelFor,
  LIVE_BACKEND_LABELS,
  RAG_BACKEND_LABELS,
  REGION_LABELS,
  STAGE_LABELS,
  STORAGE_LABELS,
} from "@/lib/displayLabels";

interface TraceDrawerProps {
  open: boolean;
  onClose: () => void;
  snapshot: WorkflowSnapshot | null;
  promptCard: PromptCard | null;
  telemetry: TelemetrySnapshot | null;
  health: HealthResponse | null;
  erpStatus: ERPLiveStatus | null;
  wsConnected: boolean;
  liveBackend: string;
  activeRegion: string;
  lastHealthCheckedAt: string | null;
  snrAfterDb: number | null;
  snrBeforeDb: number | null;
  busyAction?: string | null;
  onTestStaleCommit?: () => void;
  onTestSelfApprove?: () => void;
  onTestDuplicateCommit?: () => void;
}

export function TraceDrawer({
  open,
  onClose,
  snapshot,
  promptCard,
  telemetry,
  health,
  erpStatus,
  wsConnected,
  liveBackend,
  activeRegion,
  lastHealthCheckedAt,
  snrAfterDb,
  snrBeforeDb,
  busyAction,
  onTestStaleCommit,
  onTestSelfApprove,
  onTestDuplicateCommit,
}: TraceDrawerProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const events = [...(snapshot?.audit_events ?? [])].reverse();
  const turns = telemetry?.turns ?? 0;
  const tok = telemetry?.tokens;
  const fmtMod = (val: number | undefined, reported: boolean) =>
    reported && val !== undefined ? formatCount(val) : "Not reported";

  const activeCitations = snapshot?.citations ?? [];
  const lastCitSource =
    activeCitations.length > 0
      ? labelFor(
          RAG_BACKEND_LABELS,
          activeCitations[activeCitations.length - 1].source_backend,
          "Local SOP index"
        )
      : health?.rag_backend
        ? `${labelFor(RAG_BACKEND_LABELS, health.rag_backend, "Local SOP index")} (Configured)`
        : "Unverified";

  const armorCheck = snapshot?.model_armor_last_check;
  const adkTrace = snapshot?.adk_pipeline_trace ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="trace-drawer-title"
        className="flex h-full w-full max-w-[500px] flex-col border-l border-line bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 id="trace-drawer-title" className="text-base font-semibold text-ink">
              Diagnostics, ADK Trace &amp; Telemetry
            </h2>
            <p className="text-xs text-muted">
              {snapshot?.workflow_id || "WF-4471"} · {events.length} immutable{" "}
              {events.length === 1 ? "event" : "events"}
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close Inspect Trace"
            className="rounded-lg border border-line bg-surface p-1.5 text-muted hover:bg-subtle hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-xs">
          {/* Dependency Health */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Enterprise Stack Health
            </h3>
            <div className="mt-2 divide-y divide-line rounded-lg border border-line bg-canvas/60">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted">Cloud Run API</span>
                <span className="font-medium text-ink">
                  {health?.status === "ok"
                    ? `Reachable · ${formatIsoTime(lastHealthCheckedAt)}`
                    : "Unverified"}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted">Voice Gateway</span>
                <span className="font-medium text-ink">
                  {wsConnected
                    ? `${labelFor(LIVE_BACKEND_LABELS, liveBackend, "Local simulation")} · ${labelFor(
                        REGION_LABELS,
                        activeRegion || health?.region,
                        activeRegion || "Mumbai"
                      )}`
                    : "Disconnected"}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted">ERPNext System of Record</span>
                <span className="font-medium text-ink">
                  {erpStatus?.reachable
                    ? `Connected (${erpStatus.latency_ms ?? 0} ms)`
                    : erpStatus?.configured
                      ? "Unreachable"
                      : "Not configured"}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted">Model Armor Guard</span>
                <span className="font-medium text-ink">
                  {health?.model_armor_template || "dockpilot-challan-guard"} (
                  {health?.model_armor_enabled ? health.model_armor_location : "Local parity"})
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted">SOP Retrieval</span>
                <span className="font-medium text-ink">{lastCitSource}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-muted">Ledger Store</span>
                <span className="font-medium text-ink">
                  {labelFor(STORAGE_LABELS, health?.storage_backend, "Local SQLite")}
                </span>
              </div>
            </div>
          </section>

          {/* Voice Telemetry & FinOps Summary */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Voice Telemetry &amp; Acoustic Metrics
            </h3>
            <div className="mt-2 grid grid-cols-3 divide-x divide-line rounded-lg border border-line bg-canvas/60 text-center">
              <div className="px-2.5 py-2.5">
                <div className="text-[11px] text-faint">Voice Rate</div>
                <div className="numeral mt-0.5 font-semibold text-ink">
                  {turns > 0 ? `${formatINR(telemetry?.metered_inr_per_min ?? 0, { decimals: 2 })}/m` : "Idle"}
                </div>
              </div>
              <div className="px-2.5 py-2.5">
                <div className="text-[11px] text-faint">First Audio</div>
                <div className="numeral mt-0.5 font-semibold text-ink">
                  {(telemetry?.ttfa_last_ms ?? 0) > 0 ? `${Math.round(telemetry?.ttfa_last_ms ?? 0)} ms` : "Idle"}
                </div>
              </div>
              <div className="px-2.5 py-2.5">
                <div className="text-[11px] text-faint">120 Hz + NS</div>
                <div className="numeral mt-0.5 font-semibold text-ink">
                  {snrAfterDb !== null
                    ? `${snrAfterDb.toFixed(1)} dB`
                    : "Pending"}
                </div>
                {snrBeforeDb !== null && (
                  <div className="text-[10px] text-faint">Raw {snrBeforeDb.toFixed(1)} dB</div>
                )}
              </div>
            </div>
          </section>

          {/* Vertex AI Model Armor Check */}
          {armorCheck && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Last Model Armor Inspection
              </h3>
              <div
                className={`mt-2 rounded-lg border px-3 py-2.5 ${
                  armorCheck.safe
                    ? "border-ok-ink/25 bg-ok-bg text-ok-ink"
                    : "border-block-ink/25 bg-block-bg text-block-ink"
                }`}
              >
                <div className="flex items-center justify-between font-semibold">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {armorCheck.safe ? "Safe Document (PASS)" : "Prompt Injection Blocked"}
                  </span>
                  <span className="numeral">{armorCheck.latency_ms} ms</span>
                </div>
                <div className="mt-1 text-[11px] opacity-90">
                  Backend: {armorCheck.backend} · Match: {armorCheck.match_state}
                  {armorCheck.findings.length > 0 ? ` · ${armorCheck.findings.join(", ")}` : ""}
                </div>
              </div>
            </section>
          )}

          {/* Google ADK SequentialAgent Pipeline Trace */}
          {adkTrace.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Google ADK Sequential Pipeline ({adkTrace.length} stages)
              </h3>
              <div className="mt-2 space-y-1.5">
                {adkTrace.map((stage) => (
                  <div
                    key={stage.agent}
                    className="rounded-lg border border-line bg-canvas/70 px-3 py-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink">{stage.agent}</span>
                      <span className="numeral text-[11px] text-ok-ink font-medium">
                        {stage.status} · {stage.latency_ms} ms
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">Scope: {stage.role_scope}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Token & Modality Accounting */}
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Modality Token Accounting
              </h3>
              <span className="text-[11px] text-faint">
                {turns > 0 ? `${turns} turns` : "No turns yet"}
              </span>
            </div>
            <div className="mt-2 overflow-hidden rounded-lg border border-line">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-subtle/60 text-[11px] text-muted">
                    <th className="px-3 py-2">Modality</th>
                    <th className="px-3 py-2 text-right">In</th>
                    <th className="px-3 py-2 text-right">Out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <tr>
                    <td className="px-3 py-2 font-medium text-ink">Text</td>
                    <td className="numeral px-3 py-2 text-right text-ink">
                      {fmtMod(tok?.text_in, turns > 0)}
                    </td>
                    <td className="numeral px-3 py-2 text-right text-ink">
                      {fmtMod(tok?.text_out, turns > 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-ink">Audio</td>
                    <td className="numeral px-3 py-2 text-right text-ink">
                      {fmtMod(tok?.audio_in, turns > 0 && (tok?.audio_in ?? 0) > 0)}
                    </td>
                    <td className="numeral px-3 py-2 text-right text-ink">
                      {fmtMod(tok?.audio_out, turns > 0 && (tok?.audio_out ?? 0) > 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-ink">Image</td>
                    <td className="numeral px-3 py-2 text-right text-ink">
                      {fmtMod(tok?.image_in, (tok?.image_in ?? 0) > 0)}
                    </td>
                    <td className="numeral px-3 py-2 text-right text-faint">Not reported</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Active Stage Prompt Card */}
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Active Stage Prompt Card
              </h3>
              <span className="numeral text-[11px] text-faint">
                Approx. {promptCard?.approx_tokens ?? 110} tok
              </span>
            </div>
            <div className="mt-2 rounded-lg border border-line bg-subtle p-3">
              <div className="mb-1 text-[11px] font-semibold text-ink">
                Stage: {labelFor(STAGE_LABELS, promptCard?.stage, "Identify")}
              </div>
              <p className="font-mono text-[11px] leading-relaxed text-muted">
                {promptCard?.text || "Waiting for session prompt card."}
              </p>
            </div>
          </section>

          {/* Guardrail Probes moved out of main sign-off rail */}
          {(onTestStaleCommit || onTestSelfApprove || onTestDuplicateCommit) && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Write-Gate Verification Probes
              </h3>
              <div className="mt-2 grid grid-cols-1 gap-2">
                {onTestStaleCommit && (
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={onTestStaleCommit}
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-left font-medium text-ink hover:bg-subtle disabled:opacity-45"
                  >
                    Inject Stale Rev 1 Commit (Must 409)
                  </button>
                )}
                {onTestSelfApprove && (
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={onTestSelfApprove}
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-left font-medium text-ink hover:bg-subtle disabled:opacity-45"
                  >
                    Test Receiver Self-Approval (Must 403)
                  </button>
                )}
                {onTestDuplicateCommit && (
                  <button
                    type="button"
                    disabled={Boolean(busyAction) || !snapshot?.grn || snapshot.grn.reversed}
                    onClick={onTestDuplicateCommit}
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-left font-medium text-ink hover:bg-subtle disabled:opacity-45"
                  >
                    Replay Duplicate Commit (Idempotency Check)
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Immutable Audit Timeline */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Immutable Audit Log
            </h3>
            <div className="mt-2 space-y-2">
              {events.map((ev) => (
                <div
                  key={ev.event_id}
                  className="rounded-lg border border-line bg-canvas/70 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">
                      {labelFor(AUDIT_EVENT_LABELS, ev.event_type, ev.event_type)}
                    </span>
                    <span className="numeral text-[11px] text-faint">
                      {formatIsoTime(ev.created_at)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                    <span>{formatActor(ev.actor_id, ev.actor_role)}</span>
                    <span>·</span>
                    <span>{labelFor(STAGE_LABELS, ev.stage, ev.stage)}</span>
                    {ev.revision_id !== null && (
                      <>
                        <span>·</span>
                        <span className="numeral">Rev {ev.revision_id}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {events.length === 0 && (
                <p className="text-center text-faint">No audit events recorded yet.</p>
              )}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
