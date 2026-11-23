"use client";

import React from "react";
import { Mic, MicOff, Volume2, Waves } from "lucide-react";
import type { NoiseFilterMode } from "@/lib/types";

interface AudioAuditWidgetProps {
  micActive: boolean;
  filterMode: NoiseFilterMode;
  liveSnrDb: number | null;
  droppedFrames: number;
  snrBeforeDb: number | null;
  snrAfterDb: number | null;
  hasRawClip: boolean;
  hasFilteredClip: boolean;
  onToggleMic: () => void;
  onChangeMode: (mode: NoiseFilterMode) => void;
  onRunSyntheticAudit: () => void;
  onPlayClip: (mode: NoiseFilterMode) => void;
}

export function AudioAuditWidget({
  micActive,
  filterMode,
  liveSnrDb,
  droppedFrames,
  snrBeforeDb,
  snrAfterDb,
  hasRawClip,
  hasFilteredClip,
  onToggleMic,
  onChangeMode,
  onRunSyntheticAudit,
  onPlayClip,
}: AudioAuditWidgetProps) {
  const before = snrBeforeDb ?? 3.4;
  const after = snrAfterDb ?? 16.9;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Waves className="h-4 w-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-slate-100">
            Parallel Raw vs Denoised Audio Audit
          </h2>
        </div>
        <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
          {filterMode}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChangeMode("raw")}
          className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
            filterMode === "raw"
              ? "border-amber-400 bg-amber-500/20 text-amber-200"
              : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
          }`}
        >
          RAW Mic Feed
        </button>
        <button
          type="button"
          onClick={() => onChangeMode("web-rnnoise")}
          className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
            filterMode === "web-rnnoise"
              ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
              : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
          }`}
        >
          Web Denoised (120Hz+NS)
        </button>
      </div>

      <div className="mt-3 space-y-2 rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs">
        <div className="flex items-center justify-between text-slate-300 tabular-nums">
          <span>Raw Dock Floor SNR</span>
          <span className="font-mono text-amber-300">{before.toFixed(1)} dB</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full bg-amber-400 transition-all"
            style={{ width: `${Math.min(100, Math.max(8, (before / 30) * 100))}%` }}
          />
        </div>

        <div className="flex items-center justify-between pt-1 text-slate-300 tabular-nums">
          <span>Filtered Speech SNR</span>
          <span className="font-mono text-emerald-300">{after.toFixed(1)} dB</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full bg-emerald-400 transition-all"
            style={{ width: `${Math.min(100, Math.max(12, (after / 30) * 100))}%` }}
          />
        </div>

        <div className="flex items-center justify-between pt-1 font-mono text-[11px] text-slate-400 tabular-nums">
          <span>Live Stream SNR: {liveSnrDb !== null ? `${liveSnrDb} dB` : "idle"}</span>
          <span>Dropped frames: {droppedFrames}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onToggleMic}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
            micActive
              ? "bg-rose-600 text-white hover:bg-rose-500"
              : "bg-emerald-600 text-white hover:bg-emerald-500"
          }`}
        >
          {micActive ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          {micActive ? "Stop Mic" : "Start 16kHz Mic"}
        </button>

        <button
          type="button"
          onClick={onRunSyntheticAudit}
          className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-xs font-medium text-sky-200 hover:bg-sky-500/25"
        >
          Test 78 dB Dock Noise
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!hasRawClip}
          onClick={() => onPlayClip("raw")}
          className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200 disabled:opacity-40 hover:border-slate-500"
        >
          <Volume2 className="h-3 w-3 text-amber-400" /> Replay Raw Clip
        </button>
        <button
          type="button"
          disabled={!hasFilteredClip}
          onClick={() => onPlayClip("web-rnnoise")}
          className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200 disabled:opacity-40 hover:border-slate-500"
        >
          <Volume2 className="h-3 w-3 text-emerald-400" /> Replay Denoised
        </button>
      </div>
    </div>
  );
}
