"""30+ deterministic invariant, race, security, RAG, and FinOps tests for DockPilot."""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.ledger import SQLiteAtomicLedger
from app.models import ActorRole, DomainRuleError, WorkflowStage
from app.prompt_cards import get_prompt_card
from app.rag import SOPRetriever
from app.telemetry import FinOpsMeter
from app.tools_adk import DockPilotToolkit, build_adk_root_agent, build_tool_declarations


@pytest.fixture()
def ctx(tmp_path: Path):
    settings = Settings(sqlite_path=str(tmp_path / "test.sqlite3"), hitl_shortage_threshold_inr=25000)
    ledger = SQLiteAtomicLedger(settings)
    retriever = SOPRetriever(settings)
    return settings, ledger, retriever


def test_01_initial_snapshot_seeded(ctx):
    _, ledger, _ = ctx
    snap = ledger.get_snapshot("WF-4471")
    assert snap.stage == WorkflowStage.IDENTIFY
    assert snap.inventory_balance == 1000
    assert snap.write_gate_open is True


def test_02_resolve_po_4471_advances_stage(ctx):
    _, ledger, _ = ctx
    snap, po, sku = ledger.resolve_po("WF-4471", "4471", "receiver-01")
    assert po.po_number == "PO-4471"
    assert sku.sku_id == "SKU-24"
    assert snap.stage == WorkflowStage.RECONCILE


def test_03_unknown_po_raises_404(ctx):
    _, ledger, _ = ctx
    with pytest.raises(DomainRuleError) as exc:
        ledger.resolve_po("WF-4471", "PO-9999", "receiver-01")
    assert exc.value.status_code == 404
    assert exc.value.code == "PO_NOT_FOUND"


def test_04_canonical_draft_rev1_282_pieces(ctx):
    _, ledger, _ = ctx
    snap, rev1 = ledger.create_or_revise_draft(
        workflow_id="WF-4471",
        po_number="PO-4471",
        cartons=11,
        loose_pieces=18,
        pack_unit="peti",
        actor_id="receiver-01",
    )
    assert rev1.revision_id == 1
    assert rev1.total_pieces == 282
    assert rev1.shortage_pieces == 6
    assert rev1.shortage_value_inr == 42000
    assert rev1.requires_supervisor_approval is True
    assert snap.inventory_balance == 1000


def test_05_barge_in_closes_write_gate_and_supersedes_draft(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=18, pack_unit="peti", actor_id="receiver-01"
    )
    snap = ledger.handle_barge_in("WF-4471", "receiver-01", "Ruko, twenty loose")
    assert snap.write_gate_open is False
    assert snap.revisions[0].status == "SUPERSEDED"


def test_06_commit_blocked_while_write_gate_closed(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=18, pack_unit="peti", actor_id="receiver-01"
    )
    ledger.handle_barge_in("WF-4471", "receiver-01")
    with pytest.raises(DomainRuleError) as exc:
        ledger.commit_grn(workflow_id="WF-4471", revision_id=1, idempotency_key="k1", actor_id="sys")
    assert exc.value.code == "WRITE_GATE_CLOSED"


def test_07_correction_mints_rev2_284_and_invalidates_rev1(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=18, pack_unit="peti", actor_id="receiver-01"
    )
    ledger.confirm_draft("WF-4471", 1, "receiver-01")
    snap, rev2 = ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="receiver-01"
    )
    assert rev2.revision_id == 2
    assert rev2.total_pieces == 284
    assert rev2.shortage_pieces == 4
    assert rev2.shortage_value_inr == 28000
    assert snap.revisions[0].status == "SUPERSEDED"
    assert snap.write_gate_open is True


def test_08_stale_rev1_confirmation_rejected(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=18, pack_unit="peti", actor_id="receiver-01"
    )
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="receiver-01"
    )
    with pytest.raises(DomainRuleError) as exc:
        ledger.confirm_draft("WF-4471", 1, "receiver-01")
    assert exc.value.code == "STALE_REVISION"


