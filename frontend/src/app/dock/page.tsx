"use client";

import React, { useRef } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, Check, Hand, Mic, MicOff, Waves } from "lucide-react";
import { dockApi } from "@/lib/api";
import { useDockSession } from "@/lib/useDockSession";

export default function MobileDockHud() {
  const dock = useDockSession("WF-4471");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const snap = dock.snapshot;
  const activeRevId = snap?.current_revision_id ?? 1;
  const activeRev = snap?.revisions?.find((r) => r.revision_id === activeRevId) ?? null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 bg-slate-950 px-4 py-4 text-slate-100">
      <header className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2.5">
        <div>
          <div className="text-xs font-mono text-emerald-400">
            ONEPLUS 7 DOCK HUD | {dock.wsConnected ? "LIVE SYNC" : "RECONNECTING"}
          </div>
          <div className="text-base font-bold text-white">
            {snap?.po_number || "PO-4471"} ({snap?.sku_id || "SKU-24"})
          </div>
        </div>
        <Link
          href="/"
          className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Ops
        </Link>
      </header>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Stage: {snap?.stage ?? "IDENTIFY"}</span>
          <span
            className={`font-mono font-bold ${
              snap?.write_gate_open ? "text-emerald-300" : "text-amber-300"
            }`}
          >
            {snap?.write_gate_open ? "GATE OPEN" : "BARGE-IN LOCKED"}
          </span>
        </div>

        <div className="mt-2 font-mono text-3xl font-bold text-white tabular-nums">
          {activeRev ? `${activeRev.total_pieces} pcs` : "Ready"}
        </div>
        <div className="mt-1 text-xs text-slate-300 tabular-nums">
          {activeRev
            ? `Rev ${activeRev.revision_id}: ${activeRev.cartons} ${activeRev.pack_unit} + ${activeRev.loose_pieces} loose | Short ${activeRev.shortage_pieces} (INR ${activeRev.shortage_value_inr.toLocaleString()})`
            : "Tap Mic and speak PO + carton count in Hinglish."}
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-slate-950 p-2 text-center font-mono text-[11px] tabular-nums">
          <div>
            <div className="text-slate-500">Stock</div>
            <div className="font-bold text-emerald-300">
              {snap?.inventory_balance?.toLocaleString() ?? "1,000"}
            </div>
          </div>
          <div>
            <div className="text-slate-500">SNR</div>
            <div className="font-bold text-sky-300">
              {dock.liveSnrDb !== null ? `${dock.liveSnrDb} dB` : `${dock.telemetry?.snr_after_db ?? 16.9} dB`}
            </div>
          </div>
          <div>
            <div className="text-slate-500">INR/min</div>
            <div className="font-bold text-amber-300">
              {(dock.telemetry?.metered_inr_per_min ?? 0).toFixed(2)}
            </div>
          </div>
        </div>
      </section>

      {dock.banner && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-amber-200">
          <span className="font-mono font-bold">{dock.banner.code}: </span>
          {dock.banner.text}
        </div>
      )}

      {dock.agentTranscript && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3 text-sm text-emerald-200">
          {dock.agentTranscript}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        <button
          type="button"
          onClick={() => void dock.toggleMic()}
          className={`flex min-h-[72px] items-center justify-center gap-3 rounded-2xl text-lg font-bold shadow-lg ${
            dock.micActive
              ? "bg-rose-600 text-white active:bg-rose-700"
              : "bg-emerald-600 text-white active:bg-emerald-700"
          }`}
        >
          {dock.micActive ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          {dock.micActive ? "MUTE DOCK MIC" : "START 16KHZ MIC"}
        </button>

        <button
          type="button"
          onClick={() => void dock.triggerBargeIn("Ruko, nineteen nahi, twenty loose")}
          className="flex min-h-[68px] items-center justify-center gap-3 rounded-2xl border-2 border-amber-400 bg-amber-500/20 text-lg font-bold text-amber-100 active:bg-amber-500/35"
        >
          <Hand className="h-6 w-6" />
          BARGE-IN (STOP &amp; CORRECT)
        </button>

        <button
          type="button"
          disabled={!activeRev || Boolean(dock.busyAction)}
          onClick={() =>
            void dock.runAction(
              "mobile-confirm",
              () => dockApi.confirm("WF-4471", activeRevId),
              () => ({
                kind: "success",
                code: "CONFIRMED",
                text: `Confirmed Rev ${activeRevId}.`,
              })
            )
          }
          className="flex min-h-[64px] items-center justify-center gap-2 rounded-2xl bg-sky-600 text-base font-bold text-white disabled:opacity-40 active:bg-sky-700"
        >
          <Check className="h-5 w-5" />
          CONFIRM REV {activeRevId}
        </button>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() =>
              void dock.changeFilterMode(dock.filterMode === "raw" ? "web-rnnoise" : "raw")
            }
            className="flex min-h-[58px] items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200"
          >
            <Waves className="h-4 w-4 text-sky-400" />
            {dock.filterMode === "raw" ? "Filter: RAW" : "Filter: DENOISED"}
          </button>

          <button
            type="button"
            onClick={() => void dock.toggleCamera(videoRef.current)}
            className="flex min-h-[58px] items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200"
          >
            <Camera className="h-4 w-4 text-emerald-400" />
            {dock.cameraActive ? "Stop Challan Cam" : "Challan Cam (1 FPS)"}
          </button>
        </div>
      </div>

      {dock.cameraActive && (
        <video
          ref={videoRef}
          muted
          playsInline
          className="h-48 w-full rounded-xl border border-slate-700 bg-black object-cover"
        />
      )}
    </main>
  );
}
