"""FastAPI REST and WebSocket integration tests for DockPilot."""

from __future__ import annotations

from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app


def _make_client(monkeypatch, tmp_path: Path) -> TestClient:
    monkeypatch.setenv("DOCKPILOT_SQLITE_PATH", str(tmp_path / "api_test.sqlite3"))
    monkeypatch.setenv("STORAGE_BACKEND", "sqlite")
    monkeypatch.setenv("GCP_PROJECT_ID", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    app = create_app()
    return TestClient(app)


def test_rest_end_to_end_dockpilot_flow(monkeypatch, tmp_path: Path):
    client = _make_client(monkeypatch, tmp_path)

    h = client.get("/api/health").json()
    assert h["status"] == "ok"
    assert h["model"] == "gemini-3.8-live"

    assert client.post("/api/workflows/WF-4471/resolve-po", json={"po_number": "PO-4471"}).status_code == 200
    d1 = client.post(
        "/api/workflows/WF-4471/draft",
        json={"po_number": "PO-4471", "cartons": 11, "loose_pieces": 18, "pack_unit": "peti"},
    )
    assert d1.status_code == 200
    assert d1.json()["draft"]["total_pieces"] == 282

    # Mid-sentence barge-in closes gate then Rev 2 supersedes Rev 1
    b = client.post("/api/workflows/WF-4471/barge-in", json={"transcript_hint": "Ruko 20 loose", "stop_latency_ms": 195})
    assert b.status_code == 200
    assert b.json()["snapshot"]["write_gate_open"] is False

    d2 = client.post(
        "/api/workflows/WF-4471/draft",
        json={"po_number": "PO-4471", "cartons": 11, "loose_pieces": 20, "pack_unit": "peti"},
    )
    assert d2.status_code == 200
    assert d2.json()["draft"]["revision_id"] == 2
    assert d2.json()["draft"]["total_pieces"] == 284

    # Stale Rev 1 commit blocked
    stale = client.post("/api/workflows/WF-4471/test-stale-commit").json()
    assert stale["blocked"] is True
    assert stale["error_code"] == "STALE_REVISION"

    # English SOP search
    rag = client.get("/api/sop/search", params={"workflow_id": "WF-4471", "q": "shortage 25000"})
    assert rag.status_code == 200
    assert rag.json()["citations"][0]["doc_id"] == "SOP-RCV-002"

    # Receiver confirms Rev 2
    assert client.post("/api/workflows/WF-4471/confirm", json={"revision_id": 2}).status_code == 200

    # Receiver cannot self-approve (403)
    bad_apr = client.post(
        "/api/workflows/WF-4471/approve",
        json={"revision_id": 2, "actor_id": "receiver-01", "actor_role": "RECEIVER"},
    )
    assert bad_apr.status_code == 403

    # Supervisor approves Rev 2
    ok_apr = client.post(
        "/api/workflows/WF-4471/approve",
        json={"revision_id": 2, "actor_id": "sup-meera", "actor_role": "SUPERVISOR"},
    )
    assert ok_apr.status_code == 200

    # Atomic commit increments 1000 -> 1284
    c1 = client.post("/api/workflows/WF-4471/commit", json={"revision_id": 2, "idempotency_key": "idem-api-1"})
    assert c1.status_code == 200
    assert c1.json()["snapshot"]["inventory_balance"] == 1284
    assert c1.json()["idempotent_replay"] is False

    # Duplicate retry returns existing GRN with zero double-add
    dup = client.post("/api/workflows/WF-4471/test-duplicate-commit").json()
    assert dup["idempotent_replay"] is True
    assert dup["snapshot"]["inventory_balance"] == 1284

    # Claim pack downloadable
    claim = client.get("/api/workflows/WF-4471/debit-note-pack").json()
    assert claim["total_debit_note_inr"] == 33040.0


def test_websocket_barge_in_and_telemetry_sync(monkeypatch, tmp_path: Path):
    client = _make_client(monkeypatch, tmp_path)
    with client.websocket_connect("/ws/dock/WF-4471") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello"
        assert hello["live_backend"] == "local_simulator"

        ws.send_json({"type": "barge_in", "transcript_hint": "twenty loose", "stop_latency_ms": 180.0})
        msg = ws.receive_json()
        assert msg["type"] == "barge_in_recorded"
        assert msg["snapshot"]["write_gate_open"] is False

        ws.send_json(
            {
                "type": "acoustic_telemetry",
                "snr_before_db": 4.2,
                "snr_after_db": 15.8,
                "dropped_frames": 0,
                "filter_mode": "rnnoise_wasm",
            }
        )
        tmsg = ws.receive_json()
        assert tmsg["type"] == "telemetry"
        assert tmsg["telemetry"]["snr_after_db"] == 15.8
