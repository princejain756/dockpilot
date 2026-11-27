import type { DraftRevision, WorkflowSnapshot, WorkflowStage } from "./types";

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Signed Indian Rupee formatter with en-IN grouping, zero -₹0.00 artifacts,
 * and minus sign strictly preceding the currency symbol (-₹1,250).
 */
export function formatINR(
  value: number | string | null | undefined,
  options?: { decimals?: number; showSymbol?: boolean }
): string {
  const n = typeof value === "string" ? Number(value) : Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const decimals = options?.decimals ?? (Number.isInteger(round2(safe)) ? 0 : 2);
  const formatter = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const magnitude = formatter.format(Math.abs(safe));
  const roundedToZero = !formatter.formatToParts(Math.abs(safe)).some(
    (part) => (part.type === "integer" || part.type === "fraction") && /[1-9]/.test(part.value)
  );
  const sign = safe < 0 && !roundedToZero ? "-" : "";
  const symbol = options?.showSymbol === false ? "" : "₹";
  return sign + symbol + magnitude;
}

export function formatINRCompact(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const abs = Math.abs(safe);
  const sign = safe < 0 ? "-" : "";

  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2).replace(/\.00$/, "")}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2).replace(/\.00$/, "")}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return formatINR(safe);
}

export function formatCount(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : Number(value ?? 0);
  const safe = Number.isFinite(n) ? Math.trunc(n) : 0;
  return new Intl.NumberFormat("en-IN").format(safe);
}

export function labelFor(
  labels: Readonly<Record<string, string>>,
  value: string | null | undefined,
  fallback: string
): string {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!key) return fallback;
  return Object.hasOwn(labels, key) ? labels[key] : fallback;
}

export const STAGE_LABELS: Readonly<Record<string, string>> = {
  identify: "Identify",
  reconcile: "Reconcile",
  approve: "Approve",
  commit: "Commit",
  hold_exception: "Exception hold",
  reversed: "Reversed",
};

export const ROLE_LABELS: Readonly<Record<string, string>> = {
  receiver: "Dock receiver",
  supervisor: "Floor supervisor",
  system: "Workflow engine",
  rag: "Policy retriever",
  agent: "ADK pipeline",
  transporter: "Driver",
};

export const EWAY_STATUS_LABELS: Readonly<Record<string, string>> = {
  active: "Active",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const REVISION_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: "Draft",
  confirmed: "Confirmed",
  superseded: "Superseded",
  approved: "Approved",
  committed: "Posted",
  blocked: "Blocked",
};

export const CLAIM_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: "Draft debit note",
  none: "No debit note",
};

export const MOVEMENT_KIND_LABELS: Readonly<Record<string, string>> = {
  receipt: "Receipt",
  reversal: "Reversal",
};

export const RAG_BACKEND_LABELS: Readonly<Record<string, string>> = {
  vertex_rag: "Vertex AI RAG",
  local_index: "Local SOP index",
};

export const LIVE_BACKEND_LABELS: Readonly<Record<string, string>> = {
  vertex_ai: "Vertex AI Live",
  gemini_api: "Gemini Live API",
  local_simulator: "Local simulation",
};

export const STORAGE_LABELS: Readonly<Record<string, string>> = {
  firestore: "Cloud Firestore",
  sqlite: "Local SQLite",
};

export const REGION_LABELS: Readonly<Record<string, string>> = {
  "asia-south1": "Mumbai",
  "us-central1": "Iowa failover",
};

export const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  "hi-in": "Hinglish",
  "en-in": "Indian English",
};

export const AUDIT_EVENT_LABELS: Readonly<Record<string, string>> = {
  po_resolved: "Purchase order resolved",
  po_not_found: "Purchase order missing",
  challan_ingested_dynamic: "Challan verified & PO minted",
  model_armor_blocked: "Model Armor blocked injection",
  model_armor_passed: "Model Armor check passed",
  barge_in_gate_closed: "Posting paused by interruption",
  draft_revision_created: "Count revision created",
  receiver_confirmed: "Receiver confirmed count",
  hitl_approval_requested: "Supervisor review requested",
  supervisor_approved: "Supervisor approved revision",
  unauthorized_approval_attempt: "Self-approval denied",
  stale_approval_blocked: "Stale approval blocked",
  stale_confirm_blocked: "Stale confirmation blocked",
  blocked_stale_revision: "Stale revision blocked",
  blocked_supervisor_hold: "Supervisor hold blocked write",
  blocked_unconfirmed_draft: "Confirmation required",
  blocked_write_gate_closed: "Closed gate blocked write",
  duplicate_commit_blocked: "Duplicate commit blocked",
  idempotent_replay: "Existing receipt returned",
  grn_committed_atomic: "Goods receipt committed",
  erp_purchase_receipt_posted: "ERPNext receipt verified",
  adk_pipeline_settled: "ADK pipeline settled",
  driver_gate_pass_acknowledged: "Driver gate pass signed",
  grn_reversed_compensating: "Goods receipt reversed",
  sop_cited: "Policy clause cited",
  uom_ambiguity_block: "Pack unit confirmation required",
};

