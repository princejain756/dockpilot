"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Truck } from "lucide-react";
import { dockApi } from "@/lib/api";
import { QrMatrix } from "@/components/QrMatrix";
import { formatCount, formatINR, formatIsoTime } from "@/lib/displayLabels";
import type { DriverGatePass } from "@/lib/types";

export default function DriverGatePassPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-canvas px-4 py-6 text-sm text-muted">
          Loading driver gate pass...
        </main>
      }
    >
      <DriverGatePassInner />
    </Suspense>
  );
}

function DriverGatePassInner() {
  const params = useParams<{ workflowId: string }>();
  const searchParams = useSearchParams();
  const workflowId = decodeURIComponent(params.workflowId || "WF-4471");
  const sigParam = searchParams.get("sig") || "";

  const [gp, setGp] = useState<DriverGatePass | null>(null);
  const [driverName, setDriverName] = useState("Ramesh Kumar");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dockApi
      .gatePass(workflowId)
      .then((res) => setGp(res))
      .catch((err) => setError(err instanceof Error ? err.message : "Gate pass unavailable."))
      .finally(() => setLoading(false));
  }, [workflowId]);

  const handleAcknowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gp) return;
    setBusy(true);
    setError(null);
    try {
      const res = await dockApi.acknowledgeGatePass(workflowId, {
        sig: sigParam || gp.sig,
        driver_name: driverName.trim() || "Transporter",
      });
      if (res.driver_gate_pass) setGp(res.driver_gate_pass);
      else if (res.snapshot.driver_gate_pass) setGp(res.snapshot.driver_gate_pass);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record driver acknowledgment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-canvas px-4 py-6 text-ink">
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-accent" />
            <div>
              <div className="text-xs text-muted">Bilingual Exit Gate Pass</div>
              <h1 className="text-base font-semibold text-ink">
                {gp?.gate_pass_id || `Gate Pass · ${workflowId}`}
              </h1>
            </div>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-subtle"
          >
            Console
          </Link>
        </header>

        {loading && <div className="app-card p-4 text-sm text-muted">Loading gate pass...</div>}
        {error && (
          <div className="rounded-xl border border-block-ink/30 bg-block-bg p-4 text-xs text-block-ink">
            {error}
          </div>
        )}

        {gp && (
          <section className="app-card p-4 space-y-4 text-xs">
            <div>
              <div className="font-semibold text-sm text-ink">{gp.title_hi}</div>
              <p className="mt-1.5 leading-relaxed text-ink">{gp.summary_hi}</p>
              <p className="mt-1.5 leading-relaxed text-muted">{gp.summary_en}</p>
            </div>

            <div className="divide-y divide-line rounded-lg border border-line bg-subtle/40">
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted">Vehicle / Challan</span>
                <span className="numeral font-medium text-ink">
                  {gp.vehicle_no} · {gp.challan_no}
                </span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted">ERPNext Purchase Receipt</span>
                <span className="numeral font-semibold text-ink">
                  {gp.erp_receipt_id || gp.grn_id}
                </span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted">Expected / Received</span>
                <span className="numeral text-ink">
                  {formatCount(gp.expected_pieces)} / {formatCount(gp.received_pieces)} pcs
                </span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted">Recorded Shortage</span>
                <span className="numeral font-semibold text-warn-ink">
                  {formatCount(gp.shortage_pieces)} pcs ({formatINR(gp.shortage_value_inr)})
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas/60 p-3">
              <QrMatrix value={gp.gate_url} size={88} label="Driver gate-pass verification QR" />
              <div className="space-y-1">
                <div className="font-semibold text-ink">Gate Verification Digest</div>
                <div className="font-mono text-[11px] text-muted">{gp.sig}</div>
                <div className="text-[11px] text-faint">
                  Prevents post-delivery quantity disputes after truck exit.
                </div>
              </div>
            </div>

            {gp.acknowledged_by_driver ? (
              <div className="flex items-center gap-2 rounded-xl border border-ok-ink/25 bg-ok-bg p-3 text-ok-ink font-semibold">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  Acknowledged by {gp.driver_name} at {formatIsoTime(gp.acknowledged_at)}
                </span>
              </div>
            ) : (
              <form onSubmit={handleAcknowledge} className="space-y-2.5">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-muted">
                    Driver / Transporter Name (ड्राइवर का नाम)
                  </span>
                  <input
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    className="app-field w-full px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink hover:opacity-95 disabled:opacity-50"
                >
                  Acknowledge Shortage &amp; Issue Exit Pass
                </button>
              </form>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
