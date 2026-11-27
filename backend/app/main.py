"""FastAPI application + REST/WebSocket control plane for DockPilot."""

from __future__ import annotations

import logging
import os
import time
from typing import Any
from urllib.parse import quote_plus

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.adk_pipeline import run_enterprise_commit_pipeline, validate_indian_gstin_checksum
from app.artifacts_gst import (
    build_cgst_rule53_pdf,
    build_driver_gate_pass,
    build_tally_debit_note_xml,
    sign_approval_token,
    verify_approval_token,
)
from app.challan_ingest import ingest_challan_document, render_fixture_challan_pdf
from app.config import get_settings
from app.erp_adapter import ERPNextAdapter
from app.ledger import BaseLedgerStore, create_ledger_store
from app.live_gateway import LiveGatewaySession, WorkflowBroadcastHub
from app.model_armor import ModelArmorGuard
from app.models import ActorRole, DomainRuleError
from app.prompt_cards import get_prompt_card
from app.rag import SOPRetriever

logger = logging.getLogger(__name__)


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


class TokenApproveRequest(BaseModel):
    revision_id: int
    sig: str
    actor_id: str = "sup-ops-lead"
    reason: str = "Verified physical count and challan on mobile sign-off"
    citation_clause: str | None = "Clause 4"
    auto_commit: bool = True
    idempotency_key: str | None = None


