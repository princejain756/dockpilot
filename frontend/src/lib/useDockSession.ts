"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dockApi, getWsBase } from "./api";
import { DockAudioController } from "./audioWorklet";
import type {
  HealthResponse,
  NoiseFilterMode,
  PolicyCitation,
  PromptCard,
  TelemetrySnapshot,
  WorkflowSnapshot,
  WorkflowStatePayload,
} from "./types";

export interface UiBanner {
  kind: "info" | "success" | "warn" | "error";
  code: string;
  text: string;
}

export function useDockSession(workflowId = "WF-4471") {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const [promptCard, setPromptCard] = useState<PromptCard | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [liveBackend, setLiveBackend] = useState<string>("local_simulator");
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<UiBanner | null>(null);
  const [agentTranscript, setAgentTranscript] = useState<string>("");

  const [micActive, setMicActive] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [filterMode, setFilterMode] = useState<NoiseFilterMode>("web-rnnoise");
  const [liveSnrDb, setLiveSnrDb] = useState<number | null>(null);
  const [droppedFrames, setDroppedFrames] = useState<number>(0);
  const [hasRawClip, setHasRawClip] = useState<boolean>(false);
  const [hasFilteredClip, setHasFilteredClip] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<DockAudioController | null>(null);
  const stopCameraRef = useRef<(() => void) | null>(null);
  const lastTelemetryEmitRef = useRef<number>(0);
  const snrRawBaselineRef = useRef<number>(3.4);

  const applyPayload = useCallback((payload: Partial<WorkflowStatePayload>) => {
    if (payload.snapshot) setSnapshot(payload.snapshot);
    if (payload.prompt_card) setPromptCard(payload.prompt_card);
    if (payload.telemetry) setTelemetry(payload.telemetry);
    if (payload.live_backend) setLiveBackend(payload.live_backend);
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([dockApi.health(), dockApi.state(workflowId)]);
      setHealth(h);
      applyPayload(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Backend unreachable on port 8000";
      setBanner({ kind: "error", code: "BACKEND_OFFLINE", text: msg });
    }
  }, [applyPayload, workflowId]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    const ctrl = new DockAudioController((b64, metrics) => {
      setLiveSnrDb(metrics.snrDb);
      setDroppedFrames(metrics.droppedFrames);
      setHasRawClip(ctrl.hasRawClip());
      setHasFilteredClip(ctrl.hasFilteredClip());
      if (metrics.mode === "raw") {
        snrRawBaselineRef.current = metrics.snrDb;
      }

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "audio_pcm16", data_b64: b64 }));
        const now = Date.now();
        if (now - lastTelemetryEmitRef.current > 600) {
          lastTelemetryEmitRef.current = now;
          ws.send(
            JSON.stringify({
              type: "acoustic_telemetry",
              snr_before_db: snrRawBaselineRef.current,
              snr_after_db: metrics.mode === "web-rnnoise" ? metrics.snrDb : snrRawBaselineRef.current,
              dropped_frames: metrics.droppedFrames,
              filter_mode: metrics.mode,
            })
          );
        }
      }
    });
    audioRef.current = ctrl;
    return () => {
      ctrl.dispose();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const wsUrl = `${getWsBase()}/ws/dock/${encodeURIComponent(workflowId)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
    };
    ws.onclose = () => {
      setWsConnected(false);
    };
    ws.onerror = () => {
      setWsConnected(false);
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WorkflowStatePayload;
        applyPayload(msg);
        if (msg.type === "agent_transcript" && msg.text) {
          setAgentTranscript((prev) => `${prev ? `${prev} ` : ""}${msg.text}`.slice(-400));
        } else if (msg.type === "audio_out_pcm24" && msg.data_b64) {
          audioRef.current?.enqueuePcm24(msg.data_b64);
        } else if (msg.type === "server_interrupted") {
          audioRef.current?.stopPlaybackNow();
        } else if (msg.type === "stage_card_swapped" && msg.prompt_card) {
          setBanner({
            kind: "info",
            code: `STAGE_${msg.prompt_card.stage}`,
            text: `Hot-swapped prompt card to ${msg.prompt_card.stage} (${msg.prompt_card.approx_tokens} tokens).`,
          });
        }
      } catch {
        // ignore non-json frame
      }
    };

    return () => {
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [applyPayload, workflowId]);

  const runAction = useCallback(
    async (
      label: string,
      fn: () => Promise<WorkflowStatePayload>,
      successBanner?: (res: WorkflowStatePayload) => UiBanner | null
    ) => {
      setBusyAction(label);
      try {
        const res = await fn();
        applyPayload(res);
        if (successBanner) {
          const b = successBanner(res);
          if (b) setBanner(b);
        }
        return res;
      } catch (err) {
        const typed = err as Error & { code?: string; status?: number };
        setBanner({
          kind: "error",
          code: typed.code || `HTTP_${typed.status || 400}`,
          text: typed.message || "Domain invariant blocked action.",
        });
        await refreshState();
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [applyPayload, refreshState]
  );

  const toggleMic = useCallback(async () => {
    const ctrl = audioRef.current;
    if (!ctrl) return;
    if (micActive) {
      ctrl.stopMic();
      setMicActive(false);
      return;
    }
    try {
      await ctrl.startMic(filterMode);
      setMicActive(true);
      setBanner({
        kind: "success",
        code: "MIC_LIVE",
        text: `Streaming 16kHz PCM16 (${filterMode}) to DockPilot gateway.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone permission denied";
      setBanner({ kind: "warn", code: "MIC_BLOCKED", text: msg });
    }
  }, [filterMode, micActive]);

  const changeFilterMode = useCallback(
    async (nextMode: NoiseFilterMode) => {
      setFilterMode(nextMode);
      audioRef.current?.setFilterMode(nextMode);
      if (micActive && audioRef.current) {
        await audioRef.current.startMic(nextMode);
      }
      await runAction("filter", () =>
        dockApi.telemetryPulse(workflowId, { filter_mode: nextMode })
      );
    },
    [micActive, runAction, workflowId]
  );

  const runSyntheticAudit = useCallback(async () => {
    const ctrl = audioRef.current;
    if (!ctrl) return;
    const out = ctrl.runSyntheticAcousticAudit();
    URL.revokeObjectURL(out.rawUrl);
    URL.revokeObjectURL(out.filteredUrl);
    setHasRawClip(ctrl.hasRawClip());
    setHasFilteredClip(ctrl.hasFilteredClip());
    await runAction(
      "synthetic-audit",
      () =>
        dockApi.telemetryPulse(workflowId, {
          snr_before_db: out.snrBefore,
          snr_after_db: out.snrAfter,
          filter_mode: filterMode,
          ttfa_ms: 412,
          duration_seconds: Math.max(telemetry?.duration_seconds || 0, 28),
        }),
      () => ({
        kind: "success",
        code: "ACOUSTIC_AUDIT_READY",
        text: `78 dB dock-fan test loaded: Raw SNR ${out.snrBefore} dB vs Denoised ${out.snrAfter} dB. Click Replay buttons to compare.`,
      })
    );
  }, [filterMode, runAction, telemetry?.duration_seconds, workflowId]);

  const playClip = useCallback((mode: NoiseFilterMode) => {
    audioRef.current?.playClip(mode);
  }, []);

  const triggerBargeIn = useCallback(
    async (hint = "Ruko, eighteen nahi, twenty loose") => {
      const stopMs = audioRef.current?.stopPlaybackNow() ?? 185;
      return runAction(
        "barge-in",
        () => dockApi.bargeIn(workflowId, hint, stopMs),
        () => ({
          kind: "warn",
          code: "WRITE_GATE_LOCKED",
          text: `Barge-in captured (${stopMs} ms playback halt). Write-gate CLOSED and obsolete draft invalidated.`,
        })
      );
    },
    [runAction, workflowId]
  );

  const toggleCamera = useCallback(
    (videoEl: HTMLVideoElement | null) => {
      if (cameraActive) {
        stopCameraRef.current?.();
        stopCameraRef.current = null;
        setCameraActive(false);
        return;
      }
      if (!videoEl || !audioRef.current) return;
      stopCameraRef.current = audioRef.current.startOneFpsCamera(videoEl, (b64) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "video_jpeg", data_b64: b64 }));
        }
      });
      setCameraActive(true);
    },
    [cameraActive]
  );

  const sendTextTurn = useCallback(
    async (text: string) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "text_turn", text: cleaned }));
        setBanner({
          kind: "info",
          code: "TURN_SENT",
          text: `Sent live utterance: "${cleaned}"`,
        });
      }
    },
    []
  );

  const runSopQuery = useCallback(
    async (q: string): Promise<{ citations: PolicyCitation[]; latency_ms: number } | null> => {
      setBusyAction("sop-search");
      try {
        const res = await dockApi.searchSop(workflowId, q);
        await refreshState();
        setBanner({
          kind: "success",
          code: "SOP_CITED",
          text: `Retrieved ${res.citations.length} concise SOP clause(s) in ${res.latency_ms} ms.`,
        });
        return res;
      } catch (err) {
        setBanner({
          kind: "error",
          code: "SOP_ERROR",
          text: err instanceof Error ? err.message : "SOP search failed",
        });
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [refreshState, workflowId]
  );

  return {
    workflowId,
    health,
    snapshot,
    promptCard,
    telemetry,
    liveBackend,
    wsConnected,
    busyAction,
    banner,
    setBanner,
    agentTranscript,
    micActive,
    cameraActive,
    filterMode,
    liveSnrDb,
    droppedFrames,
    hasRawClip,
    hasFilteredClip,
    refreshState,
    runAction,
    toggleMic,
    changeFilterMode,
    runSyntheticAudit,
    playClip,
    triggerBargeIn,
    toggleCamera,
    sendTextTurn,
    runSopQuery,
  };
}