def test_09_stale_rev1_approval_rejected(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=18, pack_unit="peti", actor_id="receiver-01"
    )
    ledger.confirm_draft("WF-4471", 1, "receiver-01")
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="receiver-01"
    )
    with pytest.raises(DomainRuleError) as exc:
        ledger.approve_revision(
            workflow_id="WF-4471", revision_id=1, actor_id="sup-01", actor_role=ActorRole.SUPERVISOR, reason="ok"
        )
    assert exc.value.code == "STALE_REVISION"


def test_10_receiver_self_approval_forbidden_403(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="receiver-01"
    )
    ledger.confirm_draft("WF-4471", 1, "receiver-01")
    with pytest.raises(DomainRuleError) as exc:
        ledger.approve_revision(
            workflow_id="WF-4471", revision_id=1, actor_id="receiver-01", actor_role=ActorRole.RECEIVER, reason="self"
        )
    assert exc.value.status_code == 403
    assert exc.value.code == "FORBIDDEN_ROLE"


def test_11_approval_requires_receiver_confirmation_first(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="receiver-01"
    )
    with pytest.raises(DomainRuleError) as exc:
        ledger.approve_revision(
            workflow_id="WF-4471", revision_id=1, actor_id="sup-01", actor_role=ActorRole.SUPERVISOR, reason="early"
        )
    assert exc.value.code == "CONFIRMATION_REQUIRED"


def test_12_unapproved_shortage_over_25k_blocked(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="receiver-01"
    )
    ledger.confirm_draft("WF-4471", 1, "receiver-01")
    with pytest.raises(DomainRuleError) as exc:
        ledger.commit_grn(workflow_id="WF-4471", revision_id=1, idempotency_key="k-no-apr", actor_id="sys")
    assert exc.value.code == "SUPERVISOR_APPROVAL_REQUIRED"
    assert ledger.get_snapshot("WF-4471").inventory_balance == 1000


def test_13_full_canonical_flow_posts_1284_once_and_emits_gst_claim(ctx):
    _, ledger, retriever = ctx
    ledger.resolve_po("WF-4471", "PO-4471", "receiver-01")
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=18, pack_unit="peti", actor_id="receiver-01"
    )
    ledger.handle_barge_in("WF-4471", "receiver-01", "Ruko eighteen nahi twenty loose")
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="receiver-01"
    )
    cites = retriever.search("shortage approval 25000", scope="receiving")
    ledger.attach_citation("WF-4471", cites[0], "rag")
    ledger.confirm_draft("WF-4471", 2, "receiver-01")
    ledger.approve_revision(
        workflow_id="WF-4471",
        revision_id=2,
        actor_id="sup-meera",
        actor_role=ActorRole.SUPERVISOR,
        reason="Verified 4 short pcs against CH-4471",
    )
    snap, grn, replay = ledger.commit_grn(
        workflow_id="WF-4471", revision_id=2, idempotency_key="idem-4471-rev2", actor_id="sys"
    )
    assert replay is False
    assert grn.grn_id == "GRN-4471"
    assert grn.received_pieces == 284
    assert snap.inventory_balance == 1284
    assert snap.claim_pack is not None
    assert snap.claim_pack.taxable_shortage_inr == 28000
    assert snap.claim_pack.cgst_inr == 2520.0
    assert snap.claim_pack.sgst_inr == 2520.0
    assert snap.claim_pack.total_debit_note_inr == 33040.0
    assert snap.claim_pack.status == "DRAFT"


def test_14_idempotent_retry_and_duplicate_commit_do_not_double_add(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="receiver-01"
    )
    ledger.confirm_draft("WF-4471", 1, "receiver-01")
    ledger.approve_revision(
        workflow_id="WF-4471", revision_id=1, actor_id="sup-01", actor_role=ActorRole.SUPERVISOR, reason="ok"
    )
    _, grn1, r1 = ledger.commit_grn(workflow_id="WF-4471", revision_id=1, idempotency_key="idem-1", actor_id="sys")
    snap2, grn2, r2 = ledger.commit_grn(workflow_id="WF-4471", revision_id=1, idempotency_key="idem-1", actor_id="sys")
    snap3, grn3, r3 = ledger.commit_grn(workflow_id="WF-4471", revision_id=1, idempotency_key="idem-different", actor_id="sys")
    assert r1 is False
    assert r2 is True
    assert r3 is True
    assert grn1.grn_id == grn2.grn_id == grn3.grn_id
    assert snap2.inventory_balance == snap3.inventory_balance == 1284


