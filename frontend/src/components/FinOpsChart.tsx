"use client";

import React from "react";
import type { TelemetrySnapshot } from "@/lib/types";
import { formatINR } from "@/lib/displayLabels";

interface FinOpsChartProps {
  telemetry: TelemetrySnapshot | null;
  liveBackend: string;
}

export function FinOpsChart({ telemetry, liveBackend }: FinOpsChartProps) {
  const turns = telemetry?.turns ?? 0;
  const metered = telemetry?.metered_inr_per_min ?? 0;
  const baseline = telemetry?.shadow_naive_inr_per_min ?? 0;
  const valid =
    turns > 0 &&
    Number.isFinite(metered) &&
    Number.isFinite(baseline) &&
    baseline > 0;

  const maxVal = valid ? Math.max(20, Math.ceil((Math.max(metered, baseline) * 1.1) / 5) * 5) : 20;
  const ticks = [0, maxVal * 0.25, maxVal * 0.5, maxVal * 0.75, maxVal];
  const xStart = 148;
  const plotWidth = 224;
  const dockWidth = valid ? Math.max(2, (metered / maxVal) * plotWidth) : 0;
  const baseWidth = valid ? Math.max(2, (baseline / maxVal) * plotWidth) : 0;
  const savingsPct = valid ? Math.max(0, Math.round(((baseline - metered) / baseline) * 100)) : 0;

  return (
    <section aria-label="FinOps unit economics" className="app-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">FinOps Unit Economics</h3>
          <p className="mt-0.5 text-xs text-muted">
            Staged sub-200-token card rate vs modeled 20K baseline
          </p>
        </div>
        {valid && (
          <span className="pill-success numeral rounded-md px-2 py-0.5 text-xs font-semibold">
            {savingsPct}% lower
          </span>
        )}
      </div>

      {!valid ? (
        <div className="mt-4 rounded-lg border border-dashed border-line bg-subtle/50 px-4 py-6 text-center">
          <div className="text-xs font-medium text-ink">Waiting for metered turns</div>
          <p className="mt-1 text-xs text-faint">
            Voice cost comparison plots real rates once a live audio or text turn completes.
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <svg
            viewBox="0 0 460 112"
            role="img"
            aria-label={`DockPilot staged card ${formatINR(metered, { decimals: 2 })} per minute compared to 20K monolithic baseline ${formatINR(baseline, { decimals: 2 })} per minute`}
            className="h-auto w-full"
          >
            <line x1={xStart} y1={14} x2={xStart} y2={78} stroke="currentColor" className="text-line-strong" strokeWidth="1" />
            <line x1={xStart} y1={78} x2={xStart + plotWidth} y2={78} stroke="currentColor" className="text-line-strong" strokeWidth="1" />

            {ticks.map((tick) => {
              const tx = xStart + (tick / maxVal) * plotWidth;
              return (
                <g key={tick}>
                  <line x1={tx} y1={78} x2={tx} y2={82} stroke="currentColor" className="text-line-strong" strokeWidth="1" />
                  <text
                    x={tx}
                    y={96}
                    textAnchor="middle"
                    className="fill-[var(--text-faint)] font-mono text-[10px]"
                  >
                    ₹{tick.toFixed(0)}
                  </text>
                </g>
              );
            })}

            <text
              x={xStart + plotWidth + 10}
              y={96}
              className="fill-[var(--text-faint)] font-sans text-[10px]"
            >
              ₹/min
            </text>

            <text x={0} y={32} className="fill-[var(--text-ink)] font-sans text-[11px] font-medium">
              DockPilot Staged Card
            </text>
            <rect
              x={xStart}
              y={20}
              width={dockWidth}
              height={16}
              rx={3}
              className="fill-[var(--accent-main)]"
            />
            <text
              x={xStart + plotWidth + 10}
              y={32}
              className="fill-[var(--text-ink)] font-mono text-[11px] font-semibold"
            >
              {formatINR(metered, { decimals: 2 })}
            </text>

            <text x={0} y={62} className="fill-[var(--text-muted)] font-sans text-[11px]">
              20K Monolithic Baseline
            </text>
            <rect
              x={xStart}
              y={50}
              width={baseWidth}
              height={16}
              rx={3}
              className="fill-[var(--border-field)]"
            />
            <text
              x={xStart + plotWidth + 10}
              y={62}
              className="fill-[var(--text-muted)] font-mono text-[11px]"
            >
              {formatINR(baseline, { decimals: 2 })}
            </text>
          </svg>

          <p className="mt-1 text-[11px] text-faint">
            {liveBackend === "vertex_ai"
              ? "Provider usage_metadata metered rate vs modeled 20,000-token baseline."
              : "Simulated session pulse rate vs modeled 20,000-token baseline (Modeled estimate)."}
          </p>
        </div>
      )}
    </section>
  );
}