export const ERROR_CODE_LABELS: Readonly<Record<string, string>> = {
  po_not_found: "Purchase order missing",
  sku_not_found: "Item master missing",
  already_committed: "Receipt already posted",
  negative_quantity: "Invalid negative quantity",
  unknown_uom: "Unsupported pack unit",
  uom_ambiguity: "Pack unit confirmation required",
  no_active_draft: "No active count draft",
  write_gate_closed: "Posting paused",
  stale_revision: "Stale revision blocked",
  forbidden_role: "Supervisor sign-off required",
  invalid_approval_token: "Invalid supervisor signature",
  confirmation_required: "Receiver confirmation required",
  supervisor_approval_required: "Supervisor sign-off required",
  eway_bill_expired: "Expired e-Way Bill hold",
  prompt_injection_blocked: "Prompt injection blocked",
  no_grn_to_reverse: "No receipt to reverse",
  already_reversed: "Receipt already reversed",
  sop_error: "Policy lookup unavailable",
  backend_offline: "Gateway unreachable",
};

export const ACTOR_LABELS: Readonly<Record<string, string>> = {
  "receiver-01": "Dock receiver",
  "sup-meera": "Floor supervisor",
  "sup-ops-lead": "Supervisor (Mobile)",
  "dockpilot-fsm": "Write gate",
  "dockpilot-rag": "SOP retriever",
  "dockpilot-vision": "Challan Vision",
  "vertex-model-armor": "Model Armor",
  "adk-compliance-agent": "ADK Compliance",
  "adk-erp-settlement": "ADK ERP Settlement",
  "demo-fault-injector": "Stale check",
  "demo-duplicate-retry": "Idempotency check",
};

export function formatActor(actorId: string | null | undefined, actorRole?: string | null): string {
  const mapped = labelFor(ACTOR_LABELS, actorId, "");
  if (mapped) return mapped;
  return labelFor(ROLE_LABELS, actorRole, "Operator");
}

export function formatIsoTime(iso: string | null | undefined): string {
  if (!iso) return "Pending";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Pending";
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}

export function formatIsoDateTime(iso: string | null | undefined): string {
  if (!iso) return "Pending";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Pending";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(parsed);
}

export function formatIsoShortDateTime(iso: string | null | undefined): string {
  if (!iso) return "Pending";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Pending";
  const formatted = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(parsed);
  return `${formatted} IST`;
}

/**
 * Single authoritative revision lifecycle model shared across workbench, table, summary, and /dock
 * so a superseded revision is never labeled as both Superseded and Active Revision.
 */
export interface RevisionLifecycle {
  latestRev: DraftRevision | null;
  eligibleRev: DraftRevision | null;
  supersededRevs: DraftRevision[];
  latestSuperseded: DraftRevision | null;
  isInterruptedHold: boolean;
}

export function deriveRevisionLifecycle(snapshot: WorkflowSnapshot | null): RevisionLifecycle {
  const revisions = snapshot?.revisions ?? [];
  const currentId = snapshot?.current_revision_id ?? null;
  const latestRev =
    (currentId !== null ? revisions.find((r) => r.revision_id === currentId) : null) ??
    (revisions.length > 0 ? revisions[revisions.length - 1] : null);

  const isSupersededOrBlocked =
    latestRev?.status === "SUPERSEDED" || latestRev?.status === "BLOCKED";
  const isInterruptedHold = Boolean(snapshot && !snapshot.write_gate_open);
  const eligibleRev = isInterruptedHold || isSupersededOrBlocked ? null : latestRev;

  const supersededRevs = revisions.filter((r) => r.revision_id !== eligibleRev?.revision_id);
  const latestSuperseded =
    supersededRevs.length > 0 ? supersededRevs[supersededRevs.length - 1] : null;

  return {
    latestRev,
    eligibleRev,
    supersededRevs,
    latestSuperseded,
    isInterruptedHold,
  };
}

export type EligibleWriteAction = "none" | "confirm" | "approve" | "commit" | "reverse";

export interface GatePresentation {
  tone: "neutral" | "success" | "warning" | "danger";
  statusLabel: string;
  reason: string;
  primaryAction: EligibleWriteAction;
  canWrite: boolean;
  ctaLabel: string;
  ctaHint: string;
}

