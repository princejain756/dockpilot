# DockPilot

Closed-loop voice and vision warehouse receiving copilot engineered for **Build with Google Gemini (PS 02: Voice-Driven Agentic Workflow Automation)** on Google Cloud Run (`asia-south1`, Mumbai). DockPilot pairs Vertex AI Gemini 3.8 Live Hinglish audio-plus-video streaming and Google ADK multi-agent orchestration with Vertex AI Model Armor prompt-injection screening, atomic Cloud Firestore transactions, and live Purchase Receipt settlement in an isolated ERPNext v16 sandbox (`https://erp.dockpilot.adelev8.com`).

Built by Prince Jain (Full-Stack Software Engineer, Team ADELEV8 AI).

## Live Production Endpoints

- **Web Console & Floor HUD:** `https://dockpilot.adelev8.com` (Cloud Run `dockpilot-web-493779545452.asia-south1.run.app`, mobile HUD at `/dock`, HMAC sign-off at `/approve/[workflowId]`, bilingual driver pass at `/gate-pass/[workflowId]`)
- **API & Live Voice Gateway:** `https://api.dockpilot.adelev8.com/api/health` (Cloud Run `dockpilot-api-493779545452.asia-south1.run.app`)
- **Isolated ERPNext v16 Sandbox:** `https://erp.dockpilot.adelev8.com` (`VayuMech Receiving Sandbox`, Dock 1 opening balance `1,000 pcs` on `SKU-24`)
- **45s Architecture and Cost Breakdown (YouTube Short):** `https://youtube.com/shorts/Oyn0a0fRUcg`
- **LinkedIn Build Post (`#BuildwithGemini`):** `https://www.linkedin.com/feed/update/urn:li:activity:7530950271741534209/`

## Core Closed-Loop Architecture

- **Realtime Voice Gateway (`backend/app/live_gateway.py`):** Streams bidirectional 16 kHz PCM16 audio and 1 FPS camera frames to Vertex AI `gemini-3.8-live` in `asia-south1` (automatic `us-central1` failover). Uses `Despina` (`hi-IN`), explicit Semantic VAD (`150 ms` prefix padding, `500 ms` silence duration), sliding-window `context_window_compression`, `session_resumption`, and per-turn modality token billing with compact FSM context cards.
- **Any-Challan Ingestion & Vertex AI Model Armor (`backend/app/challan_ingest.py`, `backend/app/model_armor.py`):** Accepts printed PDF or photo GST challans, verifies Modulo-36 GSTIN check digits, dynamically mints unfamiliar PO/SKU workflows (`PO-8821`, `Kaveri Precision Hydraulics Pvt Ltd`, `120 pcs`), and screens extracted text through Vertex AI Model Armor template `dockpilot-challan-guard` in `asia-south1`. Adversarial prompt injections fail closed with `HTTP 422 PROMPT_INJECTION_BLOCKED`.
- **Google ADK Multi-Agent Governance Pipeline (`backend/app/adk_pipeline.py`):** Runs a 3-stage Google ADK `SequentialAgent` (`ChallanComplianceAgent` -> `LedgerWriteGateAgent` -> `ERPSettlementAgent`) using `EventActions(state_delta=...)` before committing stock.
- **Out-of-Band HMAC Supervisor Sign-Off & Deterministic Write-Gate (`backend/app/ledger.py`, `backend/app/main.py`):** Enforces monotonic revision locking when shortages exceed ₹25,000. Any barge-in correction (`Rev 1 -> Rev 2`) invalidates outstanding Rev 1 HMAC-SHA256 mobile approval URLs (`HTTP 409 STALE_REVISION`).
- **Live ERPNext v16 Settlement & Statutory Outputs (`backend/app/erp_adapter.py`, `backend/app/artifacts_gst.py`):** Submits idempotent ERPNext `Purchase Receipt` entries (`MAT-PRE-...`) keyed on `dockpilot_delivery_id`, verifies post-commit Stock Ledger balances (`1,000 -> 1,284 pcs`), and generates downloadable TallyPrime `<ENVELOPE>` XML (`VCHTYPE="Debit Note"`), CGST Rule 53 Shortage Debit Note PDFs (`fpdf2`), and Bilingual Hindi/English Driver Discrepancy Gate-Passes.
- **Vertex AI RAG Engine Policy Search (`backend/app/rag.py`):** Queries managed Mumbai `RagCorpus` (`projects/493779545452/locations/asia-south1/ragCorpora/2305843009213693952`) over receiving SOP clauses (`SOP-RCV-002`, `SOP-FIN-001`, `SOP-EWB-003`).
- **Operator Workbench & Mobile Floor HUD (`frontend/src/`):** Next.js 15 TypeScript UI across Operations Console (`/`), gloved-thumb Mobile HUD (`/dock`), Supervisor Sign-Off (`/approve/[workflowId]`), and Bilingual Driver Gate-Pass (`/gate-pass/[workflowId]`) with Light and Obsidian Dark themes.

## Verified Production Measurements (`benchmarks/receiving_comparison.json`)

Measured sequentially over live HTTPS calls against `https://api.dockpilot.adelev8.com`, Vertex AI (`asia-south1`), and `https://erp.dockpilot.adelev8.com` via `backend/scripts/benchmark_receiving.py`:

- **Vertex AI Model Armor Block (`dockpilot-challan-guard`):** Blocked adversarial invoice in `63.2 ms` Model Armor API time (`261.34 ms` end-to-end HTTP `422 MATCH_FOUND`).
- **Unfamiliar Challan Dynamic Extraction (`alt-kaveri`):** Minted `PO-8821` (`120 pcs`) cleanly in `443.01 ms`.
- **Stale Revision HMAC Protection:** Rev 1 token replay rejected with `HTTP 409 STALE_REVISION` in `259.07 ms`, keeping ERPNext `SKU-24` stock untouched at `1,000`.
- **ADK Pipeline + ERPNext Purchase Receipt Commit:** Created and verified `MAT-PRE-2026-00007` across all 3 ADK stages in `1,397.76 ms` (`SKU-24`: `1,000 -> 1,284 pcs`).
- **Duplicate Commit Idempotency:** Replaying commit returned the same `MAT-PRE-2026-00007` receipt in `1,046.53 ms` with stock unchanged at `1,284 pcs`.
- **Compliance Downloads:** TallyPrime XML (`2,438 bytes`, `196.83 ms`), CGST Rule 53 Debit Note PDF (`2,274 bytes`, `237.59 ms`), and Bilingual Driver Gate-Pass `GP-GRN-4471` (`212.81 ms`).
- **Vertex AI RAG Lookup:** Retrieved 2 grounded policy clauses (`source_backend: "vertex_rag"`) in `779.67 ms`.
- **Voice FinOps Meter:** Sliding-window FSM context updates achieved **₹1.93/min** vs **₹19.63/min** uncompacted baseline on live Cloud Run WebSocket runs (`TTFA 907.1 ms`).
- **Backend Test Suite & UI QA:** **41/41 pytest** tests pass (`9.67 s`), and five rounds of desktop and mobile UI QA passed with zero P0 blockers.

## Local Development and Tests

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -q
```

Live closed-loop benchmark (resets ERPNext stock back to `1,000 pcs` automatically):

```bash
python3 backend/scripts/benchmark_receiving.py
```

Frontend development server:

```bash
cd frontend
npm install
npm run typecheck
npm run build
npm run dev
```