@pytest.mark.asyncio
async def test_15_concurrent_race_stale_rev1_and_duplicate_rev2(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=18, pack_unit="peti", actor_id="receiver-01"
    )
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="receiver-01"
    )
    ledger.confirm_draft("WF-4471", 2, "receiver-01")
    ledger.approve_revision(
        workflow_id="WF-4471", revision_id=2, actor_id="sup-01", actor_role=ActorRole.SUPERVISOR, reason="ok"
    )

    async def attempt(rev: int, key: str):
        return await asyncio.to_thread(
            ledger.commit_grn, workflow_id="WF-4471", revision_id=rev, idempotency_key=key, actor_id="race"
        )

    results = await asyncio.gather(
        attempt(1, "stale-k"),
        attempt(2, "dup-k"),
        attempt(2, "dup-k"),
        attempt(2, "dup-k-2"),
        return_exceptions=True,
    )
    assert isinstance(results[0], DomainRuleError)
    assert results[0].code == "STALE_REVISION"
    non_replay = [r for r in results[1:] if not isinstance(r, Exception) and r[2] is False]
    assert len(non_replay) == 1
    assert ledger.get_snapshot("WF-4471").inventory_balance == 1284


def test_16_supervisor_reversal_creates_compensating_entry_only(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="receiver-01"
    )
    ledger.confirm_draft("WF-4471", 1, "receiver-01")
    ledger.approve_revision(
        workflow_id="WF-4471", revision_id=1, actor_id="sup-01", actor_role=ActorRole.SUPERVISOR, reason="ok"
    )
    ledger.commit_grn(workflow_id="WF-4471", revision_id=1, idempotency_key="k1", actor_id="sys")

    with pytest.raises(DomainRuleError) as exc:
        ledger.reverse_grn(workflow_id="WF-4471", actor_id="receiver-01", actor_role=ActorRole.RECEIVER, reason="bad")
    assert exc.value.status_code == 403

    snap, mov = ledger.reverse_grn(
        workflow_id="WF-4471", actor_id="sup-01", actor_role=ActorRole.SUPERVISOR, reason="Wrong batch"
    )
    assert mov.delta_pieces == -284
    assert snap.inventory_balance == 1000
    assert snap.grn.reversed is True
    assert len(snap.movements) == 2
    assert snap.stage == WorkflowStage.REVERSED


def test_17_clean_receipt_under_threshold_commits_without_supervisor(ctx):
    _, ledger, _ = ctx
    # PO-4474 expects 10 peti * 12 = 120; receiving 118 -> 2 short * 4,200 = 8,400 (<= 25,000)
    ledger.resolve_po("WF-4474", "PO-4474", "receiver-01")
    _, rev1 = ledger.create_or_revise_draft(
        workflow_id="WF-4474", po_number="PO-4474", cartons=9, loose_pieces=10, pack_unit="peti", actor_id="receiver-01"
    )
    assert rev1.total_pieces == 118
    assert rev1.shortage_value_inr == 8400
    assert rev1.requires_supervisor_approval is False
    snap, _ = ledger.confirm_draft("WF-4474", 1, "receiver-01")
    assert snap.stage == WorkflowStage.COMMIT
    snap2, grn, _ = ledger.commit_grn(workflow_id="WF-4474", revision_id=1, idempotency_key="k4474", actor_id="sys")
    assert grn.received_pieces == 118
    assert snap2.inventory_balance == 618


