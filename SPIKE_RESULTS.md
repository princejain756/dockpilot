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

## 3. Production Cloud Run `asia-south1`, Firestore Native & Vertex AI Verification

Deployed live to Google Cloud Mumbai (`asia-south1`, project `gen-lang-client-0804407993`, billing `01A36C-9FA923-2D6430`):

- **Live Web UI (`dockpilot-web`):** `https://dockpilot-web-493779545452.asia-south1.run.app` (`/` and `/dock` both verified HTTP `200`)
- **Live FastAPI + ADK Gateway (`dockpilot-api`):** `https://dockpilot-api-493779545452.asia-south1.run.app`
- **`GET /api/health`:** `{'status': 'ok', 'model': 'gemini-3.8-live', 'region': 'asia-south1', 'storage_backend': 'firestore', 'live_configured': True}`
- **Live Cloud Firestore Native (`asia-south1`, `(default)`) transactional torture cycle (`POST` E2E):**
  - `resolve-po PO-4471` -> `draft Rev 1 (282 pcs)` -> `barge-in` -> `draft Rev 2 (284 pcs)`
  - `test-stale-commit` blocked (`blocked=True`, `STALE_REVISION`) and persisted `BLOCKED_STALE_REVISION` inside Firestore transaction
  - Receiver self-approval blocked (`HTTP 403 FORBIDDEN_ROLE`)
  - Supervisor approval (`sup-meera`) + `commit` updated Firestore `inventory/DOCK1_SKU-24` (`1000 -> 1284`) and wrote `CLM-GRN-4471-LOUD` (`INR 33040.0 DRAFT`)
  - `test-duplicate-commit` returned `idempotent_replay=True` with stock held cleanly at `1284`
  - Compensating reversal restored Firestore stock (`1284 -> 1000`)
- **Live Cloud Run WebSocket -> Vertex AI `gemini-3.8-live` (`wss://dockpilot-api-493779545452.asia-south1.run.app/ws/dock/WF-LIVE-WS`):**
  - Server `hello`: `{'type': 'hello', 'live_backend': 'vertex_ai', 'model': 'gemini-3.8-live', 'region': 'asia-south1'}`
  - Live `text_turn` executed `resolve_po_and_challan({'po_number': 'PO-4471'})` in `62.5 ms` against Firestore, streamed `~305,763` bytes of 24kHz Hinglish audio (`49` WS events, zero fallbacks), transcript: `"VayuMech PO-4471 resolve ho gaya hai. Expected pieces 288 hain. Kitne cartons aur loose pieces miley hain?"`

## 4. Nov 26 Cloud Run Mumbai + Managed Vertex AI RAG + Modality Telemetry Verification

Measured after upgrading `dockpilot-api` (`dockpilot-api-00002-5m2`, `asia-south1`, behind TLS domain `https://api.dockpilot.adelev8.com`):

- **`GET https://api.dockpilot.adelev8.com/api/health`:** `{'status': 'ok', 'model': 'gemini-3.8-live', 'region': 'asia-south1', 'fallback_region': 'us-central1', 'voice': 'Despina', 'language_code': 'hi-IN', 'semantic_vad': True, 'storage_backend': 'firestore', 'rag_backend': 'vertex_rag', 'live_configured': True}`
- **Managed Vertex AI RAG Engine (`projects/493779545452/locations/asia-south1/ragCorpora/2305843009213693952`):** All 6 clean-room SOP documents indexed via `ragFiles:upload`. Live `GET /api/sop/search?q=shortage+approval+25000` returned `2` citations in `1,110.8 ms` (`SOP-RCV-002` `Clause 4` and `SOP-FIN-001` `Clause 5`) with `source_backend: 'vertex_rag'`.
- **Live WebSocket (`wss://api.dockpilot.adelev8.com/ws/dock/WF-LIVE-VERIFY`) with `Despina` (`hi-IN`) + Semantic VAD + Modality Metering:**
  - `hello`: `{'type': 'hello', 'live_backend': 'vertex_ai', 'model': 'gemini-3.8-live', 'region': 'asia-south1'}`
  - `resolve_po_and_challan` executed in `65.8 ms` against Cloud Firestore Native; returned `368,162` bytes of 24kHz `Despina` Hinglish audio (`TTFA 907.1 ms`, zero fallbacks); transcript: `"PO-4471 ke liye 288 pieces, yaani 12 peti expected hain. Aapki kitni peti aur loose pieces received hain?"`
  - Live `usage_metadata` modality split (`extract_usage_tokens`): `2` turns, `active_prompt_tokens: 180` vs `naive_prompt_tokens: 20000`, `text_in: 975`, `text_out: 58`, `audio_out: 196`, `duration_seconds: 8.8`, `metered_inr: 0.2826` (`1.93 INR/min`) vs `shadow_naive_inr: 2.8699` (`19.63 INR/min`).
- **Automated Test Suite (`backend/`):** `37/37` `pytest` tests passed after final edits (`test_invariants.py`, `test_api_ws.py`, and `test_live_gateway.py`).
