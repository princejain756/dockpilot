import type { HealthResponse, PolicyCitation, WorkflowStatePayload } from "./types";

export function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE) {
    return process.env.NEXT_PUBLIC_API_BASE.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const { hostname, protocol } = window.location;
    if (hostname.includes("dockpilot-web-") && hostname.endsWith(".run.app")) {
      return `https://${hostname.replace("dockpilot-web-", "dockpilot-api-")}`;
    }
    return `${protocol}//${hostname}:8000`;
  }
  return "http://127.0.0.1:8000";
}

export function getWsBase(): string {
  if (process.env.NEXT_PUBLIC_WS_BASE) {
    return process.env.NEXT_PUBLIC_WS_BASE.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const { hostname, protocol } = window.location;
    if (hostname.includes("dockpilot-web-") && hostname.endsWith(".run.app")) {
      return `wss://${hostname.replace("dockpilot-web-", "dockpilot-api-")}`;
    }
    const proto = protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${hostname}:8000`;
  }
  return "ws://127.0.0.1:8000";
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) {
    const detail = data?.detail || data;
    const code = detail?.error_code || `HTTP_${res.status}`;
    const msg = detail?.message || `Request failed (${res.status})`;
    const err = new Error(msg) as Error & { code?: string; status?: number };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export const dockApi = {
  health: () => apiRequest<HealthResponse>("/api/health"),
  state: (wf: string) => apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/state`),
  resolvePo: (wf: string, poNumber: string) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/resolve-po`, {
      method: "POST",
      body: JSON.stringify({ po_number: poNumber, actor_id: "receiver-01" }),
    }),
  draft: (
    wf: string,
    body: {
      po_number: string;
      cartons: number;
      loose_pieces: number;
      pack_unit: string;
      transcript: string;
      uom_confirmed?: boolean;
    }
  ) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/draft`, {
      method: "POST",
      body: JSON.stringify({ ...body, actor_id: "receiver-01" }),
    }),
  bargeIn: (wf: string, transcriptHint: string, stopLatencyMs = 195) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/barge-in`, {
      method: "POST",
      body: JSON.stringify({
        actor_id: "receiver-01",
        transcript_hint: transcriptHint,
        stop_latency_ms: stopLatencyMs,
      }),
    }),
  confirm: (wf: string, revisionId: number) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/confirm`, {
      method: "POST",
      body: JSON.stringify({ revision_id: revisionId, actor_id: "receiver-01" }),
    }),
  requestApproval: (wf: string, revisionId: number, reason: string) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/request-approval`, {
      method: "POST",
      body: JSON.stringify({ revision_id: revisionId, reason }),
    }),
  approve: (
    wf: string,
    revisionId: number,
    actorId: string,
    actorRole: "RECEIVER" | "SUPERVISOR",
    reason: string
  ) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/approve`, {
      method: "POST",
      body: JSON.stringify({
        revision_id: revisionId,
        actor_id: actorId,
        actor_role: actorRole,
        reason,
        citation_clause: "Clause 4",
      }),
    }),
  commit: (wf: string, revisionId: number, idempotencyKey: string) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/commit`, {
      method: "POST",
      body: JSON.stringify({
        revision_id: revisionId,
        idempotency_key: idempotencyKey,
        actor_id: "dockpilot-fsm",
      }),
    }),
  testStaleCommit: (wf: string) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/test-stale-commit`, { method: "POST" }),
  testDuplicateCommit: (wf: string) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/test-duplicate-commit`, { method: "POST" }),
  reverse: (wf: string, reason: string) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/reverse`, {
      method: "POST",
      body: JSON.stringify({ actor_id: "sup-meera", actor_role: "SUPERVISOR", reason }),
    }),
  reset: (wf: string) => apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/reset`, { method: "POST" }),
  searchSop: (wf: string, q: string) =>
    apiRequest<{ citations: PolicyCitation[]; latency_ms: number }>(
      `/api/sop/search?workflow_id=${encodeURIComponent(wf)}&q=${encodeURIComponent(q)}`
    ),
  telemetryPulse: (
    wf: string,
    payload: {
      snr_before_db?: number;
      snr_after_db?: number;
      filter_mode?: string;
      ttfa_ms?: number;
      duration_seconds?: number;
    }
  ) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/telemetry-pulse`, {
      method: "POST",
      body: JSON.stringify({ text_in: 420, audio_in: 500, audio_out: 120, ...payload }),
    }),
};
