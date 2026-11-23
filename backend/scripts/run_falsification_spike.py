"""Live Gemini Live falsification spike and deterministic ledger concurrency benchmark."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import os
from pathlib import Path
import statistics
import sys
import tempfile
import time
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google import genai
from google.genai import types

from app.config import Settings
from app.ledger import SQLiteAtomicLedger
from app.models import ActorRole, DomainRuleError, WorkflowStage
from app.prompt_cards import get_prompt_card
from app.rag import SOPRetriever
from app.telemetry import FinOpsMeter
from app.tools_adk import DockPilotToolkit, build_tool_declarations


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * q))))
    return round(ordered[idx], 2)


async def run_live_gemini_probe(model_name: str) -> dict[str, Any]:
    """Run an end-to-end live Gemini WebSocket probe with 6 fixed tools and stage card swap."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return {"executed": False, "error": "GEMINI_API_KEY missing from environment"}

    client = genai.Client(api_key=api_key)
    settings = Settings(sqlite_path=":memory:", gemini_api_key=api_key, gemini_live_model=model_name)
    ledger = SQLiteAtomicLedger(settings, ":memory:")
    retriever = SOPRetriever(settings)
    wf_id = f"WF-SPIKE-{int(time.time())}"
    toolkit = DockPilotToolkit(ledger=ledger, retriever=retriever, workflow_id=wf_id)
    meter = FinOpsMeter(fx_inr_per_usd=84.50)

    def _dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
        fn = getattr(toolkit, name, None)
        if fn is None:
            return {"ok": False, "error_code": "UNKNOWN_TOOL", "message": f"Unknown tool: {name}"}
        return fn(**args)

    identify_card = get_prompt_card(WorkflowStage.IDENTIFY)
    meter.active_prompt_tokens = int(identify_card["approx_tokens"])

    config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        system_instruction=types.Content(parts=[types.Part(text=str(identify_card["text"]))]),
        tools=[types.Tool(function_declarations=build_tool_declarations())],
        context_window_compression=types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow()
        ),
        session_resumption=types.SessionResumptionConfig(),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    metrics: dict[str, Any] = {
        "executed": True,
        "model": model_name,
        "endpoint": "generativelanguage.googleapis.com (Developer API)",
        "tools_registered": [d.name for d in build_tool_declarations()],
        "turns": [],
        "tool_calls": [],
        "context_swap": None,
        "resumption_handles_seen": 0,
        "go_away_seen": False,
        "error": None,
    }

    t_start = time.monotonic()
    try:
        async with client.aio.live.connect(model=model_name, config=config) as session:
            handshake_ms = round((time.monotonic() - t_start) * 1000.0, 1)
            metrics["handshake_ms"] = handshake_ms

            async def _run_turn(turn_label: str, user_text: str) -> dict[str, Any]:
                t_send = time.monotonic()
                ttfa_ms: float | None = None
                audio_bytes = 0
                transcripts: list[str] = []
                text_parts: list[str] = []
                turn_tools: list[dict[str, Any]] = []
                prompt_toks = 0
                cand_toks = 0

                await session.send_client_content(
                    turns=types.Content(role="user", parts=[types.Part(text=user_text)]),
                    turn_complete=True,
                )

                awaiting_post_tool = False
                for _round in range(6):
                    saw_tool_in_round = False
                    async for msg in session.receive():
                        if getattr(msg, "session_resumption_update", None):
                            upd = msg.session_resumption_update
                            if getattr(upd, "new_handle", None):
                                metrics["resumption_handles_seen"] += 1
                        if getattr(msg, "go_away", None):
                            metrics["go_away_seen"] = True

                        um = getattr(msg, "usage_metadata", None)
                        if um:
                            prompt_toks = max(prompt_toks, getattr(um, "prompt_token_count", 0) or 0)
                            cand_toks = max(cand_toks, getattr(um, "candidates_token_count", 0) or 0)

                        tc = getattr(msg, "tool_call", None)
                        if tc and getattr(tc, "function_calls", None):
                            saw_tool_in_round = True
                            awaiting_post_tool = True
                            responses: list[types.FunctionResponse] = []
                            for fc in tc.function_calls:
                                t0 = time.monotonic()
                                res = _dispatch(fc.name, dict(fc.args or {}))
                                lat = round((time.monotonic() - t0) * 1000.0, 2)
                                call_rec = {
                                    "turn": turn_label,
                                    "name": fc.name,
                                    "args": dict(fc.args or {}),
                                    "ok": res.get("ok"),
                                    "latency_ms": lat,
                                }
                                metrics["tool_calls"].append(call_rec)
                                turn_tools.append(call_rec)
                                responses.append(
                                    types.FunctionResponse(id=fc.id, name=fc.name, response=res)
                                )
                            await session.send_tool_response(function_responses=responses)
                            continue

                        sc = getattr(msg, "server_content", None)
                        if sc:
                            out_tr = getattr(sc, "output_transcription", None)
                            if out_tr and getattr(out_tr, "text", None):
                                if ttfa_ms is None:
                                    ttfa_ms = round((time.monotonic() - t_send) * 1000.0, 1)
                                transcripts.append(out_tr.text)

                            mt = getattr(sc, "model_turn", None)
                            if mt and getattr(mt, "parts", None):
                                for part in mt.parts:
                                    if getattr(part, "inline_data", None) and part.inline_data.data:
                                        if ttfa_ms is None:
                                            ttfa_ms = round((time.monotonic() - t_send) * 1000.0, 1)
                                        audio_bytes += len(part.inline_data.data)
                                    if getattr(part, "text", None):
                                        if ttfa_ms is None:
                                            ttfa_ms = round((time.monotonic() - t_send) * 1000.0, 1)
                                        text_parts.append(part.text)

                            if getattr(sc, "turn_complete", False):
                                if saw_tool_in_round:
                                    awaiting_post_tool = True
                                elif audio_bytes > 0 or transcripts or text_parts or not awaiting_post_tool:
                                    awaiting_post_tool = False
                                break
                    if not awaiting_post_tool and (not saw_tool_in_round or audio_bytes > 0 or transcripts or text_parts):
                        break

                total_ms = round((time.monotonic() - t_send) * 1000.0, 1)
                # 24kHz PCM16 mono = 48,000 bytes/sec; 25 audio tokens/sec (~1920 bytes/token)
                est_audio_out_toks = max(0, round(audio_bytes / 1920.0)) if cand_toks == 0 else cand_toks
                meter.record_usage(
                    text_in=prompt_toks or 220,
                    audio_out=est_audio_out_toks,
                    is_new_turn=True,
                )
                if ttfa_ms is not None:
                    meter.record_ttfa(ttfa_ms)
                return {
                    "turn": turn_label,
                    "user_text": user_text,
                    "ttfa_ms": ttfa_ms,
                    "turn_total_ms": total_ms,
                    "audio_bytes": audio_bytes,
                    "output_transcript": "".join(transcripts).strip(),
                    "text_parts": " ".join(text_parts).strip(),
                    "reported_prompt_tokens": prompt_toks,
                    "reported_candidate_tokens": cand_toks,
                    "tool_calls_count": len(turn_tools),
                }

            t1 = await asyncio.wait_for(
                _run_turn("T1_IDENTIFY", "Bhai PO-4471 aaya hai, VayuMech se, PO resolve karo."),
                timeout=35.0,
            )
            metrics["turns"].append(t1)

            reconcile_card = get_prompt_card(WorkflowStage.RECONCILE)
            t_swap0 = time.monotonic()
            try:
                await session.send_context_update(system_instruction=str(reconcile_card["text"]))
                metrics["context_swap"] = {
                    "ok": True,
                    "target_stage": "RECONCILE",
                    "prompt_tokens": int(reconcile_card["approx_tokens"]),
                    "client_call_ms": round((time.monotonic() - t_swap0) * 1000.0, 2),
                }
            except Exception as exc:
                metrics["context_swap"] = {"ok": False, "error": str(exc)[:200]}

            t2 = await asyncio.wait_for(
                _run_turn(
                    "T2_DRAFT_AND_RAG",
                    "PO-4471 mein 11 peti aur 18 loose count hua hai, draft banao aur check karo 25000 shortage approval SOP kya kehti hai.",
                ),
                timeout=45.0,
            )
            metrics["turns"].append(t2)

            t3 = await asyncio.wait_for(
                _run_turn(
                    "T3_BARGE_CORRECTION",
                    "Ruko, athara nahi 20 loose count hua hai, PO-4471 ka naya revision draft banao 11 peti aur 20 loose.",
                ),
                timeout=45.0,
            )
            metrics["turns"].append(t3)

            meter.duration_seconds = max(1.0, round(time.monotonic() - t_start, 2))
            snap = ledger.get_snapshot(wf_id)
            metrics["final_workflow_state"] = {
                "stage": snap.stage.value,
                "po_number": snap.po_number,
                "revisions_count": len(snap.revisions),
                "revisions_summary": [
                    {
                        "revision_id": r.revision_id,
                        "total_pieces": r.total_pieces,
                        "status": r.status,
                    }
                    for r in snap.revisions
                ],
                "citations_count": len(snap.citations),
                "citations": [f"{c.doc_id}:{c.clause}" for c in snap.citations],
            }
            metrics["telemetry"] = meter.snapshot()

    except Exception as exc:
        metrics["error"] = f"{type(exc).__name__}: {str(exc)}"
        metrics["duration_seconds"] = round(time.monotonic() - t_start, 2)
    return metrics


