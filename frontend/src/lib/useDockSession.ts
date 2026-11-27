"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dockApi, getWsBase } from "./api";
import { DockAudioController } from "./audioWorklet";
import { ERROR_CODE_LABELS, labelFor } from "./displayLabels";
import type {
  CatalogResponse,
  ERPLiveStatus,
  HealthResponse,
  NoiseFilterMode,
  PolicyCitation,
  PromptCard,
  PurchaseOrder,
  SKU,
  TelemetrySnapshot,
  WorkflowSnapshot,
  WorkflowStatePayload,
} from "./types";

export type AudioSourceKind = "idle" | "live" | "fixture";

export interface UiBanner {
  kind: "info" | "success" | "warn" | "error";
  code: string;
  label: string;
  text: string;
}

export function useDockSession(workflowId = "WF-4471") {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [erpStatus, setErpStatus] = useState<ERPLiveStatus | null>(null);
  const [payloadPo, setPayloadPo] = useState<PurchaseOrder | null>(null);
  const [payloadSku, setPayloadSku] = useState<SKU | null>(null);
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const [promptCard, setPromptCard] = useState<PromptCard | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [liveBackend, setLiveBackend] = useState<string>("local_simulator");
  const [activeRegion, setActiveRegion] = useState<string>("");
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [lastHealthCheckedAt, setLastHealthCheckedAt] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<UiBanner | null>(null);
  const [agentTranscript, setAgentTranscript] = useState<string>("");
  const [transcriptAt, setTranscriptAt] = useState<string | null>(null);

  const [micActive, setMicActive] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [filterMode, setFilterMode] = useState<NoiseFilterMode>("web-rnnoise");
  const [audioSource, setAudioSource] = useState<AudioSourceKind>("idle");
  const [liveSnrDb, setLiveSnrDb] = useState<number | null>(null);
  const [droppedFrames, setDroppedFrames] = useState<number>(0);
  const [hasRawClip, setHasRawClip] = useState<boolean>(false);
  const [hasFilteredClip, setHasFilteredClip] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<DockAudioController | null>(null);
  const stopCameraRef = useRef<(() => void) | null>(null);
  const lastTelemetryEmitRef = useRef<number>(0);
  const snrRawBaselineRef = useRef<number | null>(null);

  const applyPayload = useCallback((payload: Partial<WorkflowStatePayload>) => {
    if (payload.snapshot) setSnapshot(payload.snapshot);
    if (payload.prompt_card) setPromptCard(payload.prompt_card);
    if (payload.telemetry) setTelemetry(payload.telemetry);
    if (payload.live_backend) setLiveBackend(payload.live_backend);
    if (payload.region) setActiveRegion(payload.region);
    if (payload.po) setPayloadPo(payload.po);
    if (payload.sku) setPayloadSku(payload.sku);
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const [h, s, c, erp] = await Promise.all([
        dockApi.health(),
        dockApi.state(workflowId),
        dockApi.catalog().catch(() => null),
        dockApi.erpLiveStatus().catch(() => null),
      ]);
      setHealth(h);
      if (h.region) {
        setActiveRegion((prev) => prev || h.region);
      }
      if (c) setCatalog(c);
      if (erp) setErpStatus(erp);
      setLastHealthCheckedAt(new Date().toISOString());
      applyPayload(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Backend gateway unreachable.";
      setBanner({
        kind: "error",
        code: "BACKEND_OFFLINE",
        label: labelFor(ERROR_CODE_LABELS, "backend_offline", "Gateway unreachable"),
        text: msg,
      });
    }
  }, [applyPayload, workflowId]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    const ctrl = new DockAudioController((b64, metrics) => {
      setAudioSource("live");
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
          const rawBaseline = snrRawBaselineRef.current ?? metrics.snrDb;
          ws.send(
            JSON.stringify({
              type: "acoustic_telemetry",
              snr_before_db: rawBaseline,
              snr_after_db: metrics.mode === "web-rnnoise" ? metrics.snrDb : rawBaseline,
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
        if (msg.type === "region_failover" && msg.region) {
          setActiveRegion(msg.region);
          setBanner({
            kind: "warn",
            code: "REGION_FAILOVER",
            label: "Region failover",
            text: `Primary region switched to ${msg.region} for uninterrupted Live stream.`,
          });
        } else if (msg.type === "agent_transcript" && msg.text) {
          setAgentTranscript((prev) => `${prev ? `${prev} ` : ""}${msg.text}`.slice(-400));
          setTranscriptAt(new Date().toISOString());
        } else if (msg.type === "audio_out_pcm24" && msg.data_b64) {
          audioRef.current?.enqueuePcm24(msg.data_b64);
        } else if (msg.type === "server_interrupted") {
          audioRef.current?.stopPlaybackNow();
        } else if (msg.type === "stage_card_swapped" && msg.prompt_card) {
          setBanner({
            kind: "info",
            code: "STAGE_CARD_SWAPPED",
            label: "Prompt stage updated",
            text: `Context window updated to ${msg.prompt_card.stage.toLowerCase()} guidance (approx. ${msg.prompt_card.approx_tokens} tokens).`,
          });
        }
      } catch {
        // Ignore malformed non-JSON frame
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
        if (res.snapshot?.grn || res.type === "workflow_reset" || res.type === "grn_reversed") {
          dockApi.erpLiveStatus().then(setErpStatus).catch(() => {});
        }
        if (successBanner) {
          const b = successBanner(res);
          if (b) setBanner(b);
        }
        return res;
      } catch (err) {
        const typed = err as Error & { code?: string; status?: number };
        const rawCode = typed.code || `HTTP_${typed.status || 400}`;
        setBanner({
          kind: "error",
          code: rawCode,
          label: labelFor(
            ERROR_CODE_LABELS,
            rawCode,
            typed.status ? `Request blocked (HTTP ${typed.status})` : "Action blocked"
          ),
          text: typed.message || "Policy rule blocked this write action.",
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
      setAudioSource("live");
      setBanner({
        kind: "success",
        code: "MIC_LIVE",
        label: "Microphone live",
        text: `Streaming 16 kHz PCM audio (${filterMode === "web-rnnoise" ? "120 Hz + NS" : "Raw feed"}).`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone permission denied";
      setBanner({
        kind: "warn",
        code: "MIC_BLOCKED",
        label: "Microphone unavailable",
        text: `${msg}. Typed and manual count controls remain active.`,
      });
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
    setAudioSource("fixture");
    await runAction("synthetic-audit", () =>
      dockApi.telemetryPulse(workflowId, {
        snr_before_db: out.snrBefore,
        snr_after_db: out.snrAfter,
        filter_mode: filterMode,
        ttfa_ms: 412,
        duration_seconds: Math.max(telemetry?.duration_seconds || 0, 28),
      })
    );
  }, [filterMode, runAction, telemetry?.duration_seconds, workflowId]);

  const playClip = useCallback((mode: NoiseFilterMode) => {
    audioRef.current?.playClip(mode);
  }, []);

  const triggerBargeIn = useCallback(
    async (hint = "Ruko, eighteen nahi, twenty loose") => {
      const stopMs = audioRef.current?.stopPlaybackNow() ?? 185;
      setBanner(null);
      return runAction("barge-in", () => dockApi.bargeIn(workflowId, hint, stopMs));
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
          label: "Turn sent",
          text: `Sent to live gateway: "${cleaned}"`,
        });
      } else {
        setBanner({
          kind: "warn",
          code: "WS_OFFLINE",
          label: "Socket reconnecting",
          text: "Live audio socket is offline. Use the manual count entry or scenario controls.",
        });
      }
    },
    []
  );

  const runSopQuery = useCallback(
    async (
      q: string,
      opts?: { quiet?: boolean }
    ): Promise<{ citations: PolicyCitation[]; latency_ms: number } | null> => {
      setBusyAction("sop-search");
      try {
        const res = await dockApi.searchSop(workflowId, q);
        await refreshState();
        if (!opts?.quiet) {
          setBanner({
            kind: "success",
            code: "SOP_CITED",
            label: "Policy retrieved",
            text: `Retrieved ${res.citations.length} policy ${res.citations.length === 1 ? "clause" : "clauses"} in ${res.latency_ms} ms.`,
          });
        }
        return res;
      } catch (err) {
        if (!opts?.quiet) {
          setBanner({
            kind: "error",
            code: "SOP_ERROR",
            label: "Policy lookup unavailable",
            text: err instanceof Error ? err.message : "SOP search failed",
          });
        }
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [refreshState, workflowId]
  );

  const activePo: PurchaseOrder | null =
    snapshot?.dynamic_po ??
    (payloadPo && payloadPo.po_number === snapshot?.po_number ? payloadPo : null) ??
    catalog?.pos.find((p) => p.po_number === (snapshot?.po_number || "PO-4471")) ??
    catalog?.pos.find((p) => p.po_number === "PO-4471") ??
    null;

  const activeSku: SKU | null =
    snapshot?.dynamic_sku ??
    (payloadSku && payloadSku.sku_id === (activePo?.sku_id || snapshot?.sku_id) ? payloadSku : null) ??
    catalog?.skus.find((s) => s.sku_id === (activePo?.sku_id || snapshot?.sku_id || "SKU-24")) ??
    catalog?.skus.find((s) => s.sku_id === "SKU-24") ??
    null;

  return {
    workflowId,
    health,
    catalog,
    erpStatus,
    activePo,
    activeSku,
    snapshot,
    promptCard,
    telemetry,
    liveBackend,
    activeRegion,
    wsConnected,
    lastHealthCheckedAt,
    busyAction,
    banner,
    setBanner,
    agentTranscript,
    transcriptAt,
    micActive,
    cameraActive,
    filterMode,
    audioSource,
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
