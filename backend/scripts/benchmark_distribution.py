#!/usr/bin/env python3
"""
10-run live closed-loop latency distribution benchmark for DockPilot against
Cloud Run (`https://api.dockpilot.adelev8.com`), Vertex AI Model Armor,
Vertex AI RAG Engine, and isolated ERPNext v16 sandbox (`erp.dockpilot.adelev8.com`).
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
from datetime import datetime, timezone

from benchmark_receiving import http_call, run_benchmark


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = (len(ordered) - 1) * p
    lo = math.floor(idx)
    hi = math.ceil(idx)
    if lo == hi:
        return round(ordered[lo], 2)
    return round(ordered[lo] + (ordered[hi] - ordered[lo]) * (idx - lo), 2)


def summarize(values: list[float]) -> dict[str, float]:
    return {
        "runs": len(values),
        "min_ms": round(min(values), 2),
        "p50_ms": percentile(values, 0.50),
        "p95_ms": percentile(values, 0.95),
        "max_ms": round(max(values), 2),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default="https://api.dockpilot.adelev8.com")
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument(
        "--out",
        default=str(
            pathlib.Path(__file__).resolve().parents[2]
            / "benchmarks"
            / "receiving_distribution_10runs.json"
        ),
    )
    args = parser.parse_args()

    series: dict[str, list[float]] = {
        "erp_initial_probe_ms": [],
        "model_armor_api_ms": [],
        "model_armor_wall_ms": [],
        "dynamic_alt_challan_mint_ms": [],
        "stale_rev1_hmac_rejection_ms": [],
        "rag_policy_lookup_ms": [],
        "adk_plus_erpnext_commit_ms": [],
        "duplicate_retry_idempotency_ms": [],
        "tally_xml_ms": [],
        "cgst_rule53_pdf_ms": [],
        "driver_gate_pass_ms": [],
        "barge_in_ms": [],
        "draft_rev2_ms": [],
    }
    receipt_ids: list[str] = []

    for i in range(1, args.runs + 1):
        rep = run_benchmark(args.api_base)
        r = rep["results"]
        series["erp_initial_probe_ms"].append(float(r["erp_initial_probe"]["latency_ms"]))
        ma_api = r["model_armor_injection_block"].get("model_armor_api_ms")
        if ma_api is not None:
            series["model_armor_api_ms"].append(float(ma_api))
        series["model_armor_wall_ms"].append(float(r["model_armor_injection_block"]["wall_latency_ms"]))
        series["dynamic_alt_challan_mint_ms"].append(float(r["dynamic_alt_challan_mint"]["latency_ms"]))
        series["stale_rev1_hmac_rejection_ms"].append(float(r["stale_rev1_hmac_rejection"]["latency_ms"]))
        series["rag_policy_lookup_ms"].append(float(r["rag_policy_lookup"]["latency_ms"]))
        series["adk_plus_erpnext_commit_ms"].append(float(r["adk_plus_erpnext_commit"]["latency_ms"]))
        series["duplicate_retry_idempotency_ms"].append(float(r["duplicate_retry_idempotency"]["latency_ms"]))
        series["tally_xml_ms"].append(float(r["compliance_artifacts"]["tally_xml"]["latency_ms"]))
        series["cgst_rule53_pdf_ms"].append(float(r["compliance_artifacts"]["cgst_rule53_pdf"]["latency_ms"]))
        series["driver_gate_pass_ms"].append(float(r["compliance_artifacts"]["driver_gate_pass"]["latency_ms"]))
        series["barge_in_ms"].append(float(r["core_fsm_step_ms"]["barge_in_ms"]))
        series["draft_rev2_ms"].append(float(r["core_fsm_step_ms"]["draft_rev2_ms"]))
        rid = r["adk_plus_erpnext_commit"].get("erp_receipt_id")
        if rid:
            receipt_ids.append(str(rid))
        assert r["cleanup_reset"]["sku24_balance_restored"] == 1000
        print(f"Run {i}/{args.runs} ok: commit={r['adk_plus_erpnext_commit']['latency_ms']} ms ({rid})", flush=True)

    _, erp_final, _ = http_call(args.api_base, "GET", "/api/erp/live-status")
    summary = {
        "benchmark": "dockpilot_closed_loop_distribution_v1",
        "measured_at_utc": datetime.now(timezone.utc).isoformat(),
        "api_base": args.api_base,
        "runs": args.runs,
        "methodology": "10 sequential unmocked closed-loop iterations against Cloud Run asia-south1, Vertex AI Model Armor, Vertex AI RAG Engine, and ERPNext v16 sandbox with full sandbox balance cleanup between runs.",
        "summary_ms": {k: summarize(v) for k, v in series.items()},
        "sample_receipt_ids": receipt_ids,
        "final_sku24_balance": erp_final.get("sku24_balance") if isinstance(erp_final, dict) else None,
    }

    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