def test_18_expired_eway_bill_forces_hold_exception(ctx):
    _, ledger, _ = ctx
    snap, po, _ = ledger.resolve_po("WF-4472", "PO-4472", "receiver-01")
    assert po.eway_bill.status == "EXPIRED"
    assert snap.stage == WorkflowStage.HOLD_EXCEPTION
    snap2, rev = ledger.create_or_revise_draft(
        workflow_id="WF-4472", po_number="PO-4472", cartons=10, loose_pieces=0, pack_unit="peti", actor_id="receiver-01"
    )
    assert "EWAY_BILL_EXPIRED" in rev.hold_reasons
    assert rev.requires_supervisor_approval is True
    assert snap2.stage == WorkflowStage.HOLD_EXCEPTION


def test_19_uom_ambiguity_blocks_until_explicitly_confirmed(ctx):
    _, ledger, _ = ctx
    # PO-4473 -> SKU-25 has 'box' flagged ambiguous
    with pytest.raises(DomainRuleError) as exc:
        ledger.create_or_revise_draft(
            workflow_id="WF-4473", po_number="PO-4473", cartons=2, loose_pieces=0, pack_unit="box", actor_id="r1"
        )
    assert exc.value.code == "UOM_AMBIGUITY"
    _, rev = ledger.create_or_revise_draft(
        workflow_id="WF-4473",
        po_number="PO-4473",
        cartons=2,
        loose_pieces=0,
        pack_unit="box",
        actor_id="r1",
        uom_confirmed=True,
    )
    assert rev.total_pieces == 20


def test_20_negative_quantity_rejected_422(ctx):
    _, ledger, _ = ctx
    with pytest.raises(DomainRuleError) as exc:
        ledger.create_or_revise_draft(
            workflow_id="WF-4471", po_number="PO-4471", cartons=-1, loose_pieces=5, pack_unit="peti", actor_id="r1"
        )
    assert exc.value.status_code == 422


def test_21_unknown_uom_rejected_422(ctx):
    _, ledger, _ = ctx
    with pytest.raises(DomainRuleError) as exc:
        ledger.create_or_revise_draft(
            workflow_id="WF-4471", po_number="PO-4471", cartons=5, loose_pieces=0, pack_unit="drum", actor_id="r1"
        )
    assert exc.value.code == "UNKNOWN_UOM"


def test_22_reset_demo_restores_stock_and_clears_workflow(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="r1"
    )
    ledger.confirm_draft("WF-4471", 1, "r1")
    ledger.approve_revision(
        workflow_id="WF-4471", revision_id=1, actor_id="sup", actor_role=ActorRole.SUPERVISOR, reason="ok"
    )
    ledger.commit_grn(workflow_id="WF-4471", revision_id=1, idempotency_key="k1", actor_id="sys")
    assert ledger.get_snapshot("WF-4471").inventory_balance == 1284
    snap = ledger.reset_demo("WF-4471")
    assert snap.inventory_balance == 1000
    assert snap.stage == WorkflowStage.IDENTIFY
    assert snap.revisions == []
    assert snap.grn is None


def test_23_rag_cross_language_hinglish_retrieval_capped_150_tokens(ctx):
    _, _, retriever = ctx
    cites = retriever.search("Chaar short hain approval chahiye kya?", scope="receiving")
    assert len(cites) >= 1
    assert cites[0].doc_id == "SOP-RCV-002"
    assert "25,000" in cites[0].excerpt
    assert len(cites[0].excerpt.split()) <= 115  # <= 150 tokens


def test_24_rag_eway_bill_retrieval(ctx):
    _, _, retriever = ctx
    cites = retriever.search("eway bill expired status", scope="eway")
    assert cites[0].doc_id == "SOP-EWB-003"


