export type WorkflowStage =
  | "IDENTIFY"
  | "RECONCILE"
  | "APPROVE"
  | "COMMIT"
  | "HOLD_EXCEPTION"
  | "REVERSED";

export type ActorRole = "RECEIVER" | "SUPERVISOR" | "SYSTEM";

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

export interface SKU {
  sku_id: string;
  name: string;
  warehouse_id: string;
  unit_cost_inr: number;
  gst_rate_pct: number;
  hsn_code: string;
  pack_conversions: Record<string, number>;
  ambiguous_units: string[];
}

export interface CatalogResponse {
  pos: PurchaseOrder[];
  skus: SKU[];
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
  short_pieces: number;
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
  erp_receipt_id?: string | null;
  erp_po_id?: string | null;
  erp_stock_after?: number | null;
  erp_verified?: boolean;
  erp_url?: string | null;
  erp_sync_status?: "NOT_CONFIGURED" | "PENDING" | "POSTED" | "FAILED";
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

export interface ModelArmorCheck {
  safe: boolean;
  backend: string;
  location?: string;
  template: string;
  match_state: string;
  findings: string[];
  latency_ms: number;
}

export interface ADKStageTrace {
  agent: string;
  role_scope: string;
  status: string;
  latency_ms: number;
  detail?: Record<string, unknown>;
}

export interface DriverGatePass {
  gate_pass_id: string;
  workflow_id: string;
  grn_id: string;
  erp_receipt_id?: string | null;
  po_number: string;
  challan_no: string;
  vehicle_no: string;
  vendor_name: string;
  sku_id: string;
  sku_name: string;
  expected_pieces: number;
  received_pieces: number;
  shortage_pieces: number;
  shortage_value_inr: number;
  title_hi: string;
  summary_hi: string;
  summary_en: string;
  acknowledged_by_driver: boolean;
  driver_name: string | null;
  acknowledged_at: string | null;
  sig: string;
  gate_url: string;
}

export interface GSTINCheck {
  gstin: string;
  format_valid: boolean;
  checksum_valid: boolean;
  expected_check_char?: string;
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
  model_armor_last_check?: ModelArmorCheck | null;
  adk_pipeline_trace?: ADKStageTrace[];
  challan_source?: "SEEDED" | "CAMERA_UPLOAD";
  driver_gate_pass?: DriverGatePass | null;
  dynamic_po?: PurchaseOrder | null;
  dynamic_sku?: SKU | null;
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
  fallback_region?: string;
  voice?: string;
  language_code?: string;
  semantic_vad?: boolean;
  storage_backend: string;
  rag_backend?: "vertex_rag" | "local_index";
  git_sha: string;
  live_configured: boolean;
  erpnext_configured?: boolean;
  erpnext_base_url?: string | null;
  erpnext_company?: string;
  erpnext_warehouse?: string;
  model_armor_enabled?: boolean;
  model_armor_location?: string;
  model_armor_template?: string;
  adk_pipeline?: string;
}

export interface ApprovalLinkResponse {
  workflow_id: string;
  revision_id: number;
  revision_status: string;
  sig: string;
  approve_url: string;
  whatsapp_share_url: string;
  webhook_dispatched: boolean;
}

export interface ERPLiveStatus {
  configured: boolean;
  reachable: boolean;
  base_url: string | null;
  company?: string;
  warehouse?: string;
  latency_ms?: number;
  sku24_balance: number | null;
  stock_ledger_url: string | null;
  recent_receipts: Array<{
    name: string;
    supplier: string;
    posting_date: string;
    total_qty: number;
    docstatus: number;
    dockpilot_delivery_id?: string;
    dockpilot_revision_id?: number;
    dockpilot_workflow_id?: string;
    url: string;
  }>;
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
  from_region?: string;
  reason?: string;
  text?: string;
  data_b64?: string;
  tool?: string;
  stop_latency_ms?: number;
  po?: PurchaseOrder;
  sku?: SKU;
  model_armor?: ModelArmorCheck;
  gstin_check?: GSTINCheck;
  driver_gate_pass?: DriverGatePass;
}
