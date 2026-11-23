"""Gemini 3.8 Live WebSocket gateway + deterministic FSM stage card orchestrator."""

from __future__ import annotations

import asyncio
import base64
import json
import time
from typing import Any

from fastapi import WebSocket
from google import genai
from google.genai import types

from app.config import Settings
from app.ledger import BaseLedgerStore
from app.models import WorkflowSnapshot, WorkflowStage
from app.prompt_cards import get_prompt_card
from app.rag import SOPRetriever
from app.telemetry import FinOpsMeter
from app.tools_adk import DockPilotToolkit, build_tool_declarations


class WorkflowBroadcastHub:
    """Broadcasts authoritative state and telemetry to all connected UI/phone tabs."""

    def __init__(self) -> None:
        self._peers: dict[str, set[WebSocket]] = {}
        self._meters: dict[str, FinOpsMeter] = {}

    def get_meter(self, workflow_id: str, fx: float = 84.50) -> FinOpsMeter:
        if workflow_id not in self._meters:
            self._meters[workflow_id] = FinOpsMeter(fx_inr_per_usd=fx)
        return self._meters[workflow_id]

    def reset_meter(self, workflow_id: str, fx: float = 84.50) -> FinOpsMeter:
        self._meters[workflow_id] = FinOpsMeter(fx_inr_per_usd=fx)
        return self._meters[workflow_id]

    async def register(self, workflow_id: str, ws: WebSocket) -> None:
        self._peers.setdefault(workflow_id, set()).add(ws)

    def unregister(self, workflow_id: str, ws: WebSocket) -> None:
        if workflow_id in self._peers:
            self._peers[workflow_id].discard(ws)

    async def broadcast(self, workflow_id: str, event: dict[str, Any]) -> None:
        peers = list(self._peers.get(workflow_id, set()))
        payload = json.dumps(event)
        for ws in peers:
            try:
                await ws.send_text(payload)
            except Exception:
                self.unregister(workflow_id, ws)


