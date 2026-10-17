/** Interfaces alignées sur les serializers DRF du module sponsors. */

export type Industry =
  | 'finance' | 'tech' | 'retail' | 'food_beverage' | 'automotive'
  | 'health' | 'media' | 'energy' | 'other';

export type RelationshipStatus = 'prospect' | 'contacted' | 'negotiating' | 'active' | 'inactive';
export type DealStatus = 'lead' | 'contacted' | 'proposal_sent' | 'negotiating' | 'signed' | 'paid' | 'lost';
export type DeliverableType =
  | 'logo_placement' | 'booth' | 'speaking_slot' | 'naming'
  | 'social_post' | 'goodies' | 'attendee_data' | 'other';
export type DeliverableStatus = 'pending' | 'in_progress' | 'delivered' | 'at_risk';
export type PaymentStatus = 'planned' | 'invoiced' | 'paid' | 'overdue';
export type Severity = 'error' | 'warning';

export interface ApiSponsor {
  id: string;
  organization: string;
  created_by: string | null;
  created_by_name: string;
  name: string;
  legal_name: string;
  industry: Industry;
  website: string;
  logo_url: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  country: string;
  relationship_status: RelationshipStatus;
  notes: string;
  created_at: string;
}

export interface PackageBenefit {
  type: DeliverableType;
  title: string;
  offset_days: number;
}

export interface ApiSponsorshipPackage {
  id: string;
  event: string;
  name: string;
  tier_rank: number;
  price: string;
  slots_total: number;
  exclusive_industry: boolean;
  visibility_weight: string;
  description: string;
  benefits: PackageBenefit[];
  active: boolean;
  created_at: string;
}

export interface ApiSponsorshipDeal {
  id: string;
  event: string;
  sponsor: string;
  sponsor_name: string;
  sponsor_industry: Industry;
  sponsor_logo_url: string;
  sponsor_organization: string;
  next_due_date: string | null;
  owner: string | null;
  owner_name: string;
  created_by_name: string;
  package: string | null;
  package_name: string;
  status: DealStatus;
  cash_amount: string;
  in_kind_value: string;
  in_kind_description: string;
  currency: string;
  probability_percent: number;
  signed_at: string | null;
  lost_reason: string;
  notes: string;
  deliverables_done: number;
  deliverables_total: number;
  paid_amount: string;
  created_at: string;
}

export interface ApiSponsorshipActivity {
  id: string;
  deal: string;
  actor: string | null;
  actor_name: string;
  action: string;
  from_status: string;
  to_status: string;
  message: string;
  created_at: string;
}

export interface ApiSponsorDeliverable {
  id: string;
  deal: string;
  sponsor_name: string;
  title: string;
  deliverable_type: DeliverableType;
  due_date: string | null;
  status: DeliverableStatus;
  schedule_item: string | null;
  resource: string | null;
  asset_url: string;
  delivered_at: string | null;
  warnings?: string[];
}

export interface ApiSponsorPayment {
  id: string;
  deal: string;
  sponsor_name: string;
  currency: string;
  label: string;
  amount: string;
  due_date: string | null;
  status: PaymentStatus;
  invoice_ref: string;
  paid_at: string | null;
}

export interface FitCriterion {
  key: string;
  label: string;
  weight: number;
  score: number;
  detail: string;
}

export interface ApiSponsorFit {
  evaluation_id: string;
  sponsor: string;
  sponsor_name: string;
  industry: Industry;
  fit_score: number;
  audience_match_count: number;
  industry_match: boolean;
  budget_fit: boolean;
  estimated_roi: number | null;
  hard_constraint_failures: { code: string; message: string }[];
  breakdown: FitCriterion[];
  explanation: string;
}

export interface SponsorshipSummary {
  target_budget: number;
  confirmed_cash: number;
  confirmed_in_kind: number;
  weighted_pipeline: number;
  best_case: number;
  funding_gap: number;
  coverage_percent: number;
  active_deals: number;
  counts: Record<DealStatus, number>;
}

export interface SponsorConflict {
  code: string;
  severity: Severity;
  message: string;
  deal_ids: string[];
}

export interface SponsorAlert {
  code: string;
  severity: Severity;
  target: 'payments' | 'deliverables' | 'pipeline' | 'conflicts';
  deal_id: string | null;
  object_id: string | null;
  message: string;
}

export interface SummaryResponse {
  event: { id: string; name: string; organization: string };
  summary: SponsorshipSummary;
  conflicts: SponsorConflict[];
  alerts: SponsorAlert[];
}

export interface PackageRecommendation {
  items: { package_id: string; package_name: string; price: number; quantity: number; subtotal: number }[];
  packages_count: number;
  total: number;
  surplus: number;
  shortfall: number;
  covers_gap: boolean;
}

