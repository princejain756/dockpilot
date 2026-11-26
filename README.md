# DockPilot

Voice and vision warehouse receiving copilot engineered for **Build with Google Gemini (PS 02: Voice-Driven Agentic Workflow Automation)** on Google Cloud Run (`asia-south1`, Mumbai). DockPilot pairs Vertex AI Gemini 3.8 Live audio-plus-video streaming over WebSockets with a deterministic Python Write-Gate backed by Cloud Firestore atomic transactions.

Built by Prince Jain (Full-Stack Software Engineer, Team ADELEV8 AI).

## Live Links and Submissions

- **Live Web Console:** `https://dockpilot.adelev8.com` (routed over TLS to Cloud Run `asia-south1`, fallback upstream `https://dockpilot-web-493779545452.asia-south1.run.app`)
- **Backend Health Endpoint:** `https://api.dockpilot.adelev8.com/api/health`
- **45s Architecture and Cost Breakdown (YouTube Short):** `https://youtube.com/shorts/Oyn0a0fRUcg`
- **LinkedIn Build Post (`#BuildwithGemini`):** `https://www.linkedin.com/feed/update/urn:li:activity:7530950271741534209/`

## Core Architecture

- **Realtime Voice Gateway (`backend/app/live_gateway.py`):** Streams bidirectional PCM16 audio and 1 FPS camera frames to Vertex AI `gemini-3.8-live` in `asia-south1` (with automatic `us-central1` region failover on initial connect failure). Configures `SpeechConfig` (`Despina`, `hi-IN`), explicit Semantic VAD (`StartSensitivity.START_SENSITIVITY_HIGH`, `EndSensitivity.END_SENSITIVITY_LOW`, `150 ms` prefix padding, `500 ms` silence duration), `context_window_compression`, `session_resumption`, and per-turn modality token tracking (`prompt_tokens_details` and `response_tokens_details`) while pushing sub-200-token FSM stage context cards via `send_context_update`.
- **Vertex AI RAG Engine Tool (`backend/app/rag.py`):** Queries managed Vertex AI RAG Engine corpus (`projects/493779545452/locations/asia-south1/ragCorpora/2305843009213693952` indexing all 6 clean-room receiving SOP files) via `retrieveContexts` with local keyword-synonym fallback, returning cited passages under 150 tokens (`SOP-RCV-002`, `SOP-FIN-001`, `SOP-EWB-003`).
- **Deterministic Write-Gate (`backend/app/ledger.py`, `backend/app/main.py`):** Gemini proposes structured counts (`propose_count`), while Python validates schema, policy thresholds (`₹25,000` variance supervisor escalation), and monotonically increasing `expected_revision` numbers. Blocked writes (`HTTP 409 STALE_REVISION` and `HTTP 403 FORBIDDEN_ROLE`) are persisted outside aborted transactions so audit history stays intact.
- **Atomic Ledger Commit:** Supervisor sign-off commits SKU inventory updates atomically inside a single `@firestore.transactional` boundary and generates a serial `DRAFT` GST Debit Note pack alongside immutable Cloud Firestore audit events.
- **Operator Command Center (`frontend/src/`):** Next.js 16 dashboard showing live Hinglish transcript stream, optimistic lock states, revision bumps, live meter telemetry (`₹/min`), and dynamic sibling Cloud Run or custom-domain API resolution (`frontend/src/lib/api.ts`).

## Verified Cloud Run Torture-Test Metrics

- **Token and Cost Reduction:** Replacing a 20,000-token monolithic system prompt with sub-200-token FSM context cards and modality-split billing achieved **₹1.93/min** vs **₹19.63/min** shadow baseline on live Cloud Run WebSocket runs (`TTFA 907.1 ms`, `368,162` bytes of `Despina` `hi-IN` audio, and `65.8 ms` Firestore `resolve_po_and_challan` latency), and **₹2.07/min** vs **₹9.12/min** over 4 tool calls in our multi-turn spike.
- **Managed Vertex AI RAG Engine:** Live `GET /api/sop/search` queries the Mumbai `asia-south1` `RagCorpus` in `1,110.8 ms` returning `source_backend: "vertex_rag"` (`SOP-RCV-002` `Clause 4` and `SOP-FIN-001` `Clause 5`).
- **Barge-In Concurrency Lock:** Mid-sentence count corrections trigger **HTTP 409 STALE_REVISION** blocks with **58 ms** to **65.8 ms** Firestore tool round-trip timing.
- **Policy Enforcement:** Self-approval on high-value discrepancies fails closed with **HTTP 403 FORBIDDEN_ROLE** above **₹25,000**.
- **Atomic Settlement:** Validated SKU-24 commits once from **1,000 to 1,284** pieces, emitting a **₹33,040 DRAFT** GST Debit Note.
- **Test Verification:** **37/37 pytest** unit, invariant, gateway config, modality metering, failover, and RAG integration tests pass alongside **10/10** concurrent ledger race stress trials.

## Local Development and Tests

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -q
```

Frontend development server:

```bash
cd frontend
npm install
npm run dev
```
