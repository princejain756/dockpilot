"""Unit tests for Live gateway speech/VAD config, modality token metering, failover, and Vertex RAG."""

from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace

import httpx
from fastapi.testclient import TestClient
from google.genai import types

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.ledger import create_ledger_store
from app.live_gateway import LiveGatewaySession, WorkflowBroadcastHub, extract_usage_tokens
from app.main import create_app
from app.models import WorkflowStage
from app.rag import SOPRetriever
from app.telemetry import FinOpsMeter


def test_live_config_populates_speech_vad_compression_and_resumption(tmp_path: Path):
    settings = Settings(
        gcp_project_id="test-proj",
        gcp_location="asia-south1",
        vertex_fallback_location="us-central1",
        gemini_live_voice="Despina",
        gemini_live_language_code="hi-IN",
        storage_backend="sqlite",
        sqlite_path=str(tmp_path / "live_cfg.sqlite3"),
    )
    ledger = create_ledger_store(settings)
    retriever = SOPRetriever(settings)
    hub = WorkflowBroadcastHub()
    session = LiveGatewaySession(
        workflow_id="WF-CFG",
        settings=settings,
        ledger=ledger,
        retriever=retriever,
        hub=hub,
    )

    cfg = session._live_config(WorkflowStage.RECONCILE)
    assert cfg.speech_config is not None
    assert cfg.speech_config.language_code == "hi-IN"
    assert cfg.speech_config.voice_config is not None
    assert cfg.speech_config.voice_config.prebuilt_voice_config is not None
    assert cfg.speech_config.voice_config.prebuilt_voice_config.voice_name == "Despina"

    assert cfg.realtime_input_config is not None
    vad = cfg.realtime_input_config.automatic_activity_detection
    assert vad is not None
    assert vad.disabled is False
    assert vad.start_of_speech_sensitivity == types.StartSensitivity.START_SENSITIVITY_HIGH
    assert vad.end_of_speech_sensitivity == types.EndSensitivity.END_SENSITIVITY_LOW
    assert vad.prefix_padding_ms == 150
    assert vad.silence_duration_ms == 500

    assert cfg.context_window_compression is not None
    assert cfg.session_resumption is not None


def test_extract_usage_tokens_modality_split_and_fallback():
    um = types.UsageMetadata(
        prompt_token_count=18,
        response_token_count=92,
        prompt_tokens_details=[
            types.ModalityTokenCount(modality=types.MediaModality.TEXT, token_count=18),
        ],
        response_tokens_details=[
            types.ModalityTokenCount(modality=types.MediaModality.AUDIO, token_count=78),
            types.ModalityTokenCount(modality=types.MediaModality.TEXT, token_count=14),
        ],
    )
    toks = extract_usage_tokens(um)
    assert toks == {"text_in": 18, "image_in": 0, "audio_in": 0, "text_out": 14, "audio_out": 78}

    meter = FinOpsMeter(fx_inr_per_usd=84.50)
    meter.record_usage(**toks, is_new_turn=True)
    # 78 audio_out tokens billed at $12/1M = 0.000936 USD vs text_out at $4.50/1M
    expected_usd = ((18 * 0.75) + (14 * 4.50) + (78 * 12.00)) / 1_000_000.0
    assert abs(meter.metered_usd() - expected_usd) < 1e-12

    legacy_um = SimpleNamespace(prompt_token_count=25, candidates_token_count=40)
    assert extract_usage_tokens(legacy_um) == {
        "text_in": 25,
        "image_in": 0,
        "audio_in": 0,
        "text_out": 40,
        "audio_out": 0,
    }


