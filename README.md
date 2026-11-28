# DockPilot

Closed-loop voice and vision warehouse receiving copilot engineered for **Build with Google Gemini (PS 02: Voice-Driven Agentic Workflow Automation)** on Google Cloud Run (`asia-south1`, Mumbai). DockPilot pairs Vertex AI Gemini 3.8 Live Hinglish audio-plus-video streaming and Google ADK multi-agent orchestration with Vertex AI Model Armor prompt-injection screening, atomic Cloud Firestore transactions, and live Purchase Receipt settlement in an isolated ERPNext v16 sandbox (`https://erp.dockpilot.adelev8.com`).

Built by Prince Jain (Full-Stack Software Engineer, Team ADELEV8 AI).

## Live Production Endpoints

- **Web Console & Floor HUD:** `https://dockpilot.adelev8.com` (Cloud Run `dockpilot-web-493779545452.asia-south1.run.app`, mobile HUD at `/dock`, HMAC sign-off at `/approve/[workflowId]`, bilingual driver pass at `/gate-pass/[workflowId]`)
- **API & Live Voice Gateway:** `https://api.dockpilot.adelev8.com/api/health` (Cloud Run `dockpilot-api-493779545452.asia-south1.run.app`)
- **Isolated ERPNext v16 Sandbox:** `https://erp.dockpilot.adelev8.com` (`VayuMech Receiving Sandbox`, Dock 1 opening balance `1,000 pcs` on `SKU-24`)
- **1:47 Stage 2 Prototype Demo Video (YouTube 16:9):** `https://youtu.be/Y9OdrxT6xio`
- **45s Architecture and Cost Breakdown (YouTube Short):** `https://youtube.com/shorts/Oyn0a0fRUcg`
- **LinkedIn Build Post (`#BuildwithGemini`):** `https://www.linkedin.com/feed/update/urn:li:activity:7532237867943849984/`

## Core Closed-Loop Architecture

- **Realtime Voice Gateway (`backend/app/live_gateway.py`):** Streams bidirectional 16 kHz PCM16 audio and 1 FPS camera frames to Vertex AI `gemini-3.8-live` in `asia-south1` (automatic `us-central1` failover). Uses `Despina` (`hi-IN`), explicit Semantic VAD (`150 ms` prefix padding, `500 ms` silence duration), sliding-window `context_window_compression`, `session_resumption`, and per-turn modality token billing with compact FSM context cards.
- **Any-Challan Ingestion & Vertex AI Model Armor (`backend/app/challan_ingest.py`, `backend/app/model_armor.py`):** Accepts printed PDF or photo GST challans, verifies Modulo-36 GSTIN check digits, dynamically mints unfamiliar PO/SKU workflows (`PO-8821`, `Kaveri Precision Hydraulics Pvt Ltd`, `120 pcs`), and screens extracted text through Vertex AI Model Armor template `dockpilot-challan-guard` in `asia-south1`. Adversarial prompt injections fail closed with `HTTP 422 PROMPT_INJECTION_BLOCKED`.
- **Google ADK Multi-Agent Governance Pipeline (`backend/app/adk_pipeline.py`):** Runs a 3-stage Google ADK `SequentialAgent` (`ChallanComplianceAgent` -> `LedgerWriteGateAgent` -> `ERPSettlementAgent`) using `EventActions(state_delta=...)` before committing stock.
- **Out-of-Band HMAC Supervisor Sign-Off & Deterministic Write-Gate (`backend/app/ledger.py`, `backend/app/main.py`):** Enforces monotonic revision locking when shortages exceed ₹25,000. Any barge-in correction (`Rev 1 -> Rev 2`) invalidates outstanding Rev 1 HMAC-SHA256 mobile approval URLs (`HTTP 409 STALE_REVISION`).
- **Live ERPNext v16 Settlement & Statutory Outputs (`backend/app/erp_adapter.py`, `backend/app/artifacts_gst.py`):** Submits idempotent ERPNext `Purchase Receipt` entries (`MAT-PRE-...`) keyed on `dockpilot_delivery_id`, verifies post-commit Stock Ledger balances (`1,000 -> 1,284 pcs`), and generates downloadable TallyPrime `<ENVELOPE>` XML (`VCHTYPE="Debit Note"`), CGST Rule 53 Shortage Debit Note PDFs (`fpdf2`), and Bilingual Hindi/English Driver Discrepancy Gate-Passes.
- **Vertex AI RAG Engine Policy Search (`backend/app/rag.py`):** Queries managed Mumbai `RagCorpus` (`projects/493779545452/locations/asia-south1/ragCorpora/2305843009213693952`) over receiving SOP clauses (`SOP-RCV-002`, `SOP-FIN-001`, `SOP-EWB-003`).
- **Operator Workbench & Mobile Floor HUD (`frontend/src/`):** Next.js 15 TypeScript UI across Operations Console (`/`), gloved-thumb Mobile HUD (`/dock`), Supervisor Sign-Off (`/approve/[workflowId]`), and Bilingual Driver Gate-Pass (`/gate-pass/[workflowId]`) with Light and Obsidian Dark themes.

