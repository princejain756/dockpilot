#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID before deploying}"
REGION="${GCP_LOCATION:-asia-south1}"
FALLBACK_REGION="${VERTEX_FALLBACK_LOCATION:-us-central1}"
LIVE_VOICE="${GEMINI_LIVE_VOICE:-Despina}"
LIVE_LANG="${GEMINI_LIVE_LANGUAGE_CODE:-hi-IN}"
RAG_CORPUS="${VERTEX_RAG_CORPUS:-}"
RAG_LOC="${VERTEX_RAG_LOCATION:-}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-dockpilot-api}"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo clean-room)"

ENV_VARS="GCP_PROJECT_ID=${PROJECT_ID},GCP_LOCATION=${REGION},VERTEX_FALLBACK_LOCATION=${FALLBACK_REGION},GEMINI_LIVE_MODEL=gemini-3.8-live,GEMINI_LIVE_VOICE=${LIVE_VOICE},GEMINI_LIVE_LANGUAGE_CODE=${LIVE_LANG},STORAGE_BACKEND=firestore,GIT_SHA=${GIT_SHA}"
if [[ -n "${RAG_CORPUS}" ]]; then
  ENV_VARS="${ENV_VARS},VERTEX_RAG_CORPUS=${RAG_CORPUS}"
fi
if [[ -n "${RAG_LOC}" ]]; then
  ENV_VARS="${ENV_VARS},VERTEX_RAG_LOCATION=${RAG_LOC}"
fi

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --timeout 3600 \
  --min-instances "${MIN_INSTANCES:-0}" \
  --max-instances 3 \
  --concurrency 4 \
  --memory 1Gi \
  --cpu 1 \
  --set-env-vars "${ENV_VARS}"