export interface RecommendationsResponse {
  gap: number;
  proposals: PackageRecommendation[];
}

export interface NetBudget {
  has_budget: boolean;
  budget_id: string | null;
  budget_name: string;
  currency: string;
  planned_cost: number;
  confirmed_sponsorship: number;
  weighted_sponsorship: number;
  best_case_sponsorship: number;
  net_pessimistic: number;
  net_weighted: number;
  net_optimistic: number;
}

export interface DealReport {
  deal_id: string;
  sponsor: string;
  event: string;
  package: string;
  status: DealStatus;
  cash_amount: number;
  in_kind_value: number;
  currency: string;
  deliverables: { title: string; type: DeliverableType; due_date: string | null; status: DeliverableStatus; delivered_at: string | null; asset_url: string }[];
  deliverables_delivered: number;
  deliverables_total: number;
  payments: { label: string; amount: number; due_date: string | null; status: PaymentStatus; paid_at: string | null }[];
  payments_planned: number;
  payments_paid: number;
  exposure: { participants: number; delivered: number; total: number; delivered_weight: number; visibility_weight: number; estimated_exposure: number };
}

export interface PortalLink {
  token: string;
  url: string;
  expires_in_days: number;
  email_sent: boolean;
  sent_to?: string;
  email_error?: string;
}

export interface ImportReport {
  created: number;
  skipped: number;
  errors: { line: number; message: string }[];
  skipped_details: { line: number; name: string; reason: string }[];
}

export interface OrganizerItem {
  id: string;
  organization: string | null;
  full_name: string;
  email: string;
  role: string;
}

export interface PortalData {
  event_name: string;
  event_start: string | null;
  event_end: string | null;
  sponsor_name: string;
  package_name: string;
  status: DealStatus;
  deliverables: { id: string; title: string; deliverable_type: DeliverableType; due_date: string | null; status: DeliverableStatus; asset_url: string }[];
  payments: { label: string; amount: number; currency: string; due_date: string | null; status: PaymentStatus }[];
}

/** Erreur normalisée renvoyée par SponsorsDataService. */
export interface ApiError {
  status: number;
  message: string;
  fields: Record<string, string>;
  duplicates: ApiSponsor[];
  conflicts: SponsorConflict[];
}

export const INDUSTRY_LABELS: Record<Industry, string> = {
  finance: 'Finance',
  tech: 'Tech',
  retail: 'Commerce',
  food_beverage: 'Restauration',
  automotive: 'Automobile',
  health: 'Santé',
  media: 'Média',
  energy: 'Énergie',
  other: 'Autre'
};

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  lead: 'Lead',
  contacted: 'Contacté',
  proposal_sent: 'Proposition envoyée',
  negotiating: 'Négociation',
  signed: 'Signé',
  paid: 'Payé',
  lost: 'Perdu'
};

export const PIPELINE_COLUMNS: DealStatus[] = ['lead', 'contacted', 'proposal_sent', 'negotiating', 'signed', 'paid'];

export const ALLOWED_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  lead: ['contacted', 'lost'],
  contacted: ['proposal_sent', 'lost'],
  proposal_sent: ['negotiating', 'lost'],
  negotiating: ['signed', 'lost'],
  signed: ['paid', 'lost'],
  paid: [],
  lost: ['lead']
};

export const DELIVERABLE_TYPE_LABELS: Record<DeliverableType, string> = {
  logo_placement: 'Logo',
  booth: 'Stand',
  speaking_slot: 'Prise de parole',
  naming: 'Naming',
  social_post: 'Réseaux sociaux',
  goodies: 'Goodies',
  attendee_data: 'Données participants',
  other: 'Autre'
};

export const DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string> = {
  pending: 'À faire',
  in_progress: 'En cours',
  delivered: 'Livrée',
  at_risk: 'À risque'
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  planned: 'Prévu',
  invoiced: 'Facturé',
  paid: 'Payé',
  overdue: 'En retard'
};

export const RELATIONSHIP_LABELS: Record<RelationshipStatus, string> = {
  prospect: 'Prospect',
  contacted: 'Contacté',
  negotiating: 'En négociation',
  active: 'Actif',
  inactive: 'Inactif'
};

export function money(value: number | string | null | undefined, currency = 'EUR'): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(isNaN(n) ? 0 : n);
}

export function initials(name: string): string {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}

export interface ApiSponsorFitEvaluation {
  id: string;
  event: string;
  sponsor: string;
  fit_score: number;
  evaluated_at: string;
}

export interface ScheduleItemLite { id: string; title: string; starts_at: string; }
export interface ResourceLite { id: string; name: string; resource_type: string; capacity: number; }
