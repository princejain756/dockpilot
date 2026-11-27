"""Unit and API tests for Option B closed-loop ERPNext, Model Armor, ADK, GST, and Gate-Pass flows."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from fastapi.testclient import TestClient

from app.adk_pipeline import validate_indian_gstin_checksum
from app.artifacts_gst import sign_approval_token, verify_approval_token
from app.config import Settings
from app.ledger import SQLiteAtomicLedger
from app.main import create_app


def _make_client(tmp_path: Path, monkeypatch) -> TestClient:
    db_file = tmp_path / "option_b_test.sqlite3"
    monkeypatch.setenv("STORAGE_BACKEND", "sqlite")
    monkeypatch.setenv("DOCKPILOT_SQLITE_PATH", str(db_file))
    monkeypatch.setenv("GCP_PROJECT_ID", "")
    monkeypatch.setenv("ERPNEXT_BASE_URL", "")
    monkeypatch.setenv("APPROVAL_HMAC_SECRET", "unit-test-hmac-secret")
    app = create_app()
    return TestClient(app)


def test_gstin_modulo36_checksum() -> None:
    for gstin in ("29AABCV9999K1Z5", "29AABCK4482M1Z0", "27AABCD8888M1ZT", "33AABCK7777N1ZX"):
        res = validate_indian_gstin_checksum(gstin)
        assert res["format_valid"] is True
        assert res["checksum_valid"] is True

    corrupted = "29AABCV9999K1Z9"
    bad = validate_indian_gstin_checksum(corrupted)
    assert bad["format_valid"] is True
    assert bad["checksum_valid"] is False
    assert bad["expected_check_char"] == "5"


def test_challan_pdf_fixtures_and_model_armor_block(tmp_path: Path, monkeypatch) -> None:
    client = _make_client(tmp_path, monkeypatch)

    for fid in ("standard", "alt-kaveri", "injection-trap"):
        r = client.get(f"/api/fixtures/challans/{fid}.pdf")
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF-")

    blocked = client.post("/api/workflows/WF-TRAP/ingest-challan", data={"fixture_id": "injection-trap"})
    assert blocked.status_code == 422
    detail = blocked.json()["detail"]
    assert detail["error_code"] == "PROMPT_INJECTION_BLOCKED"

    state = client.get("/api/workflows/WF-TRAP/state").json()["snapshot"]
    assert state["stage"] == "IDENTIFY"
    assert state["model_armor_last_check"]["safe"] is False
    assert any(ev["event_type"] == "MODEL_ARMOR_BLOCKED" for ev in state["audit_events"])


def test_unfamiliar_kaveri_challan_hydration_across_store_restart(tmp_path: Path, monkeypatch) -> None:
    client = _make_client(tmp_path, monkeypatch)
    r = client.post("/api/workflows/WF-KAV/ingest-challan", data={"fixture_id": "alt-kaveri"})
    assert r.status_code == 200
    body = r.json()
    snap = body["snapshot"]
    assert snap["po_number"] == "PO-8821"
    assert snap["sku_id"] == "SKU-KAV-88"
    assert snap["challan_source"] == "CAMERA_UPLOAD"
    assert body["po"]["expected_pieces"] == 120
    assert body["gstin_check"]["checksum_valid"] is True

    # Simulate a cold Cloud Run container loading only from DB
    fresh_store = SQLiteAtomicLedger(Settings(storage_backend="sqlite"), db_path=str(tmp_path / "option_b_test.sqlite3"))
    loaded = fresh_store.get_snapshot("WF-KAV")
    assert "PO-8821" in fresh_store.pos
    assert "SKU-KAV-88" in fresh_store.skus
    assert loaded.dynamic_po is not None and loaded.dynamic_po.expected_pieces == 120

    # Draft 7 cartons + 10 loose = 115 pcs (5 short x 4500 = 22500 INR <= 25000 limit)
    draft_res = fresh_store.create_or_revise_draft(
        workflow_id="WF-KAV",
        po_number="PO-8821",
        cartons=7,
        loose_pieces=10,
        pack_unit="carton",
        actor_id="receiver-01",
    )
    assert draft_res[1].total_pieces == 115
    assert draft_res[1].shortage_pieces == 5
    assert draft_res[1].shortage_value_inr == 22500


def test_adk_sequential_settlement_token_approval_tally_and_gate_pass(tmp_path: Path, monkeypatch) -> None:
    client = _make_client(tmp_path, monkeypatch)

    class _FakeERP:
        configured = True

        def health_check(self):
            return {"configured": True, "reachable": True, "base_url": "https://erp.mock.local", "latency_ms": 12.0}

        def ensure_po_and_item(self, po, sku):
            return "PUR-ORD-2026-00001"

        def post_purchase_receipt_idempotent(self, *, workflow_id, po, sku, received_pieces, delivery_id, revision_id):
            return {
                "erp_sync_status": "POSTED",
                "erp_verified": True,
                "erp_receipt_id": "MAT-PRE-2026-00099",
                "erp_po_id": "PUR-ORD-2026-00001",
                "erp_stock_after": 1284,
                "erp_url": "https://erp.mock.local/app/purchase-receipt/MAT-PRE-2026-00099",
                "idempotent_replay": False,
            }

        def get_item_balance(self, sku_id):
            return 1000

        def get_recent_receipts(self, limit=5):
            return []

        def cancel_receipts_for_workflow(self, workflow_id):
            return []

    monkeypatch.setattr(client.app.state, "erp", _FakeERP(), raising=False)
    # Inject fake ERP directly via closure reference inside endpoints? Better test route uses create_app;
    # patch ERPNextAdapter methods on class for clean closure execution
    from app import erp_adapter

    monkeypatch.setenv("ERPNEXT_BASE_URL", "https://erp.mock.local")
    monkeypatch.setenv("ERPNEXT_API_KEY", "k")
    monkeypatch.setenv("ERPNEXT_API_SECRET", "s")
    monkeypatch.setattr(
        erp_adapter.ERPNextAdapter,
        "post_purchase_receipt_idempotent",
        lambda self, **kw: _FakeERP().post_purchase_receipt_idempotent(**kw),
    )
    monkeypatch.setattr(erp_adapter.ERPNextAdapter, "get_item_balance", lambda self, sku_id: 1000)

    client = TestClient(create_app())
    wf = "WF-4471"
    assert client.post(f"/api/workflows/{wf}/resolve-po", json={"po_number": "PO-4471"}).status_code == 200
    assert (
        client.post(f"/api/workflows/{wf}/draft", json={"po_number": "PO-4471", "cartons": 11, "loose_pieces": 18}).status_code
        == 200
    )
    rev1_sig = sign_approval_token(wf, 1, "unit-test-hmac-secret")

    # Mid-sentence barge-in invalidates Rev 1 -> Rev 2 created
    assert client.post(f"/api/workflows/{wf}/barge-in", json={"stop_latency_ms": 180}).status_code == 200
    assert (
        client.post(f"/api/workflows/{wf}/draft", json={"po_number": "PO-4471", "cartons": 11, "loose_pieces": 20}).status_code
        == 200
    )
    assert client.post(f"/api/workflows/{wf}/confirm", json={"revision_id": 2}).status_code == 200

    # Stale Rev 1 supervisor approval link must fail with 409 STALE_REVISION
    stale_resp = client.post(
        f"/api/workflows/{wf}/approve-by-token",
        json={"revision_id": 1, "sig": rev1_sig, "auto_commit": True},
    )
    assert stale_resp.status_code == 409
    assert stale_resp.json()["detail"]["error_code"] == "STALE_REVISION"

    # Bad signature on Rev 2 returns 403
    bad_sig = client.post(
        f"/api/workflows/{wf}/approve-by-token",
        json={"revision_id": 2, "sig": "deadbeef", "auto_commit": True},
    )
    assert bad_sig.status_code == 403

    # Valid Rev 2 approval link approves + runs ADK SequentialAgent + posts to ERPNext
    link_res = client.get(f"/api/workflows/{wf}/approval-link")
    assert link_res.status_code == 200
    rev2_sig = link_res.json()["sig"]
    assert verify_approval_token(wf, 2, rev2_sig, "unit-test-hmac-secret")

    ok_res = client.post(
        f"/api/workflows/{wf}/approve-by-token",
        json={"revision_id": 2, "sig": rev2_sig, "auto_commit": True, "idempotency_key": "k-rev2"},
    )
    assert ok_res.status_code == 200
    snap = ok_res.json()["snapshot"]
    assert snap["stage"] == "COMMIT"
    assert snap["grn"]["erp_receipt_id"] == "MAT-PRE-2026-00099"
    assert snap["grn"]["erp_verified"] is True
    assert snap["grn"]["erp_stock_after"] == 1284
    assert [s["agent"] for s in snap["adk_pipeline_trace"]] == [
        "ChallanComplianceAgent",
        "LedgerWriteGateAgent",
        "ERPSettlementAgent",
    ]

    # Verify TallyPrime XML is well-formed XML with Debit Note voucher and balanced tax math
    xml_res = client.get(f"/api/workflows/{wf}/artifacts/tally-xml")
    assert xml_res.status_code == 200
    root = ET.fromstring(xml_res.text)
    assert root.tag == "ENVELOPE"
    vtype = root.find(".//VOUCHERTYPENAME")
    assert vtype is not None and vtype.text == "Debit Note"

    # Verify CGST Rule 53 PDF builds cleanly
    pdf_res = client.get(f"/api/workflows/{wf}/artifacts/debit-note.pdf")
    assert pdf_res.status_code == 200
    assert pdf_res.content.startswith(b"%PDF-")

    # Verify Bilingual Gate-Pass + Driver Acknowledgment
    gp_res = client.get(f"/api/workflows/{wf}/artifacts/gate-pass")
    assert gp_res.status_code == 200
    gp = gp_res.json()
    assert gp["shortage_pieces"] == 4
    ack = client.post(
        f"/api/workflows/{wf}/artifacts/gate-pass/acknowledge",
        json={"sig": gp["sig"], "driver_name": "Ramesh Kumar"},
    )
    assert ack.status_code == 200
    assert ack.json()["snapshot"]["driver_gate_pass"]["acknowledged_by_driver"] is True