def test_25_adk_toolkit_enforces_invalid_state_and_root_agent_builds(ctx):
    _, ledger, retriever = ctx
    toolkit = DockPilotToolkit(ledger, retriever, "WF-TOOL")
    res = toolkit.record_receiver_confirmation(1)
    assert res["ok"] is False
    assert res["error_code"] == "INVALID_STATE"
    res2 = toolkit.commit_goods_receipt(1, "k")
    assert res2["error_code"] == "INVALID_STATE"
    decls = build_tool_declarations()
    assert len(decls) == 6
    agent = build_adk_root_agent(toolkit)
    assert agent.name == "dockpilot_root_agent"
    assert len(agent.tools) == 6


def test_26_adk_toolkit_happy_path_round_trip(ctx):
    _, ledger, retriever = ctx
    toolkit = DockPilotToolkit(ledger, retriever, "WF-4471")
    r1 = toolkit.resolve_po_and_challan("PO-4471")
    assert r1["ok"] is True and r1["pack_size"] == 24
    r2 = toolkit.compute_receipt_draft("PO-4471", 11, 20)
    assert r2["total_pieces"] == 284 and r2["shortage_value_inr"] == 28000
    r3 = toolkit.search_receiving_sop("shortage approval 25000")
    assert r3["ok"] is True
    r4 = toolkit.record_receiver_confirmation(1)
    assert r4["ok"] is True and r4["stage"] == "APPROVE"
    r5 = toolkit.request_supervisor_approval(1, "INR 28,000 shortage")
    assert r5["awaiting_supervisor_action"] is True


def test_27_prompt_cards_under_450_tokens():
    for stage in WorkflowStage:
        card = get_prompt_card(stage)
        assert card["approx_tokens"] < 200
        assert "DockPilot" in card["text"]


def test_28_finops_meter_3_8_live_rates_and_shadow_savings():
    meter = FinOpsMeter(fx_inr_per_usd=84.50)
    meter.duration_seconds = 60.0
    for _ in range(6):
        meter.record_usage(text_in=600, audio_in=512, audio_out=125)
    meter.record_ttfa(640.0)
    meter.record_ttfa(820.0)
    meter.record_barge_stop(210.0)
    snap = meter.snapshot()
    assert 1.50 <= snap["metered_inr_per_min"] <= 2.10
    assert snap["shadow_naive_inr_per_min"] > 8.0
    assert snap["ttfa_p50_ms"] == 640.0
    assert snap["ttfa_p95_ms"] == 820.0
    assert snap["barge_stop_last_ms"] == 210.0


def test_29_rev2_approval_invalidation_if_rev3_created(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="r1"
    )
    ledger.confirm_draft("WF-4471", 1, "r1")
    ledger.approve_revision(
        workflow_id="WF-4471", revision_id=1, actor_id="sup", actor_role=ActorRole.SUPERVISOR, reason="ok"
    )
    # Worker barges in with a fresh count before commit -> invalidates earlier approval!
    snap, rev2 = ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=21, pack_unit="peti", actor_id="r1"
    )
    assert rev2.revision_id == 2
    assert snap.approval is None
    with pytest.raises(DomainRuleError) as exc:
        ledger.commit_grn(workflow_id="WF-4471", revision_id=1, idempotency_key="k-old", actor_id="sys")
    assert exc.value.code == "STALE_REVISION"


def test_30_double_reversal_rejected(ctx):
    _, ledger, _ = ctx
    ledger.create_or_revise_draft(
        workflow_id="WF-4471", po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="r1"
    )
    ledger.confirm_draft("WF-4471", 1, "r1")
    ledger.approve_revision(
        workflow_id="WF-4471", revision_id=1, actor_id="sup", actor_role=ActorRole.SUPERVISOR, reason="ok"
    )
    ledger.commit_grn(workflow_id="WF-4471", revision_id=1, idempotency_key="k1", actor_id="sys")
    ledger.reverse_grn(workflow_id="WF-4471", actor_id="sup", actor_role=ActorRole.SUPERVISOR, reason="r1")
    with pytest.raises(DomainRuleError) as exc:
        ledger.reverse_grn(workflow_id="WF-4471", actor_id="sup", actor_role=ActorRole.SUPERVISOR, reason="r2")
    assert exc.value.code == "ALREADY_REVERSED"