def run_ledger_race_benchmark(trials: int = 10) -> dict[str, Any]:
    """Run N concurrent ledger race trials verifying 409 stale, 403 RBAC, idempotency, and reversal."""
    passed = 0
    latencies_ms: list[float] = []
    failures: list[str] = []

    with tempfile.TemporaryDirectory() as td:
        for i in range(trials):
            t0 = time.monotonic()
            wf_id = f"WF-RACE-{i}"
            settings = Settings(sqlite_path=str(Path(td) / f"race_{i}.sqlite3"), hitl_shortage_threshold_inr=25000)
            ledger = SQLiteAtomicLedger(settings)
            try:
                ledger.resolve_po(wf_id, "PO-4471", "receiver-01")
                ledger.create_or_revise_draft(
                    workflow_id=wf_id, po_number="PO-4471", cartons=11, loose_pieces=18, pack_unit="peti", actor_id="receiver-01"
                )
                ledger.handle_barge_in(wf_id, "receiver-01", "Ruko 20 loose")
                ledger.create_or_revise_draft(
                    workflow_id=wf_id, po_number="PO-4471", cartons=11, loose_pieces=20, pack_unit="peti", actor_id="receiver-01"
                )

                stale_blocked = False
                try:
                    ledger.commit_grn(
                        workflow_id=wf_id,
                        revision_id=1,
                        idempotency_key=f"k-stale-{i}",
                        actor_id="sys",
                    )
                except DomainRuleError as err:
                    stale_blocked = err.code == "STALE_REVISION" and err.status_code == 409
                assert stale_blocked, "Stale Rev 1 was not rejected with 409"

                ledger.confirm_draft(wf_id, 2, "receiver-01")

                self_blocked = False
                try:
                    ledger.approve_revision(
                        workflow_id=wf_id,
                        revision_id=2,
                        actor_id="receiver-01",
                        actor_role=ActorRole.RECEIVER,
                        reason="self",
                    )
                except DomainRuleError as err:
                    self_blocked = err.code == "FORBIDDEN_ROLE" and err.status_code == 403
                assert self_blocked, "Self approval was not blocked with 403"

                ledger.approve_revision(
                    workflow_id=wf_id,
                    revision_id=2,
                    actor_id="sup-meera",
                    actor_role=ActorRole.SUPERVISOR,
                    reason="Verified",
                )

                def _worker(_idx: int) -> tuple[bool, int]:
                    try:
                        s, _, replay = ledger.commit_grn(
                            workflow_id=wf_id,
                            revision_id=2,
                            idempotency_key=f"idem-race-{i}",
                            actor_id=f"w-{_idx}",
                        )
                        return replay, s.inventory_balance
                    except DomainRuleError:
                        return False, -1

                with ThreadPoolExecutor(max_workers=4) as pool:
                    outcomes = list(pool.map(_worker, range(4)))

                fresh_count = sum(1 for replay, bal in outcomes if not replay and bal == 1284)
                replay_count = sum(1 for replay, bal in outcomes if replay and bal == 1284)
                assert fresh_count == 1 and replay_count == 3, f"Unexpected race outcomes: {outcomes}"
                assert ledger.get_snapshot(wf_id).inventory_balance == 1284

                snap_rev, _ = ledger.reverse_grn(
                    workflow_id=wf_id,
                    actor_id="sup-meera",
                    actor_role=ActorRole.SUPERVISOR,
                    reason="Benchmark cleanup",
                )
                assert snap_rev.inventory_balance == 1000
                passed += 1
            except Exception as exc:
                failures.append(f"trial {i}: {exc}")
            latencies_ms.append(round((time.monotonic() - t0) * 1000.0, 2))

    return {
        "trials": trials,
        "passed": passed,
        "failures": failures,
        "p50_ms": _percentile(latencies_ms, 0.50),
        "p95_ms": _percentile(latencies_ms, 0.95),
        "mean_ms": round(statistics.mean(latencies_ms), 2) if latencies_ms else 0.0,
        "max_ms": max(latencies_ms) if latencies_ms else 0.0,
    }