class LiveGatewaySession:
    """Manages one bidirectional DockPilot audio/video/telemetry stream."""

    def __init__(
        self,
        *,
        workflow_id: str,
        settings: Settings,
        ledger: BaseLedgerStore,
        retriever: SOPRetriever,
        hub: WorkflowBroadcastHub,
    ) -> None:
        self.workflow_id = workflow_id
        self.settings = settings
        self.ledger = ledger
        self.retriever = retriever
        self.hub = hub
        self.toolkit = DockPilotToolkit(ledger=ledger, retriever=retriever, workflow_id=workflow_id)
        self.meter = hub.get_meter(workflow_id, fx=settings.fx_inr_per_usd)
        self._last_stage: WorkflowStage = ledger.get_snapshot(workflow_id).stage
        self._updating_context = False
        self._resumption_handle: str | None = None
        self._last_video_sent_ts = 0.0
        self._speech_end_ts: float | None = None
        self._session_started_ts = time.monotonic()

    def _build_client(self) -> tuple[genai.Client, str] | None:
        if self.settings.gcp_project_id:
            client = genai.Client(
                vertexai=True,
                project=self.settings.gcp_project_id,
                location=self.settings.gcp_location,
            )
            return client, self.settings.gemini_live_model
        if self.settings.gemini_api_key:
            client = genai.Client(api_key=self.settings.gemini_api_key)
            return client, self.settings.gemini_live_model
        return None

    def _live_config(self, stage: WorkflowStage) -> types.LiveConnectConfig:
        card = get_prompt_card(stage)
        self.meter.active_prompt_tokens = int(card["approx_tokens"])
        return types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            system_instruction=types.Content(parts=[types.Part(text=str(card["text"]))]),
            tools=[types.Tool(function_declarations=build_tool_declarations())],
            context_window_compression=types.ContextWindowCompressionConfig(
                sliding_window=types.SlidingWindow()
            ),
            session_resumption=types.SessionResumptionConfig(handle=self._resumption_handle),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
        )

    def _dispatch_tool(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        fn = getattr(self.toolkit, name, None)
        if fn is None:
            return {"ok": False, "error_code": "UNKNOWN_TOOL", "message": f"Unknown tool: {name}"}
        return fn(**args)

    async def _maybe_swap_prompt_card(self, live_session: Any, snap: WorkflowSnapshot) -> None:
        if snap.stage == self._last_stage:
            return
        self._last_stage = snap.stage
        card = get_prompt_card(snap.stage)
        self.meter.active_prompt_tokens = int(card["approx_tokens"])
        await self.hub.broadcast(
            self.workflow_id,
            {
                "type": "stage_card_swapped",
                "stage": snap.stage.value,
                "prompt_card": card,
                "snapshot": snap.model_dump(),
                "telemetry": self.meter.snapshot(),
            },
        )
        if live_session is None:
            return
        self._updating_context = True
        try:
            if hasattr(live_session, "send_context_update"):
                await live_session.send_context_update(system_instruction=str(card["text"]))
        except Exception:
            # Never crash live session if model endpoint rejects optional context update
            pass
        finally:
            self._updating_context = False

    async def run_ws(self, ws: WebSocket) -> None:
        """Serve bidirectional audio/control loop over WebSocket."""
        await ws.accept()
        await self.hub.register(self.workflow_id, ws)
        snap = self.ledger.get_snapshot(self.workflow_id)
        await ws.send_text(
            json.dumps(
                {
                    "type": "hello",
                    "workflow_id": self.workflow_id,
                    "live_backend": "vertex_ai" if self.settings.gcp_project_id else ("gemini_api" if self.settings.gemini_api_key else "local_simulator"),
                    "model": self.settings.gemini_live_model,
                    "region": self.settings.gcp_location,
                    "prompt_card": get_prompt_card(snap.stage),
                    "snapshot": snap.model_dump(),
                    "telemetry": self.meter.snapshot(),
                }
            )
        )

        client_tuple = self._build_client()
        try:
            if client_tuple is None:
                await self._run_local_loop(ws)
            else:
                client, model_name = client_tuple
                await self._run_live_loop(ws, client, model_name)
        finally:
            self.hub.unregister(self.workflow_id, ws)

    async def _handle_control_message(self, msg: dict[str, Any], live_session: Any = None) -> None:
        mtype = msg.get("type", "")
        if mtype == "barge_in":
            hint = str(msg.get("transcript_hint", "mid-sentence correction"))
            stop_ms = float(msg.get("stop_latency_ms", 210.0))
            self.meter.record_barge_stop(stop_ms)
            snap = self.ledger.handle_barge_in(self.workflow_id, actor_id="receiver-01", transcript_hint=hint)
            await self.hub.broadcast(
                self.workflow_id,
                {
                    "type": "barge_in_recorded",
                    "stop_latency_ms": stop_ms,
                    "snapshot": snap.model_dump(),
                    "telemetry": self.meter.snapshot(),
                },
            )
            await self._maybe_swap_prompt_card(live_session, snap)
        elif mtype == "acoustic_telemetry":
            self.meter.snr_before_db = msg.get("snr_before_db", self.meter.snr_before_db)
            self.meter.snr_after_db = msg.get("snr_after_db", self.meter.snr_after_db)
            self.meter.dropped_audio_frames = int(msg.get("dropped_frames", self.meter.dropped_audio_frames))
            self.meter.noise_filter_mode = str(msg.get("filter_mode", self.meter.noise_filter_mode))
            self.meter.duration_seconds = max(self.meter.duration_seconds, time.monotonic() - self._session_started_ts)
            await self.hub.broadcast(
                self.workflow_id,
                {"type": "telemetry", "telemetry": self.meter.snapshot()},
            )
        elif mtype == "speech_end":
            self._speech_end_ts = time.monotonic()
        elif mtype == "text_turn" and live_session is not None:
            txt = str(msg.get("text", "")).strip()
            if txt:
                self._speech_end_ts = time.monotonic()
                await live_session.send_client_content(
                    turns=types.Content(role="user", parts=[types.Part(text=txt)]),
                    turn_complete=True,
                )
        elif mtype == "audio_pcm16" and live_session is not None and not self._updating_context:
            raw = base64.b64decode(msg["data_b64"])
            await live_session.send_realtime_input(
                audio=types.Blob(data=raw, mime_type="audio/pcm;rate=16000")
            )
        elif mtype == "video_jpeg" and live_session is not None:
            now = time.monotonic()
            if now - self._last_video_sent_ts >= 1.0:
                self._last_video_sent_ts = now
                raw = base64.b64decode(msg["data_b64"])
                await live_session.send_realtime_input(
                    video=types.Blob(data=raw, mime_type="image/jpeg")
                )
                self.meter.record_usage(image_in=258, is_new_turn=False)

    async def _run_local_loop(self, ws: WebSocket) -> None:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            await self._handle_control_message(msg, live_session=None)

    async def _run_live_loop(self, ws: WebSocket, client: genai.Client, model_name: str) -> None:
        snap = self.ledger.get_snapshot(self.workflow_id)
        try:
            async with client.aio.live.connect(model=model_name, config=self._live_config(snap.stage)) as live_session:
                async def _upstream() -> None:
                    while True:
                        raw = await ws.receive_text()
                        msg = json.loads(raw)
                        await self._handle_control_message(msg, live_session=live_session)

                async def _downstream() -> None:
                    while True:
                        async for server_msg in live_session.receive():
                            self.meter.duration_seconds = time.monotonic() - self._session_started_ts
                            if getattr(server_msg, "session_resumption_update", None):
                                upd = server_msg.session_resumption_update
                                if getattr(upd, "new_handle", None):
                                    self._resumption_handle = upd.new_handle
                            if getattr(server_msg, "go_away", None):
                                await self.hub.broadcast(
                                    self.workflow_id,
                                    {"type": "go_away", "message": "Live socket approaching lifetime; ready for seamless resume."},
                                )
                            if getattr(server_msg, "usage_metadata", None):
                                um = server_msg.usage_metadata
                                self.meter.record_usage(
                                    text_in=getattr(um, "prompt_token_count", 0) or 0,
                                    text_out=getattr(um, "candidates_token_count", 0) or 0,
                                    is_new_turn=False,
                                )
                            sc = getattr(server_msg, "server_content", None)
                            if sc:
                                if getattr(sc, "interrupted", False):
                                    await self.hub.broadcast(self.workflow_id, {"type": "server_interrupted"})
                                out_tr = getattr(sc, "output_transcription", None)
                                if out_tr and getattr(out_tr, "text", None):
                                    if self._speech_end_ts is not None:
                                        self.meter.record_ttfa((time.monotonic() - self._speech_end_ts) * 1000.0)
                                        self._speech_end_ts = None
                                    await self.hub.broadcast(
                                        self.workflow_id,
                                        {"type": "agent_transcript", "text": out_tr.text},
                                    )
                                mt = getattr(sc, "model_turn", None)
                                if mt and getattr(mt, "parts", None):
                                    if self._speech_end_ts is not None:
                                        self.meter.record_ttfa((time.monotonic() - self._speech_end_ts) * 1000.0)
                                        self._speech_end_ts = None
                                    for part in mt.parts:
                                        if getattr(part, "inline_data", None) and part.inline_data.data:
                                            b64 = base64.b64encode(part.inline_data.data).decode("ascii")
                                            await self.hub.broadcast(
                                                self.workflow_id,
                                                {"type": "audio_out_pcm24", "data_b64": b64},
                                            )
                                        if getattr(part, "text", None):
                                            await self.hub.broadcast(
                                                self.workflow_id,
                                                {"type": "agent_transcript", "text": part.text},
                                            )
                            tc = getattr(server_msg, "tool_call", None)
                            if tc and getattr(tc, "function_calls", None):
                                responses: list[types.FunctionResponse] = []
                                for fc in tc.function_calls:
                                    t0 = time.monotonic()
                                    result = self._dispatch_tool(fc.name, dict(fc.args or {}))
                                    latency_ms = round((time.monotonic() - t0) * 1000.0, 1)
                                    responses.append(
                                        types.FunctionResponse(id=fc.id, name=fc.name, response=result)
                                    )
                                    cur_snap = self.ledger.get_snapshot(self.workflow_id)
                                    await self.hub.broadcast(
                                        self.workflow_id,
                                        {
                                            "type": "tool_executed",
                                            "tool": fc.name,
                                            "args": dict(fc.args or {}),
                                            "result": result,
                                            "latency_ms": latency_ms,
                                            "snapshot": cur_snap.model_dump(),
                                            "telemetry": self.meter.snapshot(),
                                        },
                                    )
                                    await self._maybe_swap_prompt_card(live_session, cur_snap)
                                await live_session.send_tool_response(function_responses=responses)

                await asyncio.gather(_upstream(), _downstream())
        except Exception as err:
            await self.hub.broadcast(
                self.workflow_id,
                {"type": "live_fallback", "reason": str(err)[:200]},
            )
            await self._run_local_loop(ws)