export function deriveGatePresentation(snapshot: WorkflowSnapshot | null): GatePresentation {
  if (!snapshot) {
    return {
      tone: "neutral",
      statusLabel: "Connecting",
      reason: "Loading receiving workflow state from gateway.",
      primaryAction: "none",
      canWrite: false,
      ctaLabel: "Post GRN",
      ctaHint: "Waiting for gateway connection",
    };
  }

  const { eligibleRev, latestSuperseded, isInterruptedHold } = deriveRevisionLifecycle(snapshot);

  if (snapshot.stage === "REVERSED") {
    return {
      tone: "warning",
      statusLabel: "Receipt reversed",
      reason: "Compensating entry restored inventory. Reset to start another receipt.",
      primaryAction: "none",
      canWrite: false,
      ctaLabel: "Post GRN",
      ctaHint: "Reset workflow to begin a new receipt",
    };
  }

  if (snapshot.grn && !snapshot.grn.reversed) {
    return {
      tone: "success",
      statusLabel: snapshot.grn.erp_verified ? "Posted to ERPNext" : "Receipt posted",
      reason: snapshot.grn.erp_receipt_id
        ? `${snapshot.grn.grn_id} verified in ERPNext (${snapshot.grn.erp_receipt_id}).`
        : `${snapshot.grn.grn_id} posted to Dock 1 ledger.`,
      primaryAction: "reverse",
      canWrite: true,
      ctaLabel: `Reverse ${snapshot.grn.grn_id}`,
      ctaHint: "Requires supervisor confirmation hold",
    };
  }

  if (isInterruptedHold) {
    return {
      tone: "warning",
      statusLabel: "Posting paused",
      reason: latestSuperseded
        ? `Previous Revision ${latestSuperseded.revision_id} was superseded. Speak or enter the corrected count.`
        : "Spoken interruption paused inventory writes. Speak or enter the corrected count.",
      primaryAction: "none",
      canWrite: false,
      ctaLabel: "Post GRN",
      ctaHint: "Record a corrected count to continue",
    };
  }

  if (snapshot.stage === "HOLD_EXCEPTION") {
    return {
      tone: "danger",
      statusLabel: "Compliance hold",
      reason: "Document compliance block prevents posting until valid documents are provided.",
      primaryAction: "none",
      canWrite: false,
      ctaLabel: "Post GRN",
      ctaHint: "Blocked by compliance policy",
    };
  }

  if (!eligibleRev) {
    return {
      tone: "neutral",
      statusLabel: "Awaiting count",
      reason: snapshot.po_number
        ? "Speak or enter packed cartons and loose pieces to create a count revision."
        : "Upload a challan or select a PO before counting.",
      primaryAction: "none",
      canWrite: false,
      ctaLabel: "Post GRN",
      ctaHint: "Needs a confirmed count revision",
    };
  }

  if (eligibleRev.status === "DRAFT") {
    return {
      tone: "neutral",
      statusLabel: "Read-back required",
      reason: `Confirm Revision ${eligibleRev.revision_id} (${formatCount(eligibleRev.total_pieces)} pcs) with the dock receiver.`,
      primaryAction: "confirm",
      canWrite: true,
      ctaLabel: `Confirm Rev ${eligibleRev.revision_id} · ${formatCount(eligibleRev.total_pieces)} pcs`,
      ctaHint: "Binds confirmation strictly to this revision",
    };
  }

  const approvalReady =
    snapshot.approval &&
    snapshot.approval.revision_id === eligibleRev.revision_id &&
    snapshot.approval.decision === "APPROVED";

  if (eligibleRev.requires_supervisor_approval && !approvalReady) {
    return {
      tone: "warning",
      statusLabel: "Supervisor hold",
      reason: `Shortage of ${formatINR(eligibleRev.shortage_value_inr)} exceeds ₹25,000 limit and requires supervisor sign-off.`,
      primaryAction: "approve",
      canWrite: true,
      ctaLabel: `Authorize Rev ${eligibleRev.revision_id} (Unlocks GRN post)`,
      ctaHint: "Supervisor sign-off required above ₹25,000 variance",
    };
  }

  return {
    tone: "success",
    statusLabel: "Cleared to post",
    reason: `Revision ${eligibleRev.revision_id} (${formatCount(eligibleRev.total_pieces)} pcs) is ready for atomic ERPNext posting.`,
    primaryAction: "commit",
    canWrite: true,
    ctaLabel: `Post GRN to ERPNext (${formatCount(eligibleRev.total_pieces)} pcs)`,
    ctaHint: "Runs compliance gate + atomic ERPNext Purchase Receipt",
  };
}

export function stepIndexForStage(stage: WorkflowStage | undefined): number {
  switch (stage) {
    case "IDENTIFY":
      return 0;
    case "RECONCILE":
      return 1;
    case "APPROVE":
      return 2;
    case "COMMIT":
    case "REVERSED":
      return 3;
    case "HOLD_EXCEPTION":
    default:
      return 1;
  }
}
