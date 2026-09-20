export type RefundStatus = "pending" | "processing" | "completed" | "failed";
export type Environment = "development" | "staging" | "production";
export type Risk = "low" | "medium" | "high";

export interface RefundTimelineEvent {
  timestamp: string;
  event: string;
  detail: string;
}

export interface Refund {
  id: string;
  payment_id: string;
  customer: string;
  amount_cents: number;
  currency: "USD";
  reason: string;
  status: RefundStatus;
  created_at: string;
  updated_at: string;
  owner: string;
  provider_reference: string;
  timeline: RefundTimelineEvent[];
}

export interface RefundSummary {
  total_count: number;
  total_amount_cents: number;
  pending_count: number;
  failed_count: number;
  completed_count: number;
  currency: "USD";
}

export interface RefundListResponse {
  refunds: Refund[];
  summary: RefundSummary;
}

export interface Flag {
  key: string;
  name: string;
  description: string;
  owner: string;
  risk: Risk;
  environment: Environment;
  enabled: boolean;
  rollout_percent: number;
  version: number;
  updated_at: string;
  updated_by: string;
}

export interface FlagListResponse {
  flags: Flag[];
  environment: Environment;
}

export interface AuditEvent {
  id: string;
  key: string;
  environment: Environment;
  actor: string;
  reason: string;
  timestamp: string;
  action: "updated" | "rolled_back";
  before: Flag;
  after: Flag;
}

export interface AuditListResponse {
  events: AuditEvent[];
  environment: Environment;
}

export type EvaluationReason =
  | "flag_disabled"
  | "rollout_zero"
  | "bucket_within_rollout"
  | "bucket_outside_rollout";

export interface DemoAccount {
  id: string;
  label: string;
  segment: string;
}

export interface FlagEvaluation {
  key: string;
  environment: Environment;
  account_id: string;
  decision: boolean;
  reason: EvaluationReason;
  bucket: number;
  bucket_count: number;
  threshold: number;
  enabled: boolean;
  rollout_percent: number;
  version: number;
}

export interface FlagEvaluationResponse {
  key: string;
  environment: Environment;
  flag: Flag;
  accounts: DemoAccount[];
  evaluations: FlagEvaluation[];
}

export interface FlagUpdatePayload {
  environment: Environment;
  enabled: boolean;
  rollout_percent: number;
  reason: string;
  expected_version: number;
  confirmation: string;
}

export interface FlagRollbackPayload {
  environment: Environment;
  reason: string;
  expected_version: number;
  confirmation: string;
}
