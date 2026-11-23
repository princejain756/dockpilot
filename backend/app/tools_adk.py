"""Fixed 6-tool surface and single Google ADK root agent for DockPilot."""

from __future__ import annotations

from typing import Any

from google.adk.agents import LlmAgent  # type: ignore
from google.adk.tools import FunctionTool  # type: ignore
from google.genai import types  # type: ignore

from app.ledger import BaseLedgerStore
from app.models import DomainRuleError, WorkflowSnapshot, WorkflowStage
from app.prompt_cards import get_prompt_card
from app.rag import SOPRetriever


class DockPilotToolkit:
    """Fixed 6-tool surface enforced by backend FSM (model holds zero DB credentials)."""

    def __init__(self, ledger: BaseLedgerStore, retriever: SOPRetriever, workflow_id: str):
        self.ledger = ledger
        self.retriever = retriever
        self.workflow_id = workflow_id

    def _error_payload(self, err: DomainRuleError) -> dict[str, Any]:
        return {"ok": False, "error_code": err.code, "message": err.message, "detail": err.detail}

    def resolve_po_and_challan(self, po_number: str, actor_id: str = "receiver-01") -> dict[str, Any]:
        """Resolve Purchase Order, invoice, e-Way Bill status, and SKU pack size."""
        try:
            snap, po, sku = self.ledger.resolve_po(self.workflow_id, po_number, actor_id)
            return {
                "ok": True,
                "stage": snap.stage.value,
                "po_number": po.po_number,
                "vendor_name": po.vendor_name,
                "invoice_no": po.invoice_no,
                "eway_bill_no": po.eway_bill.eway_bill_no,
                "eway_status": po.eway_bill.status,
                "sku_id": sku.sku_id,
                "sku_name": sku.name,
                "pack_unit": po.pack_unit,
                "pack_size": sku.pack_conversions.get(po.pack_unit, 1),
                "expected_pieces": po.expected_pieces,
                "unit_cost_inr": sku.unit_cost_inr,
                "current_inventory_balance": snap.inventory_balance,
            }
        except DomainRuleError as err:
            return self._error_payload(err)

    def compute_receipt_draft(
        self,
        po_number: str,
        cartons: int,
        loose_pieces: int,
        pack_unit: str = "peti",
        transcript: str = "",
        uom_confirmed: bool = False,
        actor_id: str = "receiver-01",
    ) -> dict[str, Any]:
        """Compute deterministic base-unit count, supersede stale drafts, and check thresholds."""
        try:
            snap, draft = self.ledger.create_or_revise_draft(
                workflow_id=self.workflow_id,
                po_number=po_number,
                cartons=cartons,
                loose_pieces=loose_pieces,
                pack_unit=pack_unit,
                actor_id=actor_id,
                transcript=transcript,
                uom_confirmed=uom_confirmed,
            )
            return {
                "ok": True,
                "stage": snap.stage.value,
                "revision_id": draft.revision_id,
                "cartons": draft.cartons,
                "pack_size": draft.pack_size,
                "loose_pieces": draft.loose_pieces,
                "total_pieces": draft.total_pieces,
                "expected_pieces": draft.expected_pieces,
                "shortage_pieces": draft.shortage_pieces,
                "shortage_value_inr": draft.shortage_value_inr,
                "requires_supervisor_approval": draft.requires_supervisor_approval,
                "hold_reasons": draft.hold_reasons,
            }
        except DomainRuleError as err:
            return self._error_payload(err)

    def search_receiving_sop(self, query: str, scope: str = "receiving") -> dict[str, Any]:
        """Retrieve <=150-token cited English Receiving SOP passages via backend tool."""
        citations = self.retriever.search(query=query, scope=scope, top_k=2)
        for c in citations:
            self.ledger.attach_citation(self.workflow_id, c, actor_id="dockpilot-rag")
        return {
            "ok": True,
            "citations": [c.model_dump() for c in citations],
        }

    def record_receiver_confirmation(self, revision_id: int, actor_id: str = "receiver-01") -> dict[str, Any]:
        """Bind receiver read-back confirmation strictly to the active revision_id."""
        snap = self.ledger.get_snapshot(self.workflow_id)
        if snap.stage == WorkflowStage.IDENTIFY:
            return {
                "ok": False,
                "error_code": "INVALID_STATE",
                "message": "Cannot confirm before resolving PO and creating a draft revision.",
            }
        try:
            snap, draft = self.ledger.confirm_draft(self.workflow_id, revision_id, actor_id)
            return {
                "ok": True,
                "stage": snap.stage.value,
                "revision_id": draft.revision_id,
                "total_pieces": draft.total_pieces,
                "requires_supervisor_approval": draft.requires_supervisor_approval,
                "status": draft.status,
            }
        except DomainRuleError as err:
            return self._error_payload(err)

    def request_supervisor_approval(self, revision_id: int, reason: str) -> dict[str, Any]:
        """Place confirmed revision into the Supervisor HITL approval queue."""
        snap = self.ledger.get_snapshot(self.workflow_id)
        if snap.stage == WorkflowStage.IDENTIFY:
            return {
                "ok": False,
                "error_code": "INVALID_STATE",
                "message": "Identify PO and create a draft revision first.",
            }
        try:
            snap = self.ledger.request_approval(self.workflow_id, revision_id, actor_id="dockpilot-fsm", reason=reason)
            return {
                "ok": True,
                "stage": snap.stage.value,
                "revision_id": revision_id,
                "awaiting_supervisor_action": True,
            }
        except DomainRuleError as err:
            return self._error_payload(err)

    def commit_goods_receipt(self, revision_id: int, idempotency_key: str) -> dict[str, Any]:
        """Atomically post GRN, inventory movement, and DRAFT supplier claim if cleared."""
        snap = self.ledger.get_snapshot(self.workflow_id)
        if snap.stage == WorkflowStage.IDENTIFY:
            return {
                "ok": False,
                "error_code": "INVALID_STATE",
                "message": "Cannot commit before PO identification and draft confirmation.",
            }
        try:
            snap, grn, replay = self.ledger.commit_grn(
                workflow_id=self.workflow_id,
                revision_id=revision_id,
                idempotency_key=idempotency_key,
                actor_id="dockpilot-fsm",
            )
            return {
                "ok": True,
                "stage": snap.stage.value,
                "idempotent_replay": replay,
                "grn_id": grn.grn_id,
                "revision_id": grn.revision_id,
                "received_pieces": grn.received_pieces,
                "shortage_pieces": grn.shortage_pieces,
                "inventory_balance": snap.inventory_balance,
                "claim_id": grn.claim_id,
                "claim_status": snap.claim_pack.status if snap.claim_pack else "NONE",
            }
        except DomainRuleError as err:
            return self._error_payload(err)

    def stage_prompt_card(self, snapshot: WorkflowSnapshot) -> dict[str, object]:
        """Return compact prompt card corresponding to current FSM stage."""
        return get_prompt_card(snapshot.stage)


