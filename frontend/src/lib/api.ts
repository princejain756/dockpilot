import type {
  ApprovalLinkResponse,
  CatalogResponse,
  DriverGatePass,
  ERPLiveStatus,
  HealthResponse,
  PolicyCitation,
  WorkflowStatePayload,
} from "./types";

export function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE) {
    return process.env.NEXT_PUBLIC_API_BASE.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const { hostname, protocol } = window.location;
    if (hostname === "dockpilot.adelev8.com") {
      return "https://api.dockpilot.adelev8.com";
    }
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
    if (hostname === "dockpilot.adelev8.com") {
      return "wss://api.dockpilot.adelev8.com";
    }
    if (hostname.includes("dockpilot-web-") && hostname.endsWith(".run.app")) {
      return `wss://${hostname.replace("dockpilot-web-", "dockpilot-api-")}`;
    }
    const proto = protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${hostname}:8000`;
  }
  return "ws://127.0.0.1:8000";
}

async function parseErrorResponse(res: Response): Promise<never> {
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  const detail = (data.detail as Record<string, unknown> | undefined) || data;
  const code = String(detail?.error_code || `HTTP_${res.status}`);
  const msg = String(detail?.message || `Request failed (${res.status})`);
  const err = new Error(msg) as Error & { code?: string; status?: number; detail?: unknown };
  err.code = code;
  err.status = res.status;
  err.detail = detail;
  throw err;
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
  if (!res.ok) {
    return parseErrorResponse(res);
  }
  return (await res.json()) as T;
}

export const dockApi = {
  health: () => apiRequest<HealthResponse>("/api/health"),
  catalog: () => apiRequest<CatalogResponse>("/api/catalog"),
  erpLiveStatus: () => apiRequest<ERPLiveStatus>("/api/erp/live-status"),
  state: (wf: string) => apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/state`),
  resolvePo: (wf: string, poNumber: string) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/resolve-po`, {
      method: "POST",
      body: JSON.stringify({ po_number: poNumber, actor_id: "receiver-01" }),
    }),
  ingestChallan: async (
    wf: string,
    opts: { file?: File; fixtureId?: "standard" | "alt-kaveri" | "injection-trap" }
  ): Promise<WorkflowStatePayload> => {
    const fd = new FormData();
    if (opts.file) fd.append("file", opts.file);
    if (opts.fixtureId) fd.append("fixture_id", opts.fixtureId);
    const res = await fetch(`${getApiBase()}/api/workflows/${wf}/ingest-challan`, {
      method: "POST",
      body: fd,
      cache: "no-store",
    });
    if (!res.ok) {
      return parseErrorResponse(res);
    }
    return (await res.json()) as WorkflowStatePayload;
  },
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
  approvalLink: (wf: string, revisionId?: number) => {
    const qs = revisionId !== undefined ? `?revision_id=${revisionId}` : "";
    return apiRequest<ApprovalLinkResponse>(`/api/workflows/${wf}/approval-link${qs}`);
  },
  approveByToken: (
    wf: string,
    body: {
      revision_id: number;
      sig: string;
      actor_id?: string;
      reason?: string;
      auto_commit?: boolean;
    }
  ) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/approve-by-token`, {
      method: "POST",
      body: JSON.stringify({
        actor_id: "sup-ops-lead",
        reason: "Verified physical count and challan via Supervisor Sign-Off",
        auto_commit: true,
        ...body,
      }),
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
  gatePass: (wf: string) => apiRequest<DriverGatePass>(`/api/workflows/${wf}/artifacts/gate-pass`),
  acknowledgeGatePass: (wf: string, body: { sig: string; driver_name: string }) =>
    apiRequest<WorkflowStatePayload>(`/api/workflows/${wf}/artifacts/gate-pass/acknowledge`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
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
  tallyXmlUrl: (wf: string) => `${getApiBase()}/api/workflows/${wf}/artifacts/tally-xml`,
  debitNotePdfUrl: (wf: string) => `${getApiBase()}/api/workflows/${wf}/artifacts/debit-note.pdf`,
  fixturePdfUrl: (fixtureId: "standard" | "alt-kaveri" | "injection-trap") =>
    `${getApiBase()}/api/fixtures/challans/${fixtureId}.pdf`,
};