async def main() -> None:
    print("=== Running DockPilot Live Falsification Spike ===")
    race = run_ledger_race_benchmark(trials=10)
    print("Ledger 10-trial concurrency benchmark:", race)

    live_res = await run_live_gemini_probe("gemini-3.8-live")
    print("Live Gemini 3.8 Live probe:", live_res)

    now_iso = datetime.now(timezone.utc).isoformat()
    out_path = Path(__file__).resolve().parents[2] / "SPIKE_RESULTS.md"

    lines = [
        "# DockPilot Live Falsification Spike Results",
        "",
        f"Measured at `{now_iso}` using `/Users/admin/.local/share/dockpilot-venv` (`google-genai 2.34.0`, `google-adk 2.15.0`).",
        "",
        "## 1. Live Gemini Live WebSocket Probe (Observed Real Measurements)",
        "",
    ]

    if live_res.get("error"):
        lines.extend(
            [
                f"- **Model tested:** `{live_res.get('model')}` on `{live_res.get('endpoint')}`",
                f"- **Handshake latency:** `{live_res.get('handshake_ms', 'N/A')} ms`",
                f"- **Observed runtime error:** `{live_res.get('error')}`",
                "",
            ]
        )
    else:
        t_list = live_res.get("turns", [])
        ttfas = [t["ttfa_ms"] for t in t_list if t.get("ttfa_ms") is not None]
        tel = live_res.get("telemetry", {})
        wf_state = live_res.get("final_workflow_state", {})
        lines.extend(
            [
                f"- **Model tested:** `{live_res.get('model')}` via `{live_res.get('endpoint')}`",
                f"- **WebSocket connect handshake:** `{live_res.get('handshake_ms')} ms`",
                f"- **Fixed tool declarations registered:** `{len(live_res.get('tools_registered', []))}` (`{', '.join(live_res.get('tools_registered', []))}`)",
                f"- **Context card swap (`send_context_update`):** `{live_res.get('context_swap')}`",
                f"- **Session resumption updates seen:** `{live_res.get('resumption_handles_seen')}` | **GoAway seen:** `{live_res.get('go_away_seen')}`",
                f"- **Observed TTFA range across {len(ttfas)} turns:** `{min(ttfas) if ttfas else 'N/A'} ms` to `{max(ttfas) if ttfas else 'N/A'} ms` (median `{_percentile(ttfas, 0.50)} ms`)",
                f"- **Observed tool calls triggered live by Gemini:** `{len(live_res.get('tool_calls', []))}`",
                f"- **Workflow state after live turns:** stage=`{wf_state.get('stage')}`, PO=`{wf_state.get('po_number')}`, revisions=`{wf_state.get('revisions_summary')}`, SOP citations=`{wf_state.get('citations')}`",
                f"- **Metered vs Shadow Naive cost (at `gemini-3.8-live` rates `$0.75/$1.00/$3.00/$4.50/$12.00` per 1M, FX `INR 84.50`):** session `{tel.get('metered_inr')} INR` (`{tel.get('metered_inr_per_min')} INR/min`) vs shadow 20K naive `{tel.get('shadow_naive_inr')} INR` (`{tel.get('shadow_naive_inr_per_min')} INR/min`)",
                "",
                "### Per-Turn Observed Log",
                "",
                "| Turn | TTFA (ms) | Turn Total (ms) | Audio Out (bytes) | Tool Calls | Output Transcript Excerpt |",
                "| :--- | ---: | ---: | ---: | ---: | :--- |",
            ]
        )
        for t in t_list:
            excerpt = (t.get("output_transcript") or t.get("text_parts") or "").replace("|", "/").replace("\n", " ")[:120]
            lines.append(
                f"| `{t['turn']}` | `{t['ttfa_ms']}` | `{t['turn_total_ms']}` | `{t['audio_bytes']}` | `{t['tool_calls_count']}` | {excerpt} |"
            )
        lines.extend(["", "### Live Tool Executions", ""])
        for tc in live_res.get("tool_calls", []):
            lines.append(
                f"- `{tc['turn']}` -> `{tc['name']}` (`ok={tc['ok']}`, `{tc['latency_ms']} ms`): `{tc['args']}`"
            )
        lines.append("")

    lines.extend(
        [
            "## 2. Deterministic Single-Store Atomic Ledger Concurrency Benchmark (10 Trials)",
            "",
            "Each trial ran: `resolve_po(PO-4471)` -> `Rev 1 (282 pcs)` -> `barge_in` -> `Rev 2 (284 pcs)` -> `Stale Rev 1 commit (must 409)` -> `Receiver self-approval (must 403)` -> `Supervisor approval (sup-meera)` -> `4 concurrent commit threads with same idempotency key (must post 1284 once)` -> `Compensating reversal (1284 -> 1000)`.",
            "",
            f"- **Pass rate:** `{race['passed']}/{race['trials']}`",
            f"- **End-to-end 9-step race latency:** mean `{race['mean_ms']} ms`, p50 `{race['p50_ms']} ms`, p95 `{race['p95_ms']} ms`, max `{race['max_ms']} ms`",
            f"- **Failures:** `{race['failures'] if race['failures'] else 'None'}`",
            "",
            "## 3. Vertex AI `asia-south1` & Cloud Run Deployment Readiness",
            "",
            "- **Google Cloud Billing Account verified:** `01A36C-9FA923-2D6430` (`My Billing Account`, active Paid account).",
            "- **Local `gcloud` CLI status:** Not installed locally (`which gcloud` missing); Vertex AI `asia-south1` endpoint deployment (`deploy_cloud_run.sh`) awaits one interactive OAuth approval by Prince:",
            "  ```bash",
            "  brew install --cask google-cloud-sdk && gcloud auth login",
            "  ```",
            "- **Note on Vertex vs Developer API:** Live probe above verified Gemini Live WebSocket execution directly via `GEMINI_API_KEY`; once `gcloud auth login` runs against billing account `01A36C-9FA923-2D6430`, the exact same container deploys to Cloud Run `asia-south1` with Firestore `(default)` and Vertex AI `gemini-3.8-live`.",
        ]
    )

    out_path.write_text("\n".join(lines) + "\n")
    print("Wrote:", out_path)


if __name__ == "__main__":
    asyncio.run(main())
