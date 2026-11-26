"""FastAPI application + REST/WebSocket control plane for DockPilot."""

from __future__ import annotations

import os
import time
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import get_settings
from app.ledger import BaseLedgerStore, create_ledger_store
from app.live_gateway import LiveGatewaySession, WorkflowBroadcastHub
from app.models import ActorRole, DomainRuleError
from app.prompt_cards import get_prompt_card
from app.rag import SOPRetriever


class ResolvePORequest(BaseModel):
    po_number: str
    actor_id: str = "receiver-01"


class DraftRequest(BaseModel):
    po_number: str
    cartons: int
    loose_pieces: int
    pack_unit: str = "peti"
    transcript: str = ""
    uom_confirmed: bool = False
    actor_id: str = "receiver-01"


class BargeInRequest(BaseModel):
    actor_id: str = "receiver-01"
    transcript_hint: str = "Ruko, eighteen nahi, twenty loose"
    stop_latency_ms: float = 210.0


class ConfirmRequest(BaseModel):
    revision_id: int
    actor_id: str = "receiver-01"


class RequestApprovalRequest(BaseModel):
    revision_id: int
    reason: str = "Shortage value exceeds INR 25,000 policy limit"


class ApproveRequest(BaseModel):
    revision_id: int
    actor_id: str = "sup-meera"
    actor_role: ActorRole = ActorRole.SUPERVISOR
    reason: str = "Verified physical count and CH-4471 against Receiving SOP v2 Clause 4"
    citation_clause: str | None = "Clause 4"


class CommitRequest(BaseModel):
    revision_id: int
    idempotency_key: str
    actor_id: str = "dockpilot-fsm"


class ReverseRequest(BaseModel):
    actor_id: str = "sup-meera"
    actor_role: ActorRole = ActorRole.SUPERVISOR
    reason: str = "Supervisor compensating reversal"


class TelemetryPulseRequest(BaseModel):
    text_in: int = 450
    audio_in: int = 512
    audio_out: int = 125
    ttfa_ms: float | None = None
    barge_stop_ms: float | None = None
    snr_before_db: float | None = None
    snr_after_db: float | None = None
    duration_seconds: float | None = None
    filter_mode: str | None = None


