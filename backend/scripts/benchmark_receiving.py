#!/usr/bin/env python3
"""
Transparent closed-loop receiving benchmark for DockPilot against live Cloud Run
(`https://api.dockpilot.adelev8.com`), Vertex AI Model Armor (`asia-south1`),
Vertex AI RAG Engine, and isolated ERPNext v16 sandbox (`https://erp.dockpilot.adelev8.com`).

Zero synthetic or hardcoded latencies: every timing and payload size is directly measured
over live HTTPS calls, and the workflow + ERPNext Purchase Receipt are reset in `finally`.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone


def http_call(
    base_url: str,
    method: str,
    path: str,
    json_body: dict | None = None,
    form_fields: dict[str, str] | None = None,
) -> tuple[int, object, float]:
    url = base_url.rstrip("/") + path
    headers: dict[str, str] = {}
    data: bytes | None = None

    if json_body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(json_body).encode("utf-8")
    elif form_fields is not None:
        boundary = "----DockPilotBenchBoundary"
        chunks: list[bytes] = []
        for k, v in form_fields.items():
            chunks.append(
                (
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="{k}"\r\n\r\n'
                    f"{v}\r\n"
                ).encode("utf-8")
            )
        chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
        data = b"".join(chunks)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read()
            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
            ctype = resp.headers.get("Content-Type", "")
            parsed: object = json.loads(raw) if "json" in ctype else raw
            return resp.status, parsed, elapsed_ms
    except urllib.error.HTTPError as err:
        raw = err.read()
        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        try:
            return err.code, json.loads(raw), elapsed_ms
        except Exception:
            return err.code, raw, elapsed_ms


def run_benchmark(api_base: str) -> dict:
    measurements: dict[str, object] = {}
    try:
        http_call(api_base, "POST", "/api/workflows/WF-4471/reset")

        st, erp0, ms_erp0 = http_call(api_base, "GET", "/api/erp/live-status")
        assert st == 200 and isinstance(erp0, dict) and erp0.get("reachable")
        measurements["erp_initial_probe"] = {
            "status": st,
            "latency_ms": ms_erp0,
            "sku24_balance": erp0.get("sku24_balance"),
        }

        st, trap_res, ms_trap = http_call(
            api_base,
            "POST",
            "/api/workflows/WF-4471/ingest-challan",
            form_fields={"fixture_id": "injection-trap"},
        )
        assert st == 422 and isinstance(trap_res, dict)
        ma_meta = (trap_res.get("detail") or {}).get("detail", {}).get("model_armor", {})
        measurements["model_armor_injection_block"] = {
            "status": st,
            "wall_latency_ms": ms_trap,
            "model_armor_api_ms": ma_meta.get("latency_ms"),
            "backend": ma_meta.get("backend"),
            "template": ma_meta.get("template"),
            "match_state": ma_meta.get("match_state"),
        }

        st, kav_res, ms_kav = http_call(
            api_base,
            "POST",
            "/api/workflows/WF-4471/ingest-challan",
            form_fields={"fixture_id": "alt-kaveri"},
        )
        assert st == 200 and isinstance(kav_res, dict)
        measurements["dynamic_alt_challan_mint"] = {
            "status": st,
            "latency_ms": ms_kav,
            "po_number": kav_res["snapshot"]["po_number"],
            "expected_pieces": (kav_res.get("po") or {}).get("expected_pieces"),
        }

        http_call(api_base, "POST", "/api/workflows/WF-4471/reset")
        st, _, ms_resolve = http_call(
            api_base,
            "POST",
            "/api/workflows/WF-4471/resolve-po",
            {"po_number": "PO-4471", "actor_id": "receiver-01"},
        )
        assert st == 200

        st, _, ms_d1 = http_call(
            api_base,
            "POST",
            "/api/workflows/WF-4471/draft",
            {
                "po_number": "PO-4471",
                "cartons": 11,
                "loose_pieces": 18,
                "pack_unit": "peti",
                "transcript": "Benchmark Rev 1: 11 peti, 18 loose",
                "actor_id": "receiver-01",
            },
        )
        assert st == 200
        http_call(
            api_base,
            "POST",
            "/api/workflows/WF-4471/confirm",
            {"revision_id": 1, "actor_id": "receiver-01"},
        )
        st, link1, _ = http_call(api_base, "GET", "/api/workflows/WF-4471/approval-link?revision_id=1")
        assert st == 200 and isinstance(link1, dict)

        st, _, ms_bi = http_call(
            api_base,
            "POST",
            "/api/workflows/WF-4471/barge-in",
            {
                "actor_id": "receiver-01",
                "transcript_hint": "Benchmark barge-in correction to 20 loose",
                "stop_latency_ms": 180,
            },
        )
        assert st == 200
        st, _, ms_d2 = http_call(
            api_base,
            "POST",
            "/api/workflows/WF-4471/draft",
            {
                "po_number": "PO-4471",
                "cartons": 11,
                "loose_pieces": 20,
                "pack_unit": "peti",
                "transcript": "Benchmark Rev 2: 11 peti, 20 loose",
                "actor_id": "receiver-01",
            },
        )
        assert st == 200
        http_call(
            api_base,
            "POST",
            "/api/workflows/WF-4471/confirm",
            {"revision_id": 2, "actor_id": "receiver-01"},
        )

        st_stale, _, ms_stale = http_call(
            api_base,
            "POST",
            "/api/workflows/WF-4471/approve-by-token",
            {"revision_id": 1, "sig": link1["sig"], "actor_id": "sup-ops-lead", "auto_commit": True},
        )
        _, erp_mid, _ = http_call(api_base, "GET", "/api/erp/live-status")
        assert st_stale == 409 and isinstance(erp_mid, dict)
        measurements["stale_rev1_hmac_rejection"] = {
            "status": st_stale,
            "latency_ms": ms_stale,
            "erp_stock_unchanged": erp_mid.get("sku24_balance"),
        }

        st, link2, _ = http_call(api_base, "GET", "/api/workflows/WF-4471/approval-link?revision_id=2")
        assert st == 200 and isinstance(link2, dict)

        st_sop, sop_res, ms_sop = http_call(
            api_base,
            "GET",
            "/api/sop/search?workflow_id=WF-4471&q=shortage+approval+25000+debit+note",
        )
        assert st_sop == 200 and isinstance(sop_res, dict)
        cits = sop_res.get("citations") or []
        measurements["rag_policy_lookup"] = {
            "status": st_sop,
            "latency_ms": ms_sop,
            "citations_count": len(cits),
            "source_backend": cits[0].get("source_backend") if cits else None,
        }

        st_commit, commit_res, ms_commit = http_call(
            api_base,
            "POST",
            "/api/workflows/WF-4471/approve-by-token",
            {"revision_id": 2, "sig": link2["sig"], "actor_id": "sup-ops-lead", "auto_commit": True},
        )
        assert st_commit == 200 and isinstance(commit_res, dict)
        grn = commit_res["snapshot"]["grn"]
        measurements["adk_plus_erpnext_commit"] = {
            "status": st_commit,
            "latency_ms": ms_commit,
            "erp_receipt_id": grn.get("erp_receipt_id"),
            "erp_verified": grn.get("erp_verified"),
            "erp_stock_after": grn.get("erp_stock_after"),
            "adk_agents": [a.get("agent") for a in commit_res["snapshot"].get("adk_pipeline_trace", [])],
        }

        st_dup, dup_res, ms_dup = http_call(
            api_base, "POST", "/api/workflows/WF-4471/test-duplicate-commit"
        )
        assert st_dup == 200 and isinstance(dup_res, dict)
        measurements["duplicate_retry_idempotency"] = {
            "status": st_dup,
            "latency_ms": ms_dup,
            "erp_receipt_id": dup_res["snapshot"]["grn"].get("erp_receipt_id"),
            "erp_stock_after": dup_res["snapshot"]["grn"].get("erp_stock_after"),
        }

        st_xml, xml_raw, ms_xml = http_call(api_base, "GET", "/api/workflows/WF-4471/artifacts/tally-xml")
        st_pdf, pdf_raw, ms_pdf = http_call(api_base, "GET", "/api/workflows/WF-4471/artifacts/debit-note.pdf")
        st_gp, gp_raw, ms_gp = http_call(api_base, "GET", "/api/workflows/WF-4471/artifacts/gate-pass")
        measurements["compliance_artifacts"] = {
            "tally_xml": {"status": st_xml, "latency_ms": ms_xml, "bytes": len(xml_raw) if isinstance(xml_raw, bytes) else 0},
            "cgst_rule53_pdf": {"status": st_pdf, "latency_ms": ms_pdf, "bytes": len(pdf_raw) if isinstance(pdf_raw, bytes) else 0},
            "driver_gate_pass": {"status": st_gp, "latency_ms": ms_gp, "gate_pass_id": gp_raw.get("gate_pass_id") if isinstance(gp_raw, dict) else None},
        }

        measurements["core_fsm_step_ms"] = {
            "resolve_po_ms": ms_resolve,
            "draft_rev1_ms": ms_d1,
            "barge_in_ms": ms_bi,
            "draft_rev2_ms": ms_d2,
        }
    finally:
        st_rst, _, ms_rst = http_call(api_base, "POST", "/api/workflows/WF-4471/reset")
        _, erp_final, _ = http_call(api_base, "GET", "/api/erp/live-status")
        measurements["cleanup_reset"] = {
            "status": st_rst,
            "latency_ms": ms_rst,
            "sku24_balance_restored": erp_final.get("sku24_balance") if isinstance(erp_final, dict) else None,
        }

    return {
        "benchmark": "dockpilot_closed_loop_receiving_v1",
        "measured_at_utc": datetime.now(timezone.utc).isoformat(),
        "api_base": api_base,
        "methodology": "Sequential live HTTPS calls from mac-mini to Cloud Run asia-south1 (dockpilot-api), Vertex AI Model Armor (dockpilot-challan-guard), Vertex AI RAG Engine, and isolated ERPNext v16 sandbox (erp.dockpilot.adelev8.com). No mocked dependencies.",
        "results": measurements,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default="https://api.dockpilot.adelev8.com")
    parser.add_argument(
        "--out",
        default=str(pathlib.Path(__file__).resolve().parents[2] / "benchmarks" / "receiving_comparison.json"),
    )
    args = parser.parse_args()

    report = run_benchmark(args.api_base)
    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
