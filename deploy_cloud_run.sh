#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID before deploying}"
REGION="${GCP_LOCATION:-asia-south1}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-dockpilot-api}"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo clean-room)"

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --timeout 3600 \
  --min-instances 1 \
  --max-instances 3 \
  --concurrency 4 \
  --memory 1Gi \
  --cpu 1 \
  --set-env-vars "GCP_PROJECT_ID=${PROJECT_ID},GCP_LOCATION=${REGION},GEMINI_LIVE_MODEL=gemini-3.8-live,STORAGE_BACKEND=firestore,GIT_SHA=${GIT_SHA}"
