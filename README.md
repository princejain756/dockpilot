# DockPilot

Voice and vision warehouse receiving copilot engineered for **Build with Google Gemini (PS 02: Voice-Driven Agentic Workflow Automation)** on Google Cloud Run (`asia-south1`, Mumbai). DockPilot pairs Vertex AI Gemini 3.8 Live audio-plus-video streaming over WebSockets with a deterministic Python Write-Gate backed by Cloud Firestore atomic transactions.

Built by Prince Jain (Full-Stack Software Engineer, Team ADELEV8 AI).

## Live Links and Submissions

- **Live Web Console:** `https://dockpilot.adelev8.com` (routed over TLS to Cloud Run `asia-south1`, fallback upstream `https://dockpilot-web-493779545452.asia-south1.run.app`)
- **Backend Health Endpoint:** `https://api.dockpilot.adelev8.com/api/health`
- **45s Architecture and Cost Breakdown (YouTube Short):** `https://youtube.com/shorts/Oyn0a0fRUcg`
- **LinkedIn Build Post (`#BuildwithGemini`):** `https://www.linkedin.com/feed/update/urn:li:activity:7530940062700802048/`

## Core Architecture

- **Realtime Voice Gateway (`backend/app/live_gateway.py`):** Streams bidirectional PCM16 audio and 1 FPS camera frames to Vertex AI `gemini-3.8-live` in `asia-south1`. Wraps `session.receive()` in an explicit multi-turn receive loop and pushes concise sub-200-token FSM stage context cards via `send_context_update` instead of resending static mega-prompts every turn.
- **Deterministic Write-Gate (`backend/app/ledger.py`, `backend/app/main.py`):** Gemini proposes structured counts (`propose_count`), while Python validates schema, policy thresholds (`₹25,000` variance supervisor escalation), and monotonically increasing `expected_revision` numbers. Blocked writes (`HTTP 409 STALE_REVISION` and `HTTP 403 FORBIDDEN_ROLE`) are persisted outside aborted transactions so audit history stays intact.
- **Atomic Ledger Commit:** Supervisor sign-off commits SKU inventory updates atomically inside a single `@firestore.transactional` boundary and generates a serial `DRAFT` GST Debit Note pack alongside immutable Cloud Firestore audit events.
- **Operator Command Center (`frontend/src/`):** Next.js 16 dashboard showing live Hinglish transcript stream, optimistic lock states, revision bumps, live meter telemetry (`₹/min`), and dynamic sibling Cloud Run or custom-domain API resolution (`frontend/src/lib/api.ts`).

## Verified Cloud Run Torture-Test Metrics

- **Token and Cost Reduction:** Replacing a 20,000-token monolithic system prompt with sub-200-token FSM context cards cut live metered session cost by **77%**, from **₹9.12/min** down to **₹2.07/min** across 4 tool calls.
- **Barge-In Concurrency Lock:** Mid-sentence count corrections trigger **HTTP 409 STALE_REVISION** blocks with **58 ms** Firestore tool round-trip timing.
- **Policy Enforcement:** Self-approval on high-value discrepancies fails closed with **HTTP 403 FORBIDDEN_ROLE** above **₹25,000**.
- **Atomic Settlement:** Validated SKU-24 commits once from **1,000 to 1,284** pieces, emitting a **₹33,040 DRAFT** GST Debit Note.
- **Test Verification:** **32/32 pytest** invariant and API tests pass alongside **10/10** concurrent ledger race stress trials.

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
