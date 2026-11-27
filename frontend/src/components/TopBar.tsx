"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Activity, Moon, RotateCcw, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { formatINR, labelFor, REGION_LABELS } from "@/lib/displayLabels";

interface TopBarProps {
  activeRoute: "operations" | "hud";
  wsConnected: boolean;
  liveBackend: string;
  activeRegion: string;
  healthy: boolean;
  erpReachable?: boolean;
  meteredInrPerMin?: number;
  turns?: number;
  eventCount: number;
  hasProgress: boolean;
  busy: boolean;
  onOpenTrace: () => void;
  onReset: () => Promise<void> | void;
}

export function TopBar({
  activeRoute,
  wsConnected,
  liveBackend,
  activeRegion,
  healthy,
  erpReachable,
  meteredInrPerMin = 0,
  turns = 0,
  eventCount,
  hasProgress,
  busy,
  onOpenTrace,
  onReset,
}: TopBarProps) {
  const { theme, toggleTheme } = useTheme();
  const [confirmReset, setConfirmReset] = useState(false);

  const regionName = labelFor(REGION_LABELS, activeRegion, activeRegion || "Mumbai");
  let statusDot = "bg-amber-500";
  let statusText = "Connecting";
  let statusTone = "text-muted";
  if (!healthy && !wsConnected) {
    statusDot = "bg-block-ink";
    statusText = "Degraded: Gateway offline";
    statusTone = "text-block-ink font-semibold";
  } else if (wsConnected && liveBackend === "vertex_ai") {
    statusDot = "bg-ok-ink";
    statusText = `${regionName} · Gemini 3.8 Live`;
  } else if (wsConnected && liveBackend === "gemini_api") {
    statusDot = "bg-ok-ink";
    statusText = "Gemini 3.8 Live";
  } else if (wsConnected) {
    statusDot = erpReachable ? "bg-ok-ink" : "bg-amber-500";
    statusText = erpReachable ? "ERPNext Sandbox · Voice standby" : "Local simulation";
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-[52px] max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-2 lg:px-6">
        <div className="flex items-center gap-3.5">
          <Link href="/" className="text-[16px] font-semibold tracking-[-0.025em] text-ink">
            DockPilot
          </Link>
          <span className="h-4 w-px bg-line" aria-hidden="true" />
          <div className={`flex items-center gap-2 text-xs font-medium ${statusTone}`}>
            <span className={`inline-block h-2 w-2 rounded-full ${statusDot}`} aria-hidden="true" />
            <span>{statusText}</span>
          </div>
          {activeRoute === "operations" && (
            <span className="hidden rounded-md border border-line bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted lg:inline-flex">
              Receiver · Dock 1
            </span>
          )}
          {turns > 0 && activeRoute === "operations" && (
            <span className="hidden rounded-md border border-line bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted md:inline-flex">
              <span className="numeral text-ink">{formatINR(meteredInrPerMin, { decimals: 2 })}</span>
              <span className="ml-0.5">/min voice</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <nav
            aria-label="Primary surfaces"
            className="inline-flex items-center rounded-lg border border-line bg-subtle p-0.5 text-xs"
          >
            <Link
              href="/"
              aria-current={activeRoute === "operations" ? "page" : undefined}
              className={`inline-flex min-h-[36px] items-center rounded-md px-3 font-medium transition-colors ${
                activeRoute === "operations"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              Operations
            </Link>
            <Link
              href="/dock"
              aria-current={activeRoute === "hud" ? "page" : undefined}
              className={`inline-flex min-h-[36px] items-center rounded-md px-3 font-medium transition-colors ${
                activeRoute === "hud"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              Floor HUD
            </Link>
          </nav>

          {activeRoute === "operations" && (
            <button
              type="button"
              onClick={onOpenTrace}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-subtle"
            >
              <Activity className="h-3.5 w-3.5 text-muted" />
              <span>Audit Log</span>
              <span className="numeral rounded bg-subtle px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                {eventCount}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to Light theme" : "Switch to Dark theme"}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-subtle"
          >
            {theme === "dark" ? (
              <>
                <Sun className="h-3.5 w-3.5 text-muted" />
                <span className="hidden sm:inline">Light</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5 text-muted" />
                <span className="hidden sm:inline">Dark</span>
              </>
            )}
          </button>

          {confirmReset ? (
            <div className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-line-strong bg-subtle px-2 py-1 text-xs">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setConfirmReset(false);
                  await onReset();
                }}
                className="rounded bg-accent px-2 py-1 font-semibold text-accent-ink disabled:opacity-50"
              >
                Confirm Reset
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-1.5 py-1 text-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              aria-label="Reset PO-4471 sandbox workflow"
              onClick={() => {
                if (hasProgress) {
                  setConfirmReset(true);
                } else {
                  void onReset();
                }
              }}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-subtle disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5 text-muted" />
              <span>Reset Sandbox</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
