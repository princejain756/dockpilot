"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

interface HoldActionButtonProps {
  label: string;
  holdHint?: string;
  scopeText: string;
  holdMs?: number;
  disabled?: boolean;
  eligibilityKey: string;
  tone?: "primary" | "warning" | "danger";
  onConfirm: () => Promise<unknown> | void;
}

const TONE_CLASSES: Record<NonNullable<HoldActionButtonProps["tone"]>, string> = {
  primary: "bg-accent text-accent-ink border-transparent hover:opacity-95",
  warning: "bg-warn-bg text-warn-ink border border-line-strong hover:opacity-95",
  danger: "bg-block-bg text-block-ink border border-line-strong hover:opacity-95",
};

export function HoldActionButton({
  label,
  holdHint = "Press & hold 0.8s",
  scopeText,
  holdMs = 800,
  disabled = false,
  eligibilityKey,
  tone = "primary",
  onConfirm,
}: HoldActionButtonProps) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const firedRef = useRef<boolean>(false);

  const cancelHold = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    startRef.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  useEffect(() => {
    cancelHold();
  }, [cancelHold, disabled, eligibilityKey]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const triggerConfirmed = useCallback(async () => {
    if (firedRef.current || submitting || disabled) return;
    firedRef.current = true;
    cancelHold();
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
      firedRef.current = false;
    }
  }, [cancelHold, disabled, onConfirm, submitting]);

  const startHold = useCallback(() => {
    if (disabled || submitting || holding) return;
    firedRef.current = false;
    startRef.current = performance.now();
    setHolding(true);

    const step = (now: number) => {
      if (startRef.current === null) return;
      const elapsed = now - startRef.current;
      const pct = Math.min(100, (elapsed / holdMs) * 100);
      setProgress(pct);
      if (elapsed >= holdMs) {
        void triggerConfirmed();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [disabled, holdMs, holding, submitting, triggerConfirmed]);

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={disabled || submitting}
        aria-disabled={disabled || submitting}
        aria-description="Press and hold button or hold Space or Enter to confirm"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          startHold();
        }}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onBlur={cancelHold}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancelHold();
            return;
          }
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            startHold();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            cancelHold();
          }
        }}
        className={`relative flex w-full select-none items-center justify-between overflow-hidden rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-45 ${TONE_CLASSES[tone]}`}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 bg-black/15 dark:bg-white/20"
          style={{ width: `${progress}%` }}
        />
        <span className="relative z-10">{submitting ? "Posting..." : label}</span>
        <span className="numeral relative z-10 rounded bg-black/15 px-2 py-0.5 text-[11px] font-medium dark:bg-black/25">
          {holding ? `${Math.round(progress)}%` : holdHint}
        </span>
      </button>
      <p className="text-xs leading-snug text-muted">{scopeText}</p>
    </div>
  );
}
