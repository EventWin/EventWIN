// Shapes returned by the Django API (see backend serializers) plus the derived
// digital-twin model computed client-side by twin-analysis.ts.

export interface ApiEvent {
  id: string;
  organization: string;
  organization_name?: string;
  name: string;
  event_type: string;
  event_format: string;
  objective: string;
  audience_type: string;
  mobility_level: string;
  accommodation_required: boolean;
  accessibility_level: string;
  route_or_logistics_notes: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  location: string;
  target_budget: string;
  participant_target: number;
  participant_expected: number;
  bus_standard_count: number;
  bus_standard_capacity: number;
  bus_mini_count: number;
  bus_mini_capacity: number;
  bus_vip_count: number;
  bus_vip_capacity: number;
  created_at: string;
}

export interface ApiParticipant {
  id: string;
  organization: string | null;
  full_name: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  preferences: { id: string; type: string; value: string }[];
  constraints: { id: string; type: string; value: string; is_hard: boolean }[];
}

export interface ApiEventParticipant {
  id: string;
  event: string;
  participant: string;
  attendance_status: string;
  satisfaction_score: string;
  created_at: string;
}

export interface ApiResource {
  id: string;
  event: string;
  resource_type: string;
  name: string;
  capacity: number;
  unit_cost: string;
  created_at: string;
}

export interface ApiScheduleItem {
  id: string;
  event: string;
  title: string;
  starts_at: string;
  ends_at: string;
  category: string;
  location: string;
}

export interface ApiBudget {
  id: string;
  event: string;
  name: string;
  total_budget: string;
  currency: string;
}

export interface ApiBudgetCategory {
  id: string;
  budget: string;
  name: string;
  planned_amount: string;
  actual_amount: string | null;
}

export interface ApiScenario {
  id: string;
  event: string;
  name: string;
  status: string;
  description: string;
  created_at: string;
}

/** Everything the twin needs for one event. `partial` lists sources that failed to load. */
export interface TwinSource {
  event: ApiEvent;
  links: ApiEventParticipant[];
  participants: ApiParticipant[];
  resources: ApiResource[];
  schedule: ApiScheduleItem[];
  budgets: ApiBudget[];
  budgetCategories: ApiBudgetCategory[];
  scenarios: ApiScenario[];
  partial: string[];
  loadedAt: Date;
}

// ---- Derived model --------------------------------------------------------

export type FactorStatus = 'ok' | 'partial' | 'mismatch' | 'unverified' | 'missing';

export interface FitFactor {
  key: FitFactorKey;
  label: string;
  weight: number;
  status: FactorStatus;
  /** 0..1 when the factor could be evaluated, null when data is missing. */
  value: number | null;
  detail: string;
  recommendation?: string;
}

export type FitFactorKey = 'interests' | 'transport' | 'diet' | 'accessibility' | 'accommodation' | 'schedule';

/** Évaluation Gemini (serveur) d'un participant pour cet événement. */
export interface AiFit {
  score: number | null;
  base_score: number | null;
  capped: boolean;
  verdict: { key: string; label: string };
  dimensions: Record<string, { score: number | null; note: string }>;
  blockers: { constraint: string; reason: string }[];
  strengths: string[];
  risks: string[];
  adaptations: string[];
  summary: string;
  comparison?: string;
  analyzed_at: string;
  model: string;
}

export interface FitResult {
  /** null when too little declared data to justify a score. */
  score: number | null;
  /** Origine du score : évaluation Gemini, ou règles locales à défaut. */
  source: 'gemini' | 'rules';
  /** Détail Gemini quand il existe ; les facteurs restent des contrôles logistiques. */
  ai?: AiFit;
  /** Score des règles locales, conservé pour comparaison. */
  rulesScore?: number | null;
  /** Share of total weight that could be evaluated (0..1). */
  confidence: number;
  factors: FitFactor[];
  /** True when the score is mainly lowered by actual logistical mismatches (not missing data). */
  hasMismatch: boolean;
}

export interface Attendee {
  participantId: string;
  linkId: string;
  name: string;
  email: string;
  attendanceStatus: string;
  preferences: ApiParticipant['preferences'];
  constraints: ApiParticipant['constraints'];
  needsAccessibility: boolean;
  diet: string | null;
  fit: FitResult;
}

export type SceneKind = 'transport' | 'venue';

export interface VehicleSpec {
  id: string;
  kind: 'standard' | 'mini' | 'vip';
  label: string;
  capacity: number;
}

export interface SeatAssignment {
  participantId: string;
  vehicleId: string | null;
  seatIndex: number | null;
}

export interface TransportPlan {
  vehicles: VehicleSpec[];
  totalSeats: number;
  assignments: SeatAssignment[];
  unseated: string[];
}

export interface VenuePlan {
  hallCapacity: number;
  capacitySource: 'resource' | 'event_target' | 'participants';
  rooms: { id: string; name: string; capacity: number; type: string }[];
  hasCatering: boolean;
  assignments: { participantId: string; seatIndex: number | null }[];
  overflow: string[];
}

export interface TwinScenarioParams {
  bus_standard_count: number;
  bus_mini_count: number;
  bus_vip_count: number;
  hall_capacity: number;
}

export interface Recommendation {
  id: string;
  severity: 'risk' | 'warn' | 'info';
  title: string;
  why: string;
  affected: string;
  affectedIds: string[];
  action: string;
  impact: string;
  route?: string;
  routeLabel?: string;
  /** Scenario tweak the organizer can test in the comparison panel. */
  scenario?: Partial<TwinScenarioParams>;
}

export interface TwinKpis {
  registered: number;
  target: number;
  completeness: number;
  avgFit: number | null;
  avgConfidence: number;
  scoredCount: number;
  plannedBudget: number;
  committed: number;
  targetBudget: number;
  capacity: number;
  utilization: number | null;
}

export interface TwinModel {
  source: TwinSource;
  kind: SceneKind;
  attendees: Attendee[];
  transport: TransportPlan | null;
  venue: VenuePlan | null;
  kpis: TwinKpis;
  recommendations: Recommendation[];
}