def create_app() -> FastAPI:
    settings = get_settings()
    ledger: BaseLedgerStore = create_ledger_store(settings)
    retriever = SOPRetriever(settings)
    hub = WorkflowBroadcastHub()

    app = FastAPI(title="DockPilot Gemini Enterprise API", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",")] if settings.cors_origins != "*" else ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.settings = settings
    app.state.ledger = ledger
    app.state.retriever = retriever
    app.state.hub = hub

    async def _broadcast_snapshot(workflow_id: str, event_type: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        snap = ledger.get_snapshot(workflow_id)
        meter = hub.get_meter(workflow_id, settings.fx_inr_per_usd)
        payload = {
            "type": event_type,
            "snapshot": snap.model_dump(),
            "prompt_card": get_prompt_card(snap.stage),
            "telemetry": meter.snapshot(),
            **(extra or {}),
        }
        await hub.broadcast(workflow_id, payload)
        return payload

    def _raise_domain(err: DomainRuleError) -> None:
        raise HTTPException(
            status_code=err.status_code,
            detail={"error_code": err.code, "message": err.message, "detail": err.detail},
        )

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "model": settings.gemini_live_model,
            "region": settings.gcp_location,
            "fallback_region": settings.vertex_fallback_location,
            "voice": settings.gemini_live_voice,
            "language_code": settings.gemini_live_language_code,
            "semantic_vad": True,
            "storage_backend": settings.storage_backend,
            "rag_backend": "vertex_rag" if settings.vertex_rag_corpus else "local_index",
            "git_sha": settings.git_sha,
            "live_configured": bool(settings.gcp_project_id or settings.gemini_api_key),
        }

    @app.get("/api/catalog")
    def catalog() -> dict[str, Any]:
        return {
            "pos": [po.model_dump() for po in ledger.pos.values()],
            "skus": [sku.model_dump() for sku in ledger.skus.values()],
        }

    @app.get("/api/sop/search")
    async def search_sop(workflow_id: str = "WF-4471", q: str = "shortage approval 25000") -> dict[str, Any]:
        t0 = time.monotonic()
        cites = retriever.search(query=q, scope="receiving", top_k=2)
        for c in cites:
            ledger.attach_citation(workflow_id, c, actor_id="dockpilot-rag")
        latency_ms = round((time.monotonic() - t0) * 1000.0, 1)
        await _broadcast_snapshot(workflow_id, "sop_cited", {"citations": [c.model_dump() for c in cites], "latency_ms": latency_ms})
        return {"citations": [c.model_dump() for c in cites], "latency_ms": latency_ms}

    @app.get("/api/workflows/{workflow_id}/state")
    def get_workflow_state(workflow_id: str) -> dict[str, Any]:
        snap = ledger.get_snapshot(workflow_id)
        meter = hub.get_meter(workflow_id, settings.fx_inr_per_usd)
        return {
            "snapshot": snap.model_dump(),
            "prompt_card": get_prompt_card(snap.stage),
            "telemetry": meter.snapshot(),
        }

    @app.post("/api/workflows/{workflow_id}/resolve-po")
    async def resolve_po(workflow_id: str, body: ResolvePORequest) -> dict[str, Any]:
        try:
            snap, po, sku = ledger.resolve_po(workflow_id, body.po_number, body.actor_id)
        except DomainRuleError as err:
            await _broadcast_snapshot(workflow_id, "rule_blocked", {"error_code": err.code, "message": err.message})
            _raise_domain(err)
        res = await _broadcast_snapshot(workflow_id, "po_resolved", {"po": po.model_dump(), "sku": sku.model_dump()})
        return res

    @app.post("/api/workflows/{workflow_id}/draft")
    async def create_draft(workflow_id: str, body: DraftRequest) -> dict[str, Any]:
        try:
            snap, draft = ledger.create_or_revise_draft(
                workflow_id=workflow_id,
                po_number=body.po_number,
                cartons=body.cartons,
                loose_pieces=body.loose_pieces,
                pack_unit=body.pack_unit,
                actor_id=body.actor_id,
                transcript=body.transcript,
                uom_confirmed=body.uom_confirmed,
            )
        except DomainRuleError as err:
            await _broadcast_snapshot(workflow_id, "rule_blocked", {"error_code": err.code, "message": err.message})
            _raise_domain(err)
        return await _broadcast_snapshot(workflow_id, "draft_created", {"draft": draft.model_dump()})

    @app.post("/api/workflows/{workflow_id}/barge-in")
    async def barge_in(workflow_id: str, body: BargeInRequest) -> dict[str, Any]:
        meter = hub.get_meter(workflow_id, settings.fx_inr_per_usd)
        meter.record_barge_stop(body.stop_latency_ms)
        ledger.handle_barge_in(workflow_id, body.actor_id, body.transcript_hint)
        return await _broadcast_snapshot(workflow_id, "barge_in_recorded", {"stop_latency_ms": body.stop_latency_ms})

    @app.post("/api/workflows/{workflow_id}/confirm")
    async def confirm_draft(workflow_id: str, body: ConfirmRequest) -> dict[str, Any]:
        try:
            _, draft = ledger.confirm_draft(workflow_id, body.revision_id, body.actor_id)
        except DomainRuleError as err:
            await _broadcast_snapshot(workflow_id, "rule_blocked", {"error_code": err.code, "message": err.message})
            _raise_domain(err)
        return await _broadcast_snapshot(workflow_id, "draft_confirmed", {"draft": draft.model_dump()})

    @app.post("/api/workflows/{workflow_id}/request-approval")
    async def request_approval(workflow_id: str, body: RequestApprovalRequest) -> dict[str, Any]:
        try:
            ledger.request_approval(workflow_id, body.revision_id, "dockpilot-fsm", body.reason)
        except DomainRuleError as err:
            _raise_domain(err)
        return await _broadcast_snapshot(workflow_id, "approval_requested")

    @app.post("/api/workflows/{workflow_id}/approve")
    async def approve(workflow_id: str, body: ApproveRequest) -> dict[str, Any]:
        try:
            _, rec = ledger.approve_revision(
                workflow_id=workflow_id,
                revision_id=body.revision_id,
                actor_id=body.actor_id,
                actor_role=body.actor_role,
                reason=body.reason,
                citation_clause=body.citation_clause,
            )
        except DomainRuleError as err:
            await _broadcast_snapshot(workflow_id, "rule_blocked", {"error_code": err.code, "message": err.message})
            _raise_domain(err)
        return await _broadcast_snapshot(workflow_id, "supervisor_approved", {"approval": rec.model_dump()})

    @app.post("/api/workflows/{workflow_id}/commit")
    async def commit(workflow_id: str, body: CommitRequest) -> dict[str, Any]:
        try:
            _, grn, replay = ledger.commit_grn(
                workflow_id=workflow_id,
                revision_id=body.revision_id,
                idempotency_key=body.idempotency_key,
                actor_id=body.actor_id,
            )
        except DomainRuleError as err:
            await _broadcast_snapshot(workflow_id, "commit_blocked", {"error_code": err.code, "message": err.message})
            _raise_domain(err)
        return await _broadcast_snapshot(workflow_id, "grn_committed", {"grn": grn.model_dump(), "idempotent_replay": replay})

    @app.post("/api/workflows/{workflow_id}/test-stale-commit")
    async def test_stale_commit(workflow_id: str) -> dict[str, Any]:
        """Demo-day helper attempting to commit obsolete Revision 1."""
        try:
            ledger.commit_grn(
                workflow_id=workflow_id,
                revision_id=1,
                idempotency_key=f"stale-test-{int(time.time())}",
                actor_id="demo-fault-injector",
            )
        except DomainRuleError as err:
            payload = await _broadcast_snapshot(workflow_id, "commit_blocked", {"error_code": err.code, "message": err.message})
            return {"blocked": True, "error_code": err.code, "message": err.message, **payload}
        return {"blocked": False, "snapshot": ledger.get_snapshot(workflow_id).model_dump()}

    @app.post("/api/workflows/{workflow_id}/test-duplicate-commit")
    async def test_duplicate_commit(workflow_id: str) -> dict[str, Any]:
        """Demo-day helper firing a duplicate retry against current revision."""
        snap = ledger.get_snapshot(workflow_id)
        rev_id = snap.current_revision_id or 1
        key = snap.grn.idempotency_key if snap.grn else f"dup-retry-{rev_id}"
        try:
            _, grn, replay = ledger.commit_grn(
                workflow_id=workflow_id,
                revision_id=rev_id,
                idempotency_key=key,
                actor_id="demo-duplicate-retry",
            )
        except DomainRuleError as err:
            payload = await _broadcast_snapshot(workflow_id, "commit_blocked", {"error_code": err.code, "message": err.message})
            return {"blocked": True, "error_code": err.code, "message": err.message, **payload}
        payload = await _broadcast_snapshot(workflow_id, "idempotent_replay", {"grn": grn.model_dump(), "idempotent_replay": replay})
        return {"blocked": False, "idempotent_replay": replay, **payload}

    @app.post("/api/workflows/{workflow_id}/reverse")
    async def reverse(workflow_id: str, body: ReverseRequest) -> dict[str, Any]:
        try:
            _, mov = ledger.reverse_grn(
                workflow_id=workflow_id,
                actor_id=body.actor_id,
                actor_role=body.actor_role,
                reason=body.reason,
            )
        except DomainRuleError as err:
            await _broadcast_snapshot(workflow_id, "rule_blocked", {"error_code": err.code, "message": err.message})
            _raise_domain(err)
        return await _broadcast_snapshot(workflow_id, "grn_reversed", {"movement": mov.model_dump()})

    @app.post("/api/workflows/{workflow_id}/reset")
    async def reset(workflow_id: str) -> dict[str, Any]:
        ledger.reset_demo(workflow_id)
        hub.reset_meter(workflow_id, settings.fx_inr_per_usd)
        return await _broadcast_snapshot(workflow_id, "workflow_reset")

    @app.post("/api/workflows/{workflow_id}/telemetry-pulse")
    async def telemetry_pulse(workflow_id: str, body: TelemetryPulseRequest) -> dict[str, Any]:
        meter = hub.get_meter(workflow_id, settings.fx_inr_per_usd)
        meter.record_usage(text_in=body.text_in, audio_in=body.audio_in, audio_out=body.audio_out, is_new_turn=True)
        if body.ttfa_ms is not None:
            meter.record_ttfa(body.ttfa_ms)
        if body.barge_stop_ms is not None:
            meter.record_barge_stop(body.barge_stop_ms)
        if body.snr_before_db is not None:
            meter.snr_before_db = body.snr_before_db
        if body.snr_after_db is not None:
            meter.snr_after_db = body.snr_after_db
        if body.duration_seconds is not None:
            meter.duration_seconds = body.duration_seconds
        if body.filter_mode is not None:
            meter.noise_filter_mode = body.filter_mode
        return await _broadcast_snapshot(workflow_id, "telemetry_updated")

    @app.get("/api/workflows/{workflow_id}/debit-note-pack")
    def get_debit_note(workflow_id: str) -> dict[str, Any]:
        snap = ledger.get_snapshot(workflow_id)
        if snap.claim_pack is None:
            raise HTTPException(status_code=404, detail={"error_code": "NO_CLAIM_PACK", "message": "No committed shortage claim yet."})
        return snap.claim_pack.model_dump()

    @app.websocket("/ws/dock/{workflow_id}")
    async def ws_dock(ws: WebSocket, workflow_id: str) -> None:
        session = LiveGatewaySession(
            workflow_id=workflow_id,
            settings=settings,
            ledger=ledger,
            retriever=retriever,
            hub=hub,
        )
        try:
            await session.run_ws(ws)
        except WebSocketDisconnect:
            pass

    return app


app = create_app()
