"""Google ADK SequentialAgent enterprise governance pipeline for DockPilot."""

from __future__ import annotations

import logging
import time
from typing import Any, AsyncGenerator

from google.adk.agents import BaseAgent, SequentialAgent  # type: ignore
from google.adk.agents.invocation_context import InvocationContext  # type: ignore
from google.adk.events import Event, EventActions  # type: ignore
from google.genai import types  # type: ignore
from pydantic import ConfigDict

from app.erp_adapter import ERPNextAdapter
from app.ledger import BaseLedgerStore
from app.model_armor import ModelArmorGuard
from app.models import WorkflowSnapshot

logger = logging.getLogger(__name__)


def validate_indian_gstin_checksum(gstin: str) -> dict[str, Any]:
    """Deterministic 15-character Indian GSTIN Modulo-36 checksum validation."""
    cleaned = (gstin or "").strip().upper()
    if len(cleaned) != 15:
        return {"gstin": cleaned, "format_valid": False, "checksum_valid": False}
    alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if any(ch not in alphabet for ch in cleaned):
        return {"gstin": cleaned, "format_valid": False, "checksum_valid": False}
    format_valid = (
        cleaned[:2].isdigit()
        and cleaned[2:7].isalpha()
        and cleaned[7:11].isdigit()
        and cleaned[11].isalpha()
        and cleaned[13] == "Z"
    )
    total = 0
    for idx, ch in enumerate(cleaned[:14]):
        val = alphabet.index(ch)
        factor = val * (1 if idx % 2 == 0 else 2)
        total += (factor // 36) + (factor % 36)
    expected_char = alphabet[(36 - (total % 36)) % 36]
    return {
        "gstin": cleaned,
        "format_valid": format_valid,
        "checksum_valid": bool(format_valid and cleaned[14] == expected_char),
        "expected_check_char": expected_char,
    }


class _ComplianceStageAgent(BaseAgent):
    """ADK Stage 1: Deterministic Challan Compliance (GSTIN Modulo-36 + Model Armor + RAG SOP)."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    ledger: Any = None
    armor: Any = None
    retriever: Any = None
    workflow_id: str = "WF-4471"

    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        t0 = time.monotonic()
        snap: WorkflowSnapshot = self.ledger.get_snapshot(self.workflow_id)
        po = self.ledger.pos.get(snap.po_number or "PO-4471")
        gstin_res = validate_indian_gstin_checksum(po.vendor_gstin) if po else {"checksum_valid": False}
        armor_text = f"{po.vendor_name if po else ''} {po.challan_no if po else ''} {po.eway_bill.eway_bill_no if po else ''}"
        armor_res = self.armor.inspect_text(armor_text)
        cites = self.retriever.search("shortage approval 25000 eway bill", scope="receiving", top_k=1)
        for c in cites:
            self.ledger.attach_citation(self.workflow_id, c, actor_id="adk-compliance-agent")
        trace_entry = {
            "agent": self.name,
            "role_scope": "COMPLIANCE_READ_ONLY",
            "status": "PASS" if (armor_res.get("safe") and (not po or po.eway_bill.status == "ACTIVE")) else "HOLD",
            "latency_ms": round((time.monotonic() - t0) * 1000.0, 1),
            "detail": {
                "gstin": gstin_res.get("gstin"),
                "gstin_checksum_valid": gstin_res.get("checksum_valid"),
                "eway_status": po.eway_bill.status if po else "UNKNOWN",
                "model_armor_safe": armor_res.get("safe"),
                "sop_clause": cites[0].clause if cites else "SOP-RCV-002",
            },
        }
        trace_list = list(ctx.session.state.get("adk_trace") or [])
        trace_list.append(trace_entry)
        yield Event(
            author=self.name,
            content=types.Content(role="model", parts=[types.Part(text=f"Compliance verified: {trace_entry['status']}")]),
            actions=EventActions(state_delta={"adk_trace": trace_list}),
        )


class _WriteGateStageAgent(BaseAgent):
    """ADK Stage 2: Role-Scoped Firestore Write-Gate + Atomic Commit Boundary."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    ledger: Any = None
    workflow_id: str = "WF-4471"
    revision_id: int = 1
    idempotency_key: str = ""
    actor_id: str = "dockpilot-fsm"

    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        t0 = time.monotonic()
        snap, grn, replay = self.ledger.commit_grn(
            workflow_id=self.workflow_id,
            revision_id=self.revision_id,
            idempotency_key=self.idempotency_key,
            actor_id=self.actor_id,
        )
        trace_list = list(ctx.session.state.get("adk_trace") or [])
        trace_list.append(
            {
                "agent": self.name,
                "role_scope": "WRITE_GATE_SUPERVISOR_REQUIRED",
                "status": "REPLAY" if replay else "COMMITTED",
                "latency_ms": round((time.monotonic() - t0) * 1000.0, 1),
                "detail": {
                    "grn_id": grn.grn_id,
                    "revision_id": grn.revision_id,
                    "inventory_after": snap.inventory_balance,
                    "claim_id": grn.claim_id,
                },
            }
        )
        yield Event(
            author=self.name,
            content=types.Content(role="model", parts=[types.Part(text=f"Ledger gate committed {grn.grn_id}")]),
            actions=EventActions(
                state_delta={
                    "committed_grn": grn.model_dump(),
                    "idempotent_replay": replay,
                    "po_number": grn.po_number,
                    "sku_id": grn.sku_id,
                    "received_pieces": grn.received_pieces,
                    "revision_id": grn.revision_id,
                    "adk_trace": trace_list,
                }
            ),
        )


class _ERPSettlementStageAgent(BaseAgent):
    """ADK Stage 3: Idempotent ERPNext Purchase Receipt + Stock Ledger Read-Back."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    ledger: Any = None
    erp: Any = None
    workflow_id: str = "WF-4471"
    idempotency_key: str = ""

    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        t0 = time.monotonic()
        po_number = str(ctx.session.state.get("po_number") or "PO-4471")
        sku_id = str(ctx.session.state.get("sku_id") or "SKU-24")
        received_pieces = int(ctx.session.state.get("received_pieces") or 0)
        revision_id = int(ctx.session.state.get("revision_id") or 1)
        po = self.ledger.pos[po_number]
        sku = self.ledger.skus[sku_id]

        delivery_id = f"{self.workflow_id}:{self.idempotency_key}"
        erp_res: dict[str, Any]
        if self.erp and self.erp.configured:
            try:
                erp_res = self.erp.post_purchase_receipt_idempotent(
                    workflow_id=self.workflow_id,
                    po=po,
                    sku=sku,
                    received_pieces=received_pieces,
                    delivery_id=delivery_id,
                    revision_id=revision_id,
                )
            except Exception as exc:
                logger.warning("ERPNext sync failed after commit: %s", exc)
                erp_res = {
                    "erp_sync_status": "FAILED",
                    "erp_verified": False,
                    "error": str(exc),
                }
        else:
            erp_res = {
                "erp_sync_status": "NOT_CONFIGURED",
                "erp_verified": False,
            }

        trace_list = list(ctx.session.state.get("adk_trace") or [])
        trace_list.append(
            {
                "agent": self.name,
                "role_scope": "ERP_SYSTEM_OF_RECORD_SYNC",
                "status": erp_res.get("erp_sync_status", "UNKNOWN"),
                "latency_ms": round((time.monotonic() - t0) * 1000.0, 1),
                "detail": erp_res,
            }
        )
        yield Event(
            author=self.name,
            content=types.Content(role="model", parts=[types.Part(text=f"ERPNext status: {erp_res.get('erp_sync_status')}")]),
            actions=EventActions(state_delta={"erp_result": erp_res, "adk_trace": trace_list}),
        )


def build_adk_sequential_pipeline(
    *,
    ledger: BaseLedgerStore,
    armor: ModelArmorGuard,
    retriever: Any,
    erp: ERPNextAdapter,
    workflow_id: str,
    revision_id: int,
    idempotency_key: str,
    actor_id: str = "dockpilot-fsm",
) -> SequentialAgent:
    """Construct the 3-stage Google ADK SequentialAgent governing compliance, lock commit, and ERP settlement."""
    compliance = _ComplianceStageAgent(
        name="ChallanComplianceAgent",
        description="Checks GSTIN Modulo-36, e-Way validity, Model Armor safety, and cites Receiving SOP clauses.",
        ledger=ledger,
        armor=armor,
        retriever=retriever,
        workflow_id=workflow_id,
    )
    write_gate = _WriteGateStageAgent(
        name="LedgerWriteGateAgent",
        description="Executes role-checked revision-locked Firestore/SQLite GRN transaction.",
        ledger=ledger,
        workflow_id=workflow_id,
        revision_id=revision_id,
        idempotency_key=idempotency_key,
        actor_id=actor_id,
    )
    erp_sync = _ERPSettlementStageAgent(
        name="ERPSettlementAgent",
        description="Idempotently creates and verifies ERPNext Purchase Receipt and Stock Ledger balance.",
        ledger=ledger,
        erp=erp,
        workflow_id=workflow_id,
        idempotency_key=idempotency_key,
    )
    return SequentialAgent(
        name="dockpilot_enterprise_pipeline",
        description="3-stage deterministic receiving governance pipeline.",
        sub_agents=[compliance, write_gate, erp_sync],
    )


async def run_enterprise_commit_pipeline(
    *,
    ledger: BaseLedgerStore,
    armor: ModelArmorGuard,
    retriever: Any,
    erp: ERPNextAdapter,
    workflow_id: str,
    revision_id: int,
    idempotency_key: str,
    actor_id: str = "dockpilot-fsm",
) -> dict[str, Any]:
    """Execute the Google ADK SequentialAgent via google.adk Runner + InMemorySessionService."""
    from google.adk.runners import Runner  # type: ignore
    from google.adk.sessions import InMemorySessionService  # type: ignore

    pipeline = build_adk_sequential_pipeline(
        ledger=ledger,
        armor=armor,
        retriever=retriever,
        erp=erp,
        workflow_id=workflow_id,
        revision_id=revision_id,
        idempotency_key=idempotency_key,
        actor_id=actor_id,
    )
    session_service = InMemorySessionService()
    runner = Runner(agent=pipeline, app_name="dockpilot-enterprise", session_service=session_service)
    session = await session_service.create_session(app_name="dockpilot-enterprise", user_id=actor_id)
    content = types.Content(role="user", parts=[types.Part(text=f"Commit {workflow_id} revision {revision_id}")])

    async for _ev in runner.run_async(user_id=actor_id, session_id=session.id, new_message=content):
        pass

    final_session = await session_service.get_session(
        app_name="dockpilot-enterprise", user_id=actor_id, session_id=session.id
    )
    state = dict(final_session.state) if final_session else {}
    return {
        "adk_pipeline": pipeline.name,
        "stages": [a.name for a in pipeline.sub_agents],
        "adk_trace": state.get("adk_trace", []),
        "erp_result": state.get("erp_result", {}),
        "idempotent_replay": bool(state.get("idempotent_replay", False)),
    }
