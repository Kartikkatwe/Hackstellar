// Response shapes of the backend API (backend/app/api.py). Only what the UI reads.

export type Channel = 'email' | 'call' | 'chat' | 'social'
export type Stage = 'dropped' | 'match' | 'verify' | 'llm' | 'new_issue' | 'pending'
export type Badge = 'Critical' | 'High' | 'Medium' | 'Low'
export type Flag = 'money' | 'legal' | 'angry' | 'rising'
export type Mode = 'live' | 'snapshot'

export interface Segment {
  key: string
  label: string
  values: (string | boolean)[]
}

export interface Config {
  business: string
  domain: string
  components: Record<string, string>
  segments: Segment[]
  impact_levels: string[]
  emotion_levels: string[]
  thresholds: Record<string, unknown>
  ranking: { angry_weight: number; trend_multiplier: number; critical_money_share: number; critical_legal_share: number; top_n: number }
  models: { gate: string; adjudicator: string; embedder: string }
  prices: Record<string, { input: number; output: number; cache_read?: number }>
}

export interface Health {
  pack: string
  business: string
  has_run: boolean
  batch: { running: boolean; done: number; total: number; error: string | null }
  live_complaints_use: string
}

export interface FunnelStage {
  stage: Stage
  label: string
  count: number
  share: number
}

export interface Funnel {
  run: { mode: string; n: number; started: string; wall_seconds: number; gate: string; llm: string; embedder: string }
  total: number
  stages: FunnelStage[]
  share_without_llm: number
  llm_adjudications: number
  verify_calls: number
  issues_seeded: number
  issues_discovered: number
  issues_merged: number
}

export interface CostStage {
  stage: string
  model: string
  calls: number
  in_tokens: number
  out_tokens: number
  cost_usd: number
  seconds: number
}

export interface BaselineModel {
  model: string
  cost_usd: number
  cost_cached_usd: number
  saving_pct: number
  saving_vs_cached_pct: number
  per_100k_usd: number
  per_100k_cached_usd: number
}

export interface Cost {
  funnel: { stages: CostStage[]; cost_usd: number; per_complaint_usd: number; per_100k_usd: number; seconds: number }
  baseline: { in_tokens: number; out_tokens: number; models: BaselineModel[]; seconds: number; note: string }
  speedup: number
  note: string
}

export interface Accuracy {
  gate: { real_complaints: number; wrongly_dropped: number; non_complaints: number; non_complaints_let_through: number; complaint_recall_pct: number; noise_removed_pct: number }
  component_accuracy_pct: number
  issue: {
    assigned: number
    correct: number
    accuracy_pct: number
    coverage_pct: number
    by_stage: Record<string, { n: number; accuracy_pct: number }>
    still_waiting: Record<string, number>
  }
  discovered: {
    hidden_issues_in_data: number
    hidden_issues_found: number
    issues: { key: string; title: string; true_issue: string; size: number; purity_pct: number; duplicate_of_known: boolean }[]
  }
  identity: { linked: number; link_accuracy_pct: number; wrong_links: number; unlinked: number }
  note?: string
}

export interface Issue {
  rank: number
  issue_id: number
  key: string
  component: string
  title: string
  description: string
  origin: 'seed' | 'discovered' | 'merged'
  score: number
  badge: Badge
  flags: Flag[]
  unique_customers: number
  complaints: number
  unlinked_mentions: number
  avg_impact: number
  money_share: number
  legal_share: number
  angry_share: number
  trend: number
  customers_last_7d: number
  customers_prior_7d: number
  channels: Partial<Record<Channel, number>>
  settled_at: Partial<Record<Stage, number>>
  formula: string
  rank_in_other?: number | null
}

export interface TopResponse {
  filters: Record<string, string>
  issues: Issue[]
}

export interface IssueComplaint {
  id: string
  channel: Channel
  text: string
  created_at: string
  customer_id: string | null
  customer_name: string | null
  sender: string | null
  link_method: string
  order_id: string | null
  order_status: string
  stage: Stage
  similarity: number | null
  confidence: number | null
  reason: string | null
  impact: number
  emotion: number
  money_lost: number
  legal_risk: number
}

export interface RepeatCustomer {
  customer_id: string
  name: string
  channels: Channel[]
  contacts: { id: string; channel: Channel; created_at: string; text: string }[]
}

export interface IssueDetail {
  summary: Issue
  complaints: IssueComplaint[]
  repeat_customers: RepeatCustomer[]
  daily: [string, number][]
  impact_mix: Record<string, number>
}

export interface HeatCell {
  affected: number
  rate: number
  lift: number
}

export interface Heatmap {
  dimension: string
  label: string
  segment_sizes: Record<string, number>
  rows: { issue_id: number; title: string; rank: number; values: Record<string, HeatCell> }[]
}

export interface Compare {
  dimension: string
  a: { value: string; issues: Issue[] }
  b: { value: string; issues: Issue[] }
}

export interface PendingItem {
  id: string
  channel: Channel
  text: string
  created_at: string
  customer_id: string | null
  urgent: number
  component: string
  impact: number
  money_lost: number
  legal_risk: number
}

export interface ComplaintRow {
  id: string
  channel: Channel
  text: string
  created_at: string
  sender: string | null
  customer_id: string | null
  link_method: string
  link_conf: number
  order_id: string | null
  order_status: string
  settled: Stage
  urgent: number
  meta: string
}

export interface GateRow {
  complaint_id: string
  is_complaint: number
  component: string
  component_conf: number
  probs: string
  impact: number
  emotion: number
  money_lost: number
  legal_risk: number
}

export interface TrailEvent {
  stage: string
  model: string
  in_tokens: number
  out_tokens: number
  cost_usd: number
  latency_s: number
}

export interface Trail {
  complaint: ComplaintRow
  gate: GateRow | null
  filed_under: { issue_id: number; stage: string; similarity: number | null; confidence: number | null; reason: string | null; key: string; title: string } | null
  events: TrailEvent[]
}

export interface LiveResult extends Trail {
  mode: 'live' | 'offline'
  warning: string | null
  result: { id: string; settled: Stage; issue: number | null; title: string | null; urgent: boolean }
}

export interface NewComplaint {
  channel: Channel
  text: string
  email?: string
  phone?: string
  user_id?: string
  handle?: string
  order_id?: string
}
