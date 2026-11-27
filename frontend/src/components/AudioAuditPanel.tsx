"use client";

import React from "react";
import { Mic, MicOff, Volume2, Waves } from "lucide-react";
import type { NoiseFilterMode } from "@/lib/types";
import type { AudioSourceKind } from "@/lib/useDockSession";

interface AudioAuditPanelProps {
  micActive: boolean;
  filterMode: NoiseFilterMode;
  audioSource: AudioSourceKind;
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

export function AudioAuditPanel({
  micActive,
  filterMode,
  audioSource,
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
}: AudioAuditPanelProps) {
  const hasMeasurements = audioSource !== "idle" && (snrAfterDb !== null || liveSnrDb !== null);
  const rawVal = snrBeforeDb;
  const filteredVal = snrAfterDb ?? liveSnrDb;

  return (
    <section aria-label="Acoustic noise isolation" className="app-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <Waves className="h-4 w-4 text-muted" />
            <h3 className="text-sm font-semibold text-ink">Acoustic Noise Isolation</h3>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Side-by-side 16 kHz capture and denoised speech clarity
          </p>
        </div>
        <span className="pill-neutral rounded-md px-2 py-0.5 text-[11px] font-medium">
          {audioSource === "fixture"
            ? "Controlled fixture"
            : audioSource === "live"
              ? "Live mic"
              : "Awaiting capture"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChangeMode("raw")}
          className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
            filterMode === "raw"
              ? "border-line-strong bg-subtle font-semibold text-ink"
              : "border-line bg-surface text-muted hover:text-ink"
          }`}
        >
          <div>Raw mic stream</div>
          <div className="numeral mt-1 text-sm font-semibold text-ink">
            {hasMeasurements && rawVal !== null ? `${rawVal.toFixed(1)} dB SNR` : "Awaiting capture"}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onChangeMode("web-rnnoise")}
          className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
            filterMode === "web-rnnoise"
              ? "border-accent bg-ok-bg/70 font-semibold text-ink"
              : "border-line bg-surface text-muted hover:text-ink"
          }`}
        >
          <div>120 Hz + NS denoised</div>
          <div className="numeral mt-1 text-sm font-semibold text-ink">
            {hasMeasurements && filteredVal !== null
              ? `${filteredVal.toFixed(1)} dB SNR`
              : "Awaiting capture"}
          </div>
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-faint">
        <span>Active chain: {filterMode === "web-rnnoise" ? "120 Hz + NS" : "Raw feed"}</span>
        <span className="numeral">Dropped frames: {droppedFrames}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onToggleMic}
          className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity ${
            micActive
              ? "border border-block-ink/30 bg-block-bg text-block-ink"
              : "bg-accent text-accent-ink hover:opacity-95"
          }`}
        >
          {micActive ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          <span>{micActive ? "Stop Mic" : "Start 16 kHz Mic"}</span>
        </button>

        <button
          type="button"
          onClick={onRunSyntheticAudit}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink hover:bg-subtle"
        >
          Run 78 dB Dock Fan Fixture
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!hasRawClip}
          onClick={() => onPlayClip("raw")}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Volume2 className="h-3.5 w-3.5 text-muted" />
          <span>Replay raw</span>
        </button>
        <button
          type="button"
          disabled={!hasFilteredClip}
          onClick={() => onPlayClip("web-rnnoise")}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Volume2 className="h-3.5 w-3.5 text-muted" />
          <span>Replay filtered</span>
        </button>
      </div>
    </section>
  );
}
