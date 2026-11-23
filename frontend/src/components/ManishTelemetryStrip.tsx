"use client";

import React from "react";
import type { HealthResponse, TelemetrySnapshot } from "@/lib/types";

interface ManishTelemetryStripProps {
  telemetry: TelemetrySnapshot | null;
  health: HealthResponse | null;
  wsConnected: boolean;
  liveBackend: string;
}

export function ManishTelemetryStrip({
  telemetry,
  health,
  wsConnected,
  liveBackend,
}: ManishTelemetryStripProps) {
  const meteredMin = telemetry?.metered_inr_per_min ?? 0;
  const naiveMin = telemetry?.shadow_naive_inr_per_min ?? 0;
  const savingsPct =
    naiveMin > 0 ? Math.max(0, Math.round(((naiveMin - meteredMin) / naiveMin) * 100)) : 0;

  return (
    <section
      aria-label="Manish Telemetry Strip"
      className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-900/90 p-3 text-xs md:grid-cols-6"
    >
      <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">Model & Endpoint</div>
        <div className="mt-1 flex items-center gap-1.5 font-mono font-semibold text-emerald-300">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              wsConnected ? "bg-emerald-400" : "bg-amber-400"
            }`}
          />
          <span>{health?.model || "gemini-3.8-live"}</span>
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-slate-400">
          {health?.region || "asia-south1"} | {liveBackend || "local_simulator"}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">Prompt Window</div>
        <div className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums">
          {telemetry?.active_prompt_tokens ?? 110} tok
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
          Budget 512 to 1,024 vs {telemetry?.naive_prompt_tokens?.toLocaleString() ?? "20,000"}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">TTFA / Barge Stop</div>
        <div className="mt-1 font-mono text-sm font-semibold text-sky-300 tabular-nums">
          {telemetry?.ttfa_last_ms ? `${telemetry.ttfa_last_ms} ms` : "0 ms"} /{" "}
          {telemetry?.barge_stop_last_ms ? `${telemetry.barge_stop_last_ms} ms` : "0 ms"}
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
          p50 TTFA {telemetry?.ttfa_p50_ms ?? 0} ms | p50 Stop {telemetry?.barge_stop_p50_ms ?? 0} ms
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">Acoustic SNR</div>
        <div className="mt-1 font-mono text-sm font-semibold text-amber-300 tabular-nums">
          {telemetry?.snr_before_db !== null && telemetry?.snr_before_db !== undefined
            ? `${telemetry.snr_before_db} dB`
            : "3.4 dB"}{" "}
          to{" "}
          {telemetry?.snr_after_db !== null && telemetry?.snr_after_db !== undefined
            ? `${telemetry.snr_after_db} dB`
            : "16.9 dB"}
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
          Filter: {telemetry?.noise_filter_mode ?? "raw"} | Dropped: {telemetry?.dropped_audio_frames ?? 0}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">DockPilot Metered</div>
        <div className="mt-1 font-mono text-sm font-semibold text-emerald-300 tabular-nums">
          INR {meteredMin.toFixed(2)} / min
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
          Session INR {(telemetry?.metered_inr ?? 0).toFixed(2)} ({telemetry?.turns ?? 0} turns)
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">Shadow 20K Naive</div>
        <div className="mt-1 font-mono text-sm font-semibold text-rose-300 tabular-nums">
          INR {naiveMin.toFixed(2)} / min
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-emerald-400 tabular-nums">
          {savingsPct > 0 ? `${savingsPct}% cost saved` : "Pruned FinOps active"}
        </div>
      </div>
    </section>
  );
}