def build_tool_declarations() -> list[types.FunctionDeclaration]:
    """Fixed 6-tool Gemini Live declarations passed strictly at session setup."""
    return [
        types.FunctionDeclaration(
            name="resolve_po_and_challan",
            description="Look up Purchase Order, supplier invoice, e-Way Bill status, and SKU pack size.",
            parameters=types.Schema(
                type="OBJECT",
                properties={"po_number": types.Schema(type="STRING", description="e.g. PO-4471")},
                required=["po_number"],
            ),
        ),
        types.FunctionDeclaration(
            name="compute_receipt_draft",
            description="Calculate total received pieces from cartons and loose pieces in backend code, invalidating older drafts.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "po_number": types.Schema(type="STRING"),
                    "cartons": types.Schema(type="INTEGER"),
                    "loose_pieces": types.Schema(type="INTEGER"),
                    "pack_unit": types.Schema(type="STRING"),
                    "transcript": types.Schema(type="STRING"),
                    "uom_confirmed": types.Schema(type="BOOLEAN"),
                },
                required=["po_number", "cartons", "loose_pieces"],
            ),
        ),
        types.FunctionDeclaration(
            name="search_receiving_sop",
            description="Search English Enterprise Receiving SOPs and return cited <=150-token policy clauses.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "query": types.Schema(type="STRING"),
                    "scope": types.Schema(type="STRING"),
                },
                required=["query"],
            ),
        ),
        types.FunctionDeclaration(
            name="record_receiver_confirmation",
            description="Record receiver spoken confirmation bound strictly to the current revision_id.",
            parameters=types.Schema(
                type="OBJECT",
                properties={"revision_id": types.Schema(type="INTEGER")},
                required=["revision_id"],
            ),
        ),
        types.FunctionDeclaration(
            name="request_supervisor_approval",
            description="Route a confirmed revision with policy hold to the Supervisor approval pane.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "revision_id": types.Schema(type="INTEGER"),
                    "reason": types.Schema(type="STRING"),
                },
                required=["revision_id", "reason"],
            ),
        ),
        types.FunctionDeclaration(
            name="commit_goods_receipt",
            description="Commit an approved or policy-clean revision into inventory and generate GRN + DRAFT debit note.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "revision_id": types.Schema(type="INTEGER"),
                    "idempotency_key": types.Schema(type="STRING"),
                },
                required=["revision_id", "idempotency_key"],
            ),
        ),
    ]


def build_adk_root_agent(toolkit: DockPilotToolkit, model: str = "gemini-3.8-live") -> LlmAgent:
    """Construct a single ADK root agent with bounded deterministic tools (zero live transfers)."""
    tools = [
        FunctionTool(toolkit.resolve_po_and_challan),
        FunctionTool(toolkit.compute_receipt_draft),
        FunctionTool(toolkit.search_receiving_sop),
        FunctionTool(toolkit.record_receiver_confirmation),
        FunctionTool(toolkit.request_supervisor_approval),
        FunctionTool(toolkit.commit_goods_receipt),
    ]
    return LlmAgent(
        name="dockpilot_root_agent",
        model=model,
        instruction=get_prompt_card(WorkflowStage.IDENTIFY)["text"],
        tools=tools,
    )
