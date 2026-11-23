# DockPilot Live Falsification Spike Results

Measured at `2026-11-23T13:10:28.835881+00:00` using `/Users/admin/.local/share/dockpilot-venv` (`google-genai 2.34.0`, `google-adk 2.15.0`).

## 1. Live Gemini Live WebSocket Probe (Observed Real Measurements)

- **Model tested:** `gemini-3.8-live` via `generativelanguage.googleapis.com (Developer API)`
- **WebSocket connect handshake:** `508.7 ms`
- **Fixed tool declarations registered:** `6` (`resolve_po_and_challan, compute_receipt_draft, search_receiving_sop, record_receiver_confirmation, request_supervisor_approval, commit_goods_receipt`)
- **Context card swap (`send_context_update`):** `{'ok': True, 'target_stage': 'RECONCILE', 'prompt_tokens': 180, 'client_call_ms': 3.81}`
- **Session resumption updates seen:** `1` | **GoAway seen:** `False`
- **Observed TTFA range across 3 turns:** `1180.2 ms` to `1385.9 ms` (median `1192.4 ms`)
- **Observed tool calls triggered live by Gemini:** `4`
- **Workflow state after live turns:** stage=`RECONCILE`, PO=`PO-4471`, revisions=`[{'revision_id': 1, 'total_pieces': 282, 'status': 'SUPERSEDED'}, {'revision_id': 2, 'total_pieces': 284, 'status': 'DRAFT'}]`, SOP citations=`['SOP-RCV-002:Clause 4: Partial Receipt Shortage and Supervisor Approval Threshold', 'SOP-FIN-001:Clause 5: Draft Claim Generation for Short Deliveries']`
- **Metered vs Shadow Naive cost (at `gemini-3.8-live` rates `$0.75/$1.00/$3.00/$4.50/$12.00` per 1M, FX `INR 84.50`):** session `1.0509 INR` (`2.07 INR/min`) vs shadow 20K naive `4.6195 INR` (`9.12 INR/min`)

### Per-Turn Observed Log

| Turn | TTFA (ms) | Turn Total (ms) | Audio Out (bytes) | Tool Calls | Output Transcript Excerpt |
| :--- | ---: | ---: | ---: | ---: | :--- |
| `T1_IDENTIFY` | `1180.2` | `8421.8` | `348000` | `1` | VayuMech ka PO-4471 resolve ho gaya hai. Expected 288 pieces hain. Kitne cartons aur loose pieces aaye hain? |
| `T2_DRAFT_AND_RAG` | `1385.9` | `11183.5` | `439200` | `2` | Shortage value INR 42,000 hai. Shortage 25k se zyada par Clause 4 supervisor approval mandatory karta hai. Total pieces  |
| `T3_BARGE_CORRECTION` | `1192.4` | `10275.4` | `435840` | `1` | Naya draft ready hai: 11 cartons, 20 loose pieces, total 284 pieces. Shortage 4 pieces, value INR 28,000. Confirm? |

### Live Tool Executions

- `T1_IDENTIFY` -> `resolve_po_and_challan` (`ok=True`, `0.19 ms`): `{'po_number': 'PO-4471'}`
- `T2_DRAFT_AND_RAG` -> `compute_receipt_draft` (`ok=True`, `0.2 ms`): `{'po_number': 'PO-4471', 'loose_pieces': 18, 'pack_unit': 'peti', 'cartons': 11}`
- `T2_DRAFT_AND_RAG` -> `search_receiving_sop` (`ok=True`, `0.27 ms`): `{'query': 'shortage approval amount threshold', 'scope': 'receiving'}`
- `T3_BARGE_CORRECTION` -> `compute_receipt_draft` (`ok=True`, `0.17 ms`): `{'pack_unit': 'peti', 'cartons': 11, 'loose_pieces': 20, 'po_number': 'PO-4471'}`

## 2. Deterministic Single-Store Atomic Ledger Concurrency Benchmark (10 Trials)

Each trial ran: `resolve_po(PO-4471)` -> `Rev 1 (282 pcs)` -> `barge_in` -> `Rev 2 (284 pcs)` -> `Stale Rev 1 commit (must 409)` -> `Receiver self-approval (must 403)` -> `Supervisor approval (sup-meera)` -> `4 concurrent commit threads with same idempotency key (must post 1284 once)` -> `Compensating reversal (1284 -> 1000)`.

- **Pass rate:** `10/10`
- **End-to-end 9-step race latency:** mean `9.23 ms`, p50 `8.91 ms`, p95 `11.32 ms`, max `11.32 ms`
- **Failures:** `None`

## 3. Vertex AI `asia-south1` & Cloud Run Deployment Readiness

- **Google Cloud Billing Account verified:** `01A36C-9FA923-2D6430` (`My Billing Account`, active Paid account).
- **Local `gcloud` CLI status:** Not installed locally (`which gcloud` missing); Vertex AI `asia-south1` endpoint deployment (`deploy_cloud_run.sh`) awaits one interactive OAuth approval by Prince:
  ```bash
  brew install --cask google-cloud-sdk && gcloud auth login
  ```
- **Note on Vertex vs Developer API:** Live probe above verified Gemini Live WebSocket execution directly via `GEMINI_API_KEY`; once `gcloud auth login` runs against billing account `01A36C-9FA923-2D6430`, the exact same container deploys to Cloud Run `asia-south1` with Firestore `(default)` and Vertex AI `gemini-3.8-live`.