def test_vertex_rag_retrieve_contexts_parsing_and_fallback(monkeypatch, tmp_path: Path):
    import google.auth

    corpus = "projects/493779545452/locations/asia-south1/ragCorpora/2305843009213693952"
    settings = Settings(
        gcp_project_id="gen-lang-client-0804407993",
        gcp_location="asia-south1",
        vertex_rag_corpus=corpus,
    )
    retriever = SOPRetriever(settings)

    class _FakeCreds:
        valid = True
        token = "fake-token"

        def refresh(self, _req):
            return None

    monkeypatch.setattr(google.auth, "default", lambda scopes=None: (_FakeCreds(), "gen-lang-client-0804407993"))

    sample_payload = {
        "contexts": {
            "contexts": [
                {
                    "sourceUri": "receiving_sop_v2.txt",
                    "sourceDisplayName": "receiving_sop_v2.txt",
                    "text": (
                        "# Receiving SOP v2 (English)\n"
                        "Document ID: SOP-RCV-002\n"
                        "Revision: v2\n"
                        "Effective Date: 2026-10-01\n\n"
                        "## Clause 4: Partial Receipt Shortage and Supervisor Approval Threshold\n"
                        "When physical dock count is lower than PO expected pieces, block commit above INR 25,000."
                    ),
                }
            ]
        }
    }

    class _OkResp:
        def raise_for_status(self):
            return None

        def json(self):
            return sample_payload

    captured: dict[str, object] = {}

    def _fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        captured["timeout"] = timeout
        return _OkResp()

    monkeypatch.setattr(httpx, "post", _fake_post)
    hits = retriever.search("shortage approval 25000", scope="receiving", top_k=2)
    assert len(hits) == 1
    assert hits[0].source_backend == "vertex_rag"
    assert hits[0].doc_id == "SOP-RCV-002"
    assert "Clause 4" in hits[0].clause
    assert "asia-south1-aiplatform.googleapis.com" in str(captured["url"])

    # Network failure falls back cleanly to local index
    def _fail_post(*_args, **_kwargs):
        raise httpx.ConnectError("simulated timeout")

    monkeypatch.setattr(httpx, "post", _fail_post)
    fb_hits = retriever.search("shortage approval 25000", scope="receiving", top_k=2)
    assert len(fb_hits) >= 1
    assert fb_hits[0].source_backend == "local_index"
    assert fb_hits[0].doc_id == "SOP-RCV-002"


def test_health_exposes_live_voice_vad_fallback_and_rag(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("DOCKPILOT_SQLITE_PATH", str(tmp_path / "health_test.sqlite3"))
    monkeypatch.setenv("STORAGE_BACKEND", "sqlite")
    monkeypatch.setenv("GCP_PROJECT_ID", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("VERTEX_RAG_CORPUS", "projects/493779545452/locations/asia-south1/ragCorpora/123")
    monkeypatch.setenv("VERTEX_FALLBACK_LOCATION", "us-central1")
    monkeypatch.setenv("GEMINI_LIVE_VOICE", "Despina")
    monkeypatch.setenv("GEMINI_LIVE_LANGUAGE_CODE", "hi-IN")

    client = TestClient(create_app())
    h = client.get("/api/health").json()
    assert h["status"] == "ok"
    assert h["voice"] == "Despina"
    assert h["language_code"] == "hi-IN"
    assert h["semantic_vad"] is True
    assert h["fallback_region"] == "us-central1"
    assert h["rag_backend"] == "vertex_rag"


def test_live_loop_fails_over_to_fallback_region_on_connect_error(monkeypatch, tmp_path: Path):
    import asyncio

    settings = Settings(
        gcp_project_id="test-proj",
        gcp_location="asia-south1",
        vertex_fallback_location="us-central1",
        storage_backend="sqlite",
        sqlite_path=str(tmp_path / "failover.sqlite3"),
    )
    ledger = create_ledger_store(settings)
    retriever = SOPRetriever(settings)
    hub = WorkflowBroadcastHub()
    session = LiveGatewaySession(
        workflow_id="WF-FO",
        settings=settings,
        ledger=ledger,
        retriever=retriever,
        hub=hub,
    )

    attempted_locations: list[str] = []
    broadcast_events: list[dict[str, object]] = []

    async def _fake_broadcast(_wf_id: str, event: dict[str, object]) -> None:
        broadcast_events.append(event)

    monkeypatch.setattr(hub, "broadcast", _fake_broadcast)

    def _fake_build(loc: str):
        attempted_locations.append(loc)
        return (SimpleNamespace(location=loc), settings.gemini_live_model)

    monkeypatch.setattr(session, "_build_client_for_location", _fake_build)

    async def _fake_stream(_ws, client, _model, state):
        if client.location == "asia-south1":
            raise RuntimeError("asia-south1 capacity spike")
        state["received_any_frame"] = True

    monkeypatch.setattr(session, "_stream_live_session", _fake_stream)

    asyncio.run(session._run_live_loop(SimpleNamespace(), SimpleNamespace(location="asia-south1"), settings.gemini_live_model))
    assert attempted_locations == ["us-central1"]
    assert any(ev.get("type") == "region_failover" and ev.get("region") == "us-central1" for ev in broadcast_events)