## Verified Production Measurements (`benchmarks/receiving_distribution_10runs.json` & `benchmarks/manual_vs_dockpilot_timing.json`)

Measured across 10 sequential unmocked closed-loop runs against `https://api.dockpilot.adelev8.com`, Vertex AI (`asia-south1`), and `https://erp.dockpilot.adelev8.com` via `backend/scripts/benchmark_distribution.py` (with full sandbox reset between runs):

- **Vertex AI Model Armor Block (`dockpilot-challan-guard`):** `48.85 ms` p50 API time (`88.19 ms` p95; `298.46 ms` p50 end-to-end HTTP `422 MATCH_FOUND`).
- **Unfamiliar Challan Dynamic Extraction (`PO-8821`):** `408.66 ms` p50 (`646.22 ms` p95) minting `Kaveri Precision Hydraulics Pvt Ltd` (`120 pcs`).
- **Stale Revision HMAC Protection:** Rev 1 token replay rejected at `HTTP 409 STALE_REVISION` in `281.15 ms` p50 (`557.30 ms` p95), keeping ERPNext `SKU-24` stock untouched at `1,000 pcs`.
- **Vertex AI RAG Lookup (`RagCorpus`):** `405.68 ms` p50 (`712.99 ms` p95) retrieving grounded policy clauses (`SOP-RCV-002`, `SOP-FIN-001`).
- **ADK Pipeline + ERPNext Purchase Receipt Commit:** `1,345.11 ms` p50 (`1,755.43 ms` p95) across all 3 sequential ADK stages (`MAT-PRE-2026-00008` through `MAT-PRE-2026-00017`, and `MAT-PRE-2026-00020` in live capture), moving `SKU-24` from `1,000` to `1,284 pcs` once vs `12,058 ms` measured for manual ERPNext Purchase Receipt draft navigation (`manual_vs_dockpilot_timing.json`, before GST debit math or supervisor sign-off).
- **Duplicate Commit Idempotency:** `995.63 ms` p50 (`1,476.29 ms` p95) returning the existing Purchase Receipt cleanly with stock unchanged at `1,284 pcs`.
- **Statutory & Gate Outputs:** TallyPrime XML (`2,438 bytes`, `285.36 ms` p50), CGST Rule 53 Debit Note PDF (`247.62 ms` p50), and Bilingual Driver Gate-Pass `GP-GRN-4471` (`192.78 ms` p50).
- **Voice FinOps Meter:** Sliding-window FSM context updates achieved **₹1.93/min** vs **₹19.63/min** uncompacted baseline on live Cloud Run WebSocket runs (`TTFA 907.1 ms`, `Despina hi-IN`).
- **Backend Test Suite:** **41/41 pytest** tests pass (`6.91 s`), and Next.js 15 TypeScript typecheck and production build pass cleanly.

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