class GatePassAckRequest(BaseModel):
    sig: str
    driver_name: str = "Transporter"


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
    armor = ModelArmorGuard(
        project_id=settings.gcp_project_id,
        location=settings.model_armor_location,
        template_id=settings.model_armor_template,
    )
    erp = ERPNextAdapter(
        base_url=settings.erpnext_base_url,
        api_key=settings.erpnext_api_key,
        api_secret=settings.erpnext_api_secret,
        company=settings.erpnext_company,
        warehouse=settings.erpnext_warehouse,
    )

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
    app.state.armor = armor
    app.state.erp = erp

    def _po_sku_extra(snap: Any) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if snap.po_number and snap.po_number in ledger.pos:
            out["po"] = ledger.pos[snap.po_number].model_dump()
        if snap.sku_id and snap.sku_id in ledger.skus:
            out["sku"] = ledger.skus[snap.sku_id].model_dump()
        return out

    async def _broadcast_snapshot(workflow_id: str, event_type: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        snap = ledger.get_snapshot(workflow_id)
        meter = hub.get_meter(workflow_id, settings.fx_inr_per_usd)
        payload = {
            "type": event_type,
            "snapshot": snap.model_dump(),
            "prompt_card": get_prompt_card(snap.stage),
            "telemetry": meter.snapshot(),
            **_po_sku_extra(snap),
            **(extra or {}),
        }
        await hub.broadcast(workflow_id, payload)
        return payload

    async def _settle_commit_via_adk(
        *,
        workflow_id: str,
        revision_id: int,
        idempotency_key: str,
        actor_id: str,
    ) -> tuple[Any, Any, bool]:
        res = await run_enterprise_commit_pipeline(
            ledger=ledger,
            armor=armor,
            retriever=retriever,
            erp=erp,
            workflow_id=workflow_id,
            revision_id=revision_id,
            idempotency_key=idempotency_key,
            actor_id=actor_id,
        )
        snap = ledger.get_snapshot(workflow_id)
        gate_pass = None
        if snap.grn is not None:
            po = ledger.pos.get(snap.grn.po_number)
            sku = ledger.skus.get(snap.grn.sku_id)
            if po and sku:
                gate_pass = build_driver_gate_pass(
                    snap,
                    po,
                    sku,
                    settings.approval_hmac_secret,
                    settings.public_web_url,
                )
        snap = ledger.record_erp_and_adk_settlement(
            workflow_id=workflow_id,
            erp_res=res["erp_result"],
            adk_trace=res["adk_trace"],
            gate_pass=gate_pass,
        )
        return snap, snap.grn, bool(res.get("idempotent_replay", False))

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
            "erpnext_configured": erp.configured,
            "erpnext_base_url": settings.erpnext_base_url or None,
            "erpnext_company": settings.erpnext_company,
            "erpnext_warehouse": settings.erpnext_warehouse,
            "model_armor_enabled": armor.cloud_enabled,
            "model_armor_location": settings.model_armor_location,
            "model_armor_template": settings.model_armor_template,
            "adk_pipeline": "dockpilot_enterprise_pipeline",
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
            **_po_sku_extra(snap),
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
            _, grn, replay = await _settle_commit_via_adk(
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
            _, grn, replay = await _settle_commit_via_adk(
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
            if erp.configured:
                try:
                    erp.cancel_receipts_for_workflow(workflow_id)
                except Exception as exc:
                    logger.warning("ERPNext reversal cancel failed: %s", exc)
        except DomainRuleError as err:
            await _broadcast_snapshot(workflow_id, "rule_blocked", {"error_code": err.code, "message": err.message})
            _raise_domain(err)
        return await _broadcast_snapshot(workflow_id, "grn_reversed", {"movement": mov.model_dump()})

    @app.post("/api/workflows/{workflow_id}/reset")
    async def reset(workflow_id: str) -> dict[str, Any]:
        if erp.configured:
            try:
                erp.cancel_receipts_for_workflow(workflow_id)
            except Exception as exc:
                logger.warning("ERPNext reset cleanup failed: %s", exc)
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

    @app.get("/api/fixtures/challans/{fixture_id}.pdf")
    def get_fixture_challan_pdf(fixture_id: str) -> Response:
        try:
            pdf_bytes = render_fixture_challan_pdf(fixture_id)
        except DomainRuleError as err:
            _raise_domain(err)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="challan-{fixture_id}.pdf"'},
        )

    @app.post("/api/workflows/{workflow_id}/ingest-challan")
    async def ingest_challan(
        workflow_id: str,
        file: UploadFile | None = File(None),
        fixture_id: str | None = Form(None),
        fixture: str | None = None,
    ) -> dict[str, Any]:
        selected_fixture = (fixture_id or fixture or "").strip() or None
        raw_bytes: bytes | None = None
        mime_type = "application/pdf"
        if file is not None:
            raw_bytes = await file.read()
            mime_type = file.content_type or ("application/pdf" if (file.filename or "").lower().endswith(".pdf") else "image/png")

        try:
            po, sku, armor_res, gstin_check = ingest_challan_document(
                raw_bytes=raw_bytes,
                mime_type=mime_type,
                fixture_id=selected_fixture,
                armor=armor,
                settings=settings,
            )
        except DomainRuleError as err:
            if err.code == "PROMPT_INJECTION_BLOCKED":
                ledger.record_model_armor_event(
                    workflow_id=workflow_id,
                    armor_check=err.detail.get("model_armor", {}),
                    blocked=True,
                    detail={"po_number": err.detail.get("po_number"), "message": err.message},
                )
                await _broadcast_snapshot(workflow_id, "model_armor_blocked", {"error_code": err.code, "message": err.message})
            _raise_domain(err)

        initial_bal = 1000 if sku.sku_id == "SKU-24" else 500
        if erp.configured:
            try:
                erp.ensure_po_and_item(po, sku)
                live_bal = erp.get_item_balance(sku.sku_id)
                if live_bal is not None:
                    initial_bal = live_bal
            except Exception as exc:
                logger.warning("ERPNext dynamic PO prepare skipped: %s", exc)

        ledger.register_dynamic_po(
            workflow_id=workflow_id,
            po=po,
            sku=sku,
            armor_check=armor_res,
            gstin_check=gstin_check,
            initial_balance=initial_bal,
        )
        return await _broadcast_snapshot(
            workflow_id,
            "challan_ingested",
            {"model_armor": armor_res, "gstin_check": gstin_check},
        )

    @app.get("/api/workflows/{workflow_id}/approval-link")
    def get_approval_link(workflow_id: str, revision_id: int | None = None) -> dict[str, Any]:
        snap = ledger.get_snapshot(workflow_id)
        target_rev = revision_id or snap.current_revision_id
        if target_rev is None:
            raise HTTPException(status_code=409, detail={"error_code": "NO_ACTIVE_DRAFT", "message": "Create a count revision first."})
        rev_obj = next((r for r in snap.revisions if r.revision_id == target_rev), None)
        if rev_obj is None:
            raise HTTPException(status_code=404, detail={"error_code": "REVISION_NOT_FOUND", "message": f"Revision {target_rev} not found."})
        sig = sign_approval_token(workflow_id, target_rev, settings.approval_hmac_secret)
        approve_url = f"{settings.public_web_url.rstrip('/')}/approve/{workflow_id}?rev={target_rev}&sig={sig}"
        po_label = snap.po_number or "PO-4471"
        wa_msg = (
            f"DockPilot Approval Request | {po_label} Rev {target_rev}: "
            f"{rev_obj.total_pieces} pcs received ({rev_obj.shortage_pieces} short, "
            f"INR {rev_obj.shortage_value_inr:,} variance). Review & approve: {approve_url}"
        )
        whatsapp_url = f"https://wa.me/?text={quote_plus(wa_msg)}"
        webhook_sent = False
        if settings.supervisor_webhook_url:
            try:
                httpx.post(
                    settings.supervisor_webhook_url,
                    json={
                        "workflow_id": workflow_id,
                        "po_number": po_label,
                        "revision_id": target_rev,
                        "shortage_pieces": rev_obj.shortage_pieces,
                        "shortage_value_inr": rev_obj.shortage_value_inr,
                        "approve_url": approve_url,
                    },
                    timeout=3.0,
                )
                webhook_sent = True
            except Exception as exc:
                logger.warning("Supervisor webhook notify skipped: %s", exc)
        return {
            "workflow_id": workflow_id,
            "revision_id": target_rev,
            "revision_status": rev_obj.status,
            "sig": sig,
            "approve_url": approve_url,
            "whatsapp_share_url": whatsapp_url,
            "webhook_dispatched": webhook_sent,
        }

    @app.post("/api/workflows/{workflow_id}/approve-by-token")
    async def approve_by_token(workflow_id: str, body: TokenApproveRequest) -> dict[str, Any]:
        if not verify_approval_token(workflow_id, body.revision_id, body.sig, settings.approval_hmac_secret):
            raise HTTPException(status_code=403, detail={"error_code": "INVALID_APPROVAL_TOKEN", "message": "Invalid supervisor approval signature."})
        try:
            _, rec = ledger.approve_revision(
                workflow_id=workflow_id,
                revision_id=body.revision_id,
                actor_id=body.actor_id,
                actor_role=ActorRole.SUPERVISOR,
                reason=body.reason,
                citation_clause=body.citation_clause,
            )
            committed_payload: dict[str, Any] = {"approval": rec.model_dump()}
            if body.auto_commit:
                idem = body.idempotency_key or f"mobile-rev-{body.revision_id}-{int(time.time())}"
                _, grn, replay = await _settle_commit_via_adk(
                    workflow_id=workflow_id,
                    revision_id=body.revision_id,
                    idempotency_key=idem,
                    actor_id=body.actor_id,
                )
                committed_payload["grn"] = grn.model_dump()
                committed_payload["idempotent_replay"] = replay
                return await _broadcast_snapshot(workflow_id, "grn_committed", committed_payload)
            return await _broadcast_snapshot(workflow_id, "supervisor_approved", committed_payload)
        except DomainRuleError as err:
            erp_stock = None
            if erp.configured:
                try:
                    snap_now = ledger.get_snapshot(workflow_id)
                    erp_stock = erp.get_item_balance(snap_now.sku_id or "SKU-24")
                except Exception:
                    pass
            await _broadcast_snapshot(
                workflow_id,
                "rule_blocked",
                {"error_code": err.code, "message": err.message, "erp_stock_untouched": erp_stock},
            )
            _raise_domain(err)

    @app.get("/api/workflows/{workflow_id}/artifacts/tally-xml")
    def download_tally_xml(workflow_id: str) -> Response:
        snap = ledger.get_snapshot(workflow_id)
        if snap.claim_pack is None or snap.grn is None:
            raise HTTPException(status_code=404, detail={"error_code": "NO_CLAIM_PACK", "message": "Commit a GRN with shortage first."})
        po = ledger.pos.get(snap.grn.po_number)
        sku = ledger.skus.get(snap.grn.sku_id)
        if not po or not sku:
            raise HTTPException(status_code=404, detail={"error_code": "PO_NOT_FOUND", "message": "PO metadata missing."})
        xml_str = build_tally_debit_note_xml(snap, po, sku, company_name=settings.erpnext_company)
        return Response(
            content=xml_str,
            media_type="application/xml",
            headers={"Content-Disposition": f'attachment; filename="tally-debit-note-{po.po_number}.xml"'},
        )

    @app.get("/api/workflows/{workflow_id}/artifacts/debit-note.pdf")
    def download_debit_note_pdf(workflow_id: str) -> Response:
        snap = ledger.get_snapshot(workflow_id)
        if snap.claim_pack is None or snap.grn is None:
            raise HTTPException(status_code=404, detail={"error_code": "NO_CLAIM_PACK", "message": "Commit a GRN with shortage first."})
        po = ledger.pos.get(snap.grn.po_number)
        sku = ledger.skus.get(snap.grn.sku_id)
        if not po or not sku:
            raise HTTPException(status_code=404, detail={"error_code": "PO_NOT_FOUND", "message": "PO metadata missing."})
        pdf_bytes = build_cgst_rule53_pdf(snap, po, sku, company_name=settings.erpnext_company)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="cgst-debit-note-{po.po_number}.pdf"'},
        )

    @app.get("/api/workflows/{workflow_id}/artifacts/gate-pass")
    def get_gate_pass(workflow_id: str) -> dict[str, Any]:
        snap = ledger.get_snapshot(workflow_id)
        if snap.driver_gate_pass:
            return snap.driver_gate_pass
        if snap.grn is None:
            raise HTTPException(status_code=404, detail={"error_code": "NO_GATE_PASS", "message": "Commit GRN first to generate driver gate pass."})
        po = ledger.pos[snap.grn.po_number]
        sku = ledger.skus[snap.grn.sku_id]
        return build_driver_gate_pass(snap, po, sku, settings.approval_hmac_secret, settings.public_web_url)

    @app.post("/api/workflows/{workflow_id}/artifacts/gate-pass/acknowledge")
    async def acknowledge_gate_pass(workflow_id: str, body: GatePassAckRequest) -> dict[str, Any]:
        snap = ledger.get_snapshot(workflow_id)
        if not snap.driver_gate_pass or body.sig != snap.driver_gate_pass.get("sig"):
            raise HTTPException(status_code=403, detail={"error_code": "INVALID_GATE_PASS_SIG", "message": "Invalid gate-pass verification signature."})
        try:
            updated = ledger.acknowledge_driver_gate_pass(workflow_id=workflow_id, driver_name=body.driver_name)
        except DomainRuleError as err:
            _raise_domain(err)
        return await _broadcast_snapshot(workflow_id, "gate_pass_acknowledged", {"driver_gate_pass": updated.driver_gate_pass})

    @app.get("/api/erp/live-status")
    def erp_live_status() -> dict[str, Any]:
        health = erp.health_check()
        bal = None
        receipts: list[dict[str, Any]] = []
        if health.get("reachable"):
            try:
                bal = erp.get_item_balance("SKU-24")
                receipts = erp.get_recent_receipts(limit=5)
            except Exception as exc:
                health["read_error"] = str(exc)
        return {
            **health,
            "sku24_balance": bal,
            "recent_receipts": receipts,
            "stock_ledger_url": f"{settings.erpnext_base_url.rstrip('/')}/app/query-report/Stock%20Ledger" if settings.erpnext_base_url else None,
        }

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
