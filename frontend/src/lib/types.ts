export type WorkflowStage =
  | "IDENTIFY"
  | "RECONCILE"
  | "APPROVE"
  | "COMMIT"
  | "HOLD_EXCEPTION"
  | "REVERSED";

export type ActorRole = "RECEIVER" | "SUPERVISOR";

export type NoiseFilterMode = "raw" | "web-rnnoise";

export interface EWayBill {
  eway_bill_no: string;
  valid_until_iso: string;
  vehicle_no: string;
  consignor_gstin: string;
  declared_value_inr: number;
  status: "ACTIVE" | "EXPIRED" | "CANCELLED";
}

export interface PurchaseOrder {
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  vendor_gstin: string;
  invoice_no: string;
  challan_no: string;
  eway_bill: EWayBill;
  sku_id: string;
  ordered_cartons: number;
  pack_unit: string;
  expected_pieces: number;
  open_pieces: number;
}

export interface DraftRevision {
  revision_id: number;
  po_number: string;
  sku_id: string;
  cartons: number;
  pack_unit: string;
  pack_size: number;
  loose_pieces: number;
  total_pieces: number;
  expected_pieces: number;
  shortage_pieces: number;
  overage_pieces: number;
  shortage_value_inr: number;
  status: "DRAFT" | "CONFIRMED" | "SUPERSEDED" | "APPROVED" | "COMMITTED" | "BLOCKED";
  requires_supervisor_approval: boolean;
  hold_reasons: string[];
  created_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  spoken_transcript: string;
}

export interface PolicyCitation {
  doc_id: string;
  title: string;
  clause: string;
  revision: string;
  effective_date: string;
  excerpt: string;
  source_backend: "vertex_rag" | "local_index";
}

export interface ApprovalRecord {
  approval_id: string;
  workflow_id: string;
  revision_id: number;
  approver_id: string;
  approver_role: ActorRole;
  decision: "APPROVED" | "REJECTED";
  reason: string;
  citation_clause: string | null;
  approved_at: string;
}

export interface SupplierDebitNotePack {
  claim_id: string;
  grn_id: string;
  po_number: string;
  invoice_no: string;
  eway_bill_no: string;
  vendor_name: string;
  vendor_gstin: string;
  sku_id: string;
  short_pieces: intOrNum;
  unit_cost_inr: number;
  taxable_shortage_inr: number;
  cgst_inr: number;
  sgst_inr: number;
  total_debit_note_inr: number;
  policy_clause: string;
  supervisor_id: string;
  revision_id: number;
  status: "DRAFT" | "NONE";
  synthetic_disclaimer: string;
  created_at: string;
}

type intOrNum = number;

export interface GoodsReceiptNote {
  grn_id: string;
  workflow_id: string;
  po_number: string;
  sku_id: string;
  revision_id: number;
  received_pieces: number;
  shortage_pieces: number;
  shortage_value_inr: number;
  idempotency_key: string;
  approver_id: string | null;
  claim_id: string | null;
  reversed: boolean;
  committed_at: string;
}

export interface StockMovement {
  movement_id: string;
  workflow_id: string;
  grn_id: string;
  warehouse_id: string;
  sku_id: string;
  delta_pieces: number;
  balance_before: number;
  balance_after: number;
  kind: "RECEIPT" | "REVERSAL";
  reason: string;
  created_at: string;
}

export interface AuditEvent {
  event_id: string;
  workflow_id: string;
  stage: WorkflowStage;
  event_type: string;
  actor_id: string;
  actor_role: string;
  revision_id: number | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface WorkflowSnapshot {
  workflow_id: string;
  stage: WorkflowStage;
  write_gate_open: boolean;
  po_number: string | null;
  sku_id: string | null;
  inventory_balance: number;
  current_revision_id: number | null;
  revisions: DraftRevision[];
  citations: PolicyCitation[];
  approval: ApprovalRecord | null;
  grn: GoodsReceiptNote | null;
  claim_pack: SupplierDebitNotePack | null;
  movements: StockMovement[];
  audit_events: AuditEvent[];
  updated_at: string;
}

export interface PromptCard {
  stage: WorkflowStage;
  text: string;
  approx_tokens: number;
}

export interface TelemetrySnapshot {
  turns: number;
  active_prompt_tokens: number;
  naive_prompt_tokens: number;
  tokens: {
    text_in: number;
    image_in: number;
    audio_in: number;
    text_out: number;
    audio_out: number;
  };
  duration_seconds: number;
  metered_inr: number;
  metered_inr_per_min: number;
  shadow_naive_inr: number;
  shadow_naive_inr_per_min: number;
  ttfa_p50_ms: number;
  ttfa_p95_ms: number;
  ttfa_last_ms: number;
  barge_stop_p50_ms: number;
  barge_stop_last_ms: number;
  snr_before_db: number | null;
  snr_after_db: number | null;
  dropped_audio_frames: number;
  noise_filter_mode: string;
}

export interface HealthResponse {
  status: string;
  model: string;
  region: string;
  storage_backend: string;
  git_sha: string;
  live_configured: boolean;
}

export interface WorkflowStatePayload {
  type?: string;
  snapshot: WorkflowSnapshot;
  prompt_card: PromptCard;
  telemetry: TelemetrySnapshot;
  error_code?: string;
  message?: string;
  blocked?: boolean;
  idempotent_replay?: boolean;
  live_backend?: string;
  model?: string;
  region?: string;
  text?: string;
  data_b64?: string;
  tool?: string;
  stop_latency_ms?: number;
}
