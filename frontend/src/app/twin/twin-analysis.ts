// Deterministic, rule-based twin analysis (no ML model involved).
//
// Everything here is computed in the browser from declared API data. Fit scores
// only use preferences/constraints participants entered themselves; nothing is
// inferred about them. Seat/room assignments are *proposals* and are never
// written back to the API.

import {
  AiFit,
  ApiEvent,
  ApiParticipant,
  Attendee,
  FactorStatus,
  FitFactor,
  FitFactorKey,
  FitResult,
  Recommendation,
  SceneKind,
  TransportPlan,
  TwinKpis,
  TwinModel,
  TwinScenarioParams,
  TwinSource,
  VehicleSpec,
  VenuePlan
} from './twin.models';

export const ANALYSIS_ENGINE_LABEL = 'Règles déterministes v1';

export const DEFAULT_WEIGHTS: Record<FitFactorKey, number> = {
  interests: 25,
  transport: 20,
  accessibility: 20,
  diet: 15,
  accommodation: 10,
  schedule: 10
};

export const FACTOR_LABELS: Record<FitFactorKey, string> = {
  interests: 'Intérêts & objectifs',
  transport: 'Transport & trajet',
  accessibility: 'Accessibilité',
  diet: 'Restauration',
  accommodation: 'Hébergement',
  schedule: 'Horaires'
};

/** Below this share of evaluated weight, no score is shown. */
const MIN_CONFIDENCE = 0.35;

// ---- helpers ---------------------------------------------------------------

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function findDeclared(list: { type: string; value: string }[], ...types: string[]): string | null {
  const wanted = types.map(norm);
  const hit = list.find((item) => wanted.some((t) => norm(item.type).startsWith(t)));
  const value = hit?.value?.trim();
  return value ? value : null;
}

const NONE_VALUES = ['aucun', 'aucune', 'non', 'none', ''];
const isNone = (v: string | null) => v === null || NONE_VALUES.includes(norm(v));

export function isTransportEvent(event: ApiEvent): boolean {
  return event.event_type === 'road_trip'
    || event.event_format === 'mobile'
    || event.event_format === 'multi_site'
    || busTotal(event) > 0;
}

export function sceneKindFor(event: ApiEvent): SceneKind {
  return isTransportEvent(event) ? 'transport' : 'venue';
}

function busTotal(e: Pick<ApiEvent, 'bus_standard_count' | 'bus_mini_count' | 'bus_vip_count'>): number {
  return (e.bus_standard_count || 0) + (e.bus_mini_count || 0) + (e.bus_vip_count || 0);
}

function eventDays(event: ApiEvent): number {
  if (!event.start_date || !event.end_date) return 1;
  const days = Math.round((Date.parse(event.end_date) - Date.parse(event.start_date)) / 86400000) + 1;
  return Math.max(1, days);
}

const num = (v: string | number | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const isRoomResource = (type: string) => /room|salle|hall|venue|amphi|auditorium/.test(norm(type));
const isCateringResource = (type: string, name: string) => /cater|traiteur|restaur|repas|buffet|food/.test(norm(`${type} ${name}`));

// ---- fit score -------------------------------------------------------------

interface FitContext {
  event: ApiEvent;
  hasCatering: boolean;
  cateringText: string;
  hasSeat: boolean | null;
  firstSessionHour: number | null;
}

function factor(key: FitFactorKey, weights: Record<FitFactorKey, number>, status: FactorStatus, value: number | null, detail: string, recommendation?: string): FitFactor {
  return { key, label: FACTOR_LABELS[key], weight: weights[key], status, value, detail, recommendation };
}

const FORMAT_MATCH: Record<string, string[]> = {
  'conference': ['conference', 'product_launch', 'gala'],
  'atelier pratique': ['workshop', 'retreat'],
  'table ronde': ['internal_meeting', 'retreat', 'workshop']
};

const GOAL_MATCH: Record<string, string[]> = {
  'reseauter': ['conference', 'gala', 'product_launch', 'road_trip', 'retreat'],
  'apprendre': ['workshop', 'conference', 'internal_meeting'],
  'inspiration': ['conference', 'product_launch', 'retreat', 'road_trip']
};

export function computeFit(p: ApiParticipant, ctx: FitContext, weights = DEFAULT_WEIGHTS): FitResult {
  const prefs = p.preferences || [];
  const cons = p.constraints || [];
  const { event } = ctx;
  const factors: FitFactor[] = [];

  // Interests: declared preferred format and goal vs event type.
  const format = findDeclared(prefs, 'format');
  const goal = findDeclared(prefs, 'objectif');
  if (!format && !goal) {
    factors.push(factor('interests', weights, 'missing', null, 'Format et objectif non déclarés.', 'Inviter le participant à compléter le questionnaire.'));
  } else {
    const checks: boolean[] = [];
    const notes: string[] = [];
    if (format) {
      const ok = (FORMAT_MATCH[norm(format)] || []).includes(event.event_type);
      checks.push(ok);
      notes.push(`format préféré « ${format} » ${ok ? 'compatible' : 'peu représenté'}`);
    }
    if (goal) {
      const ok = (GOAL_MATCH[norm(goal)] || []).includes(event.event_type);
      checks.push(ok);
      notes.push(`objectif « ${goal} » ${ok ? 'servi' : 'peu servi'} par ce type d'événement`);
    }
    const share = checks.filter(Boolean).length / checks.length;
    const value = 0.4 + 0.6 * share;
    factors.push(factor('interests', weights, share === 1 ? 'ok' : share > 0 ? 'partial' : 'mismatch', value,
      notes.join(' ; ') + '.',
      share < 1 ? 'Prévoir un temps du programme adapté à ses attentes (ex. atelier ou session networking).' : undefined));
  }

  // Transport: for transport events, having a seat is what matters.
  const mode = findDeclared(cons, 'transport');
  if (isTransportEvent(event)) {
    if (ctx.hasSeat === false) {
      factors.push(factor('transport', weights, 'mismatch', 0.1, 'Aucune place disponible dans les véhicules prévus.', 'Ajouter un véhicule ou réaffecter les places.'));
    } else if (ctx.hasSeat === true) {
      factors.push(factor('transport', weights, 'ok', 1, `Place proposée dans un véhicule${mode ? ` (mode déclaré : ${mode})` : ''}.`));
    } else {
      factors.push(factor('transport', weights, 'unverified', 0.6, 'Affectation véhicule non calculée.'));
    }
  } else if (mode) {
    factors.push(factor('transport', weights, 'unverified', 0.8, `Vient en ${mode}. Durée de trajet inconnue (pas de géolocalisation).`));
  } else {
    factors.push(factor('transport', weights, 'missing', null, 'Mode de transport non déclaré.'));
  }

  // Accessibility: declared needs vs event accessibility level.
  const access = findDeclared(cons, 'accessibilit');
  if (access === null) {
    factors.push(factor('accessibility', weights, 'missing', null, 'Besoins d\'accessibilité non déclarés.'));
  } else if (isNone(access)) {
    factors.push(factor('accessibility', weights, 'ok', 1, 'Aucun besoin particulier déclaré.'));
  } else {
    const level = event.accessibility_level;
    if (level === 'strict') {
      factors.push(factor('accessibility', weights, 'ok', 1, `Besoin « ${access} » couvert par un niveau d'accessibilité strict.`));
    } else if (level === 'enhanced') {
      factors.push(factor('accessibility', weights, 'partial', 0.75, `Besoin « ${access} » ; niveau renforcé, à confirmer sur place.`, 'Confirmer l\'aménagement avec le lieu / transporteur.'));
    } else {
      factors.push(factor('accessibility', weights, 'mismatch', 0.25, `Besoin « ${access} » mais l'événement est au niveau d'accessibilité standard.`, 'Passer l\'accessibilité en « renforcée » et prévoir un placement adapté.'));
    }
  }

  // Diet: declared regime vs catering resources.
  const diet = findDeclared(cons, 'alimentaire');
  if (diet === null) {
    factors.push(factor('diet', weights, 'missing', null, 'Régime alimentaire non déclaré.'));
  } else if (isNone(diet) || norm(diet).startsWith('aucun')) {
    factors.push(factor('diet', weights, 'ok', 1, 'Pas de contrainte alimentaire.'));
  } else if (!ctx.hasCatering) {
    factors.push(factor('diet', weights, 'unverified', 0.5, `Régime « ${diet} » ; aucune ressource restauration enregistrée pour vérifier.`, 'Ajouter le traiteur dans les ressources et préciser les régimes couverts.'));
  } else if (norm(ctx.cateringText).includes(norm(diet.split(' (')[0]))) {
    factors.push(factor('diet', weights, 'ok', 1, `Régime « ${diet} » mentionné dans la restauration prévue.`));
  } else {
    factors.push(factor('diet', weights, 'unverified', 0.6, `Régime « ${diet} » non mentionné par la ressource restauration.`, 'Confirmer l\'option avec le traiteur.'));
  }

  // Accommodation: only matters for multi-day events.
  const accom = findDeclared(prefs, 'hebergement');
  const days = eventDays(event);
  if (accom === null) {
    factors.push(factor('accommodation', weights, days > 1 ? 'missing' : 'ok', days > 1 ? null : 1, days > 1 ? 'Préférence d\'hébergement non déclarée.' : 'Événement sur une journée : pas d\'hébergement requis.'));
  } else if (/pas besoin/.test(norm(accom)) || days === 1) {
    factors.push(factor('accommodation', weights, 'ok', 1, days === 1 ? 'Événement sur une journée.' : 'Pas besoin d\'hébergement.'));
  } else if (event.accommodation_required) {
    factors.push(factor('accommodation', weights, 'ok', 0.9, `Hébergement prévu ; préférence « ${accom} » à respecter.`));
  } else {
    factors.push(factor('accommodation', weights, 'mismatch', 0.3, `Événement de ${days} jours sans hébergement prévu ; souhaite « ${accom} ».`, 'Activer l\'hébergement pour cet événement ou communiquer une liste d\'hôtels.'));
  }

  // Schedule: declared arrival time vs first session.
  const arrival = findDeclared(prefs, 'arrivee');
  if (!arrival) {
    factors.push(factor('schedule', weights, 'missing', null, 'Heure d\'arrivée non déclarée.'));
  } else if (ctx.firstSessionHour === null) {
    factors.push(factor('schedule', weights, 'unverified', 0.7, `Arrivée « ${arrival} » ; programme non renseigné.`, 'Renseigner le programme pour vérifier la compatibilité.'));
  } else {
    const a = norm(arrival);
    const late = (a.startsWith('midi') && ctx.firstSessionHour < 12) || (a.startsWith('matin') && ctx.firstSessionHour < 9);
    factors.push(late
      ? factor('schedule', weights, 'mismatch', 0.35, `Arrive « ${arrival} » alors que le programme commence à ${ctx.firstSessionHour}h.`, 'Décaler la première session ou prévoir une arrivée la veille.')
      : factor('schedule', weights, 'ok', 1, `Arrivée « ${arrival} » compatible avec un début à ${ctx.firstSessionHour}h.`));
  }

  const total = factors.reduce((s, f) => s + f.weight, 0) || 1;
  const known = factors.filter((f) => f.value !== null);
  const knownWeight = known.reduce((s, f) => s + f.weight, 0);
  const confidence = knownWeight / total;
  const score = confidence >= MIN_CONFIDENCE && knownWeight > 0
    ? Math.round((known.reduce((s, f) => s + f.weight * (f.value as number), 0) / knownWeight) * 100)
    : null;

  return { score, source: 'rules', confidence, factors, hasMismatch: factors.some((f) => f.status === 'mismatch') };
}

// ---- plans -------------------------------------------------------------------

export function vehiclesFor(p: Pick<ApiEvent, 'bus_standard_count' | 'bus_standard_capacity' | 'bus_mini_count' | 'bus_mini_capacity' | 'bus_vip_count' | 'bus_vip_capacity'>): VehicleSpec[] {
  const out: VehicleSpec[] = [];
  const add = (kind: VehicleSpec['kind'], count: number, capacity: number, label: string) => {
    for (let i = 0; i < count; i++) out.push({ id: `${kind}-${i + 1}`, kind, label: `${label} ${i + 1}`, capacity: Math.max(1, capacity) });
  };
  add('vip', p.bus_vip_count, p.bus_vip_capacity, 'VIP');
  add('standard', p.bus_standard_count, p.bus_standard_capacity, 'Autocar');
  add('mini', p.bus_mini_count, p.bus_mini_capacity, 'Minibus');
  return out;
}

/** Proposed seating: accessibility needs get front seats of the first vehicles; others in registration order. */
export function planTransport(event: ApiEvent, attendees: Pick<Attendee, 'participantId' | 'needsAccessibility'>[], params?: TwinScenarioParams): TransportPlan {
  const vehicles = vehiclesFor(params ? { ...event, ...params } : event);
  const totalSeats = vehicles.reduce((s, v) => s + v.capacity, 0);
  const ordered = [...attendees.filter((a) => a.needsAccessibility), ...attendees.filter((a) => !a.needsAccessibility)];
  const slots: { vehicleId: string; seatIndex: number }[] = [];
  // Interleave vehicles so accessible passengers are spread over front rows.
  const maxCap = Math.max(0, ...vehicles.map((v) => v.capacity));
  for (let seat = 0; seat < maxCap; seat++) {
    for (const v of vehicles) if (seat < v.capacity) slots.push({ vehicleId: v.id, seatIndex: seat });
  }
  const assignments = ordered.map((a, i) => ({ participantId: a.participantId, vehicleId: slots[i]?.vehicleId ?? null, seatIndex: slots[i]?.seatIndex ?? null }));
  return { vehicles, totalSeats, assignments, unseated: assignments.filter((a) => a.vehicleId === null).map((a) => a.participantId) };
}

export function planVenue(source: TwinSource, attendees: Pick<Attendee, 'participantId' | 'needsAccessibility'>[], params?: TwinScenarioParams): VenuePlan {
  const rooms = source.resources.filter((r) => isRoomResource(r.resource_type)).map((r) => ({ id: r.id, name: r.name, capacity: r.capacity, type: r.resource_type }));
  const main = rooms.slice().sort((a, b) => b.capacity - a.capacity)[0];
  let hallCapacity: number;
  let capacitySource: VenuePlan['capacitySource'];
  if (params) {
    hallCapacity = params.hall_capacity;
    capacitySource = main ? 'resource' : 'event_target';
  } else if (main && main.capacity > 0) {
    hallCapacity = main.capacity;
    capacitySource = 'resource';
  } else if (source.event.participant_target > 0) {
    hallCapacity = source.event.participant_target;
    capacitySource = 'event_target';
  } else {
    hallCapacity = Math.max(attendees.length, source.event.participant_expected, 24);
    capacitySource = 'participants';
  }
  hallCapacity = Math.max(1, Math.min(hallCapacity, 600));
  const ordered = [...attendees.filter((a) => a.needsAccessibility), ...attendees.filter((a) => !a.needsAccessibility)];
  const assignments = ordered.map((a, i) => ({ participantId: a.participantId, seatIndex: i < hallCapacity ? i : null }));
  return {
    hallCapacity,
    capacitySource,
    rooms,
    hasCatering: source.resources.some((r) => isCateringResource(r.resource_type, r.name)),
    assignments,
    overflow: assignments.filter((a) => a.seatIndex === null).map((a) => a.participantId)
  };
}

export function baselineParams(source: TwinSource, venue: VenuePlan | null): TwinScenarioParams {
  const e = source.event;
  return {
    bus_standard_count: e.bus_standard_count,
    bus_mini_count: e.bus_mini_count,
    bus_vip_count: e.bus_vip_count,
    hall_capacity: venue?.hallCapacity ?? Math.max(e.participant_target, 0)
  };
}

// ---- model -------------------------------------------------------------------

/**
 * Remplace le score des règles par l'évaluation Gemini quand elle existe.
 * Les facteurs des règles restent affichés comme contrôles logistiques
 * (places, restauration enregistrée, programme) : ils dépendent du scénario.
 */
function withAi(rules: FitResult, ai: AiFit | undefined): FitResult {
  if (!ai || ai.score === null) return rules;
  return {
    ...rules,
    score: ai.score,
    source: 'gemini',
    ai,
    rulesScore: rules.score,
    confidence: 1,
    hasMismatch: rules.hasMismatch || ai.blockers.length > 0
  };
}

export function buildTwin(source: TwinSource, weights = DEFAULT_WEIGHTS, params?: TwinScenarioParams,
                          aiFits: Record<string, AiFit> = {}): TwinModel {
  const { event } = source;
  const byId = new Map(source.participants.map((p) => [p.id, p]));
  const kind = sceneKindFor(event);

  const base = source.links
    .map((link) => ({ link, p: byId.get(link.participant) }))
    .filter((x): x is { link: typeof x.link; p: ApiParticipant } => Boolean(x.p));

  const pre = base.map(({ link, p }) => {
    const access = findDeclared(p.constraints || [], 'accessibilit');
    const diet = findDeclared(p.constraints || [], 'alimentaire');
    return { link, p, needsAccessibility: !isNone(access), diet: isNone(diet) ? null : diet, participantId: p.id };
  });

  const transport = kind === 'transport' ? planTransport(event, pre, params) : null;
  const venue = kind === 'venue' ? planVenue(source, pre, params) : null;

  const catering = source.resources.filter((r) => isCateringResource(r.resource_type, r.name));
  const firstSession = source.schedule.map((s) => new Date(s.starts_at)).sort((a, b) => a.getTime() - b.getTime())[0];
  const unseated = new Set(transport?.unseated ?? []);

  const attendees: Attendee[] = pre.map(({ link, p, needsAccessibility, diet }) => ({
    participantId: p.id,
    linkId: link.id,
    name: p.full_name || p.email || 'Participant',
    email: p.email,
    attendanceStatus: link.attendance_status || 'registered',
    preferences: p.preferences || [],
    constraints: p.constraints || [],
    needsAccessibility,
    diet,
    fit: withAi(computeFit(p, {
      event,
      hasCatering: catering.length > 0,
      cateringText: catering.map((c) => `${c.name} ${c.resource_type}`).join(' '),
      hasSeat: transport ? !unseated.has(p.id) : null,
      firstSessionHour: firstSession ? firstSession.getHours() : null
    }, weights), aiFits[p.id])
  }));

  const kpis = computeKpis(source, attendees, transport, venue);
  return { source, kind, attendees, transport, venue, kpis, recommendations: recommend(source, attendees, transport, venue, kpis) };
}

function computeKpis(source: TwinSource, attendees: Attendee[], transport: TransportPlan | null, venue: VenuePlan | null): TwinKpis {
  const scored = attendees.filter((a) => a.fit.score !== null);
  const budgetIds = new Set(source.budgets.map((b) => b.id));
  const categories = source.budgetCategories.filter((c) => budgetIds.has(c.budget));
  const capacity = transport ? transport.totalSeats : venue?.hallCapacity ?? 0;
  const load = Math.max(attendees.length, source.event.participant_expected || 0);
  return {
    registered: attendees.length,
    target: source.event.participant_target || 0,
    completeness: attendees.length ? attendees.reduce((s, a) => s + a.fit.confidence, 0) / attendees.length : 0,
    avgFit: scored.length ? Math.round(scored.reduce((s, a) => s + (a.fit.score as number), 0) / scored.length) : null,
    avgConfidence: scored.length ? scored.reduce((s, a) => s + a.fit.confidence, 0) / scored.length : 0,
    scoredCount: scored.length,
    plannedBudget: categories.reduce((s, c) => s + num(c.planned_amount), 0) || source.budgets.reduce((s, b) => s + num(b.total_budget), 0),
    committed: categories.reduce((s, c) => s + num(c.actual_amount), 0),
    targetBudget: num(source.event.target_budget),
    capacity,
    utilization: capacity > 0 && load > 0 ? load / capacity : null
  };
}

// ---- recommendations ------------------------------------------------------------

function recommend(source: TwinSource, attendees: Attendee[], transport: TransportPlan | null, venue: VenuePlan | null, kpis: TwinKpis): Recommendation[] {
  const e = source.event;
  const out: Recommendation[] = [];
  const names = (ids: string[]) => {
    const list = attendees.filter((a) => ids.includes(a.participantId)).map((a) => a.name);
    return list.length > 3 ? `${list.slice(0, 3).join(', ')} +${list.length - 3}` : list.join(', ');
  };

  if (!attendees.length) {
    out.push({
      id: 'no-participants', severity: 'info',
      title: 'Aucun participant rattaché à cet événement',
      why: 'Sans participants, le jumeau ne peut évaluer ni l\'adéquation, ni la capacité réelle.',
      affected: 'Simulation entière', affectedIds: [],
      action: 'Rattacher des participants existants à l\'événement.',
      impact: 'Active le calcul des scores d\'adéquation et des affectations.',
      route: '/app/participants', routeLabel: 'Participants'
    });
  }

  if (transport) {
    const demand = Math.max(attendees.length, e.participant_expected || 0);
    if (transport.vehicles.length === 0) {
      out.push({
        id: 'no-vehicle', severity: demand ? 'risk' : 'warn',
        title: 'Aucun véhicule planifié',
        why: 'L\'événement est mobile mais aucun autocar ou minibus n\'est configuré.',
        affected: demand ? `${demand} voyageurs attendus` : 'Transport', affectedIds: attendees.map((a) => a.participantId),
        action: `Ajouter ${Math.max(1, Math.ceil(demand / 50))} autocar(s) standard.`,
        impact: 'Calcul exact de couverture des places ; coût non estimé (pas de tarif en base).',
        route: '/app/events', routeLabel: 'Configurer le transport',
        scenario: { bus_standard_count: Math.max(1, Math.ceil(demand / 50)) }
      });
    } else if (demand > transport.totalSeats) {
      const missing = demand - transport.totalSeats;
      const minis = Math.ceil(missing / Math.max(1, e.bus_mini_capacity || 30));
      out.push({
        id: 'seat-gap', severity: 'risk',
        title: `${missing} place(s) manquante(s) dans les véhicules`,
        why: `${demand} voyageurs pour ${transport.totalSeats} places : certains n'ont pas de siège.`,
        affected: transport.unseated.length ? names(transport.unseated) : `${missing} voyageurs prévus`,
        affectedIds: transport.unseated,
        action: `Ajouter ${minis} minibus (${e.bus_mini_capacity || 30} places).`,
        impact: `Couverture des places : ${Math.round((transport.totalSeats / demand) * 100)}% → 100% (calcul exact).`,
        route: '/app/events', routeLabel: 'Modifier le transport',
        scenario: { bus_mini_count: (e.bus_mini_count || 0) + minis }
      });
    } else if (demand > 0 && transport.totalSeats / demand > 1.6 && transport.vehicles.length > 1) {
      out.push({
        id: 'seat-excess', severity: 'info',
        title: 'Capacité de transport surdimensionnée',
        why: `${transport.totalSeats} places pour ${demand} voyageurs (${Math.round((demand / transport.totalSeats) * 100)}% d'occupation).`,
        affected: 'Flotte', affectedIds: [],
        action: 'Tester un scénario avec un véhicule de moins.',
        impact: 'Économie possible ; montant non estimé faute de tarif véhicule.',
        scenario: e.bus_standard_count > 0 ? { bus_standard_count: e.bus_standard_count - 1 } : { bus_mini_count: Math.max(0, e.bus_mini_count - 1) }
      });
    }
  }

  if (venue) {
    const demand = Math.max(attendees.length, e.participant_expected || 0);
    if (demand > venue.hallCapacity) {
      out.push({
        id: 'hall-capacity', severity: 'risk',
        title: 'Capacité de salle insuffisante',
        why: `${demand} personnes attendues pour ${venue.hallCapacity} places${venue.capacitySource === 'resource' ? '' : ' (capacité déduite de la cible)'}.`,
        affected: venue.overflow.length ? names(venue.overflow) : `${demand - venue.hallCapacity} personnes`,
        affectedIds: venue.overflow,
        action: `Porter la capacité à ${Math.ceil(demand * 1.05)} places ou ajouter une salle de débordement.`,
        impact: 'Supprime le débordement (calcul exact) ; coût non estimé.',
        route: '/app/budgets', routeLabel: 'Ressources',
        scenario: { hall_capacity: Math.ceil(demand * 1.05) }
      });
    }
    if (venue.capacitySource !== 'resource') {
      out.push({
        id: 'hall-undeclared', severity: 'info',
        title: 'Salle principale non déclarée',
        why: 'La capacité affichée est déduite de la cible de participants, pas d\'une ressource réelle.',
        affected: 'Lieu', affectedIds: [],
        action: 'Enregistrer la salle et sa capacité (bouton « Appliquer » du comparateur).',
        impact: 'Rend le plan de salle fiable.',
        route: '/app/budgets', routeLabel: 'Ressources'
      });
    }
  }

  const access = attendees.filter((a) => a.needsAccessibility);
  if (access.length && e.accessibility_level === 'standard') {
    out.push({
      id: 'accessibility', severity: 'risk',
      title: `${access.length} besoin(s) d'accessibilité non couverts`,
      why: 'Des participants ont déclaré un besoin d\'accessibilité alors que l\'événement est au niveau standard.',
      affected: names(access.map((a) => a.participantId)), affectedIds: access.map((a) => a.participantId),
      action: 'Passer l\'accessibilité en « renforcée » et réserver les places avant (déjà proposé dans le plan).',
      impact: 'Lève un facteur bloquant du score d\'adéquation pour ces personnes.',
      route: '/app/events', routeLabel: 'Paramètres de l\'événement'
    });
  }

  const diets = attendees.filter((a) => a.diet);
  if (diets.length && !source.resources.some((r) => isCateringResource(r.resource_type, r.name))) {
    const kinds = [...new Set(diets.map((a) => a.diet!.split(' (')[0]))];
    out.push({
      id: 'diet', severity: 'warn',
      title: `${diets.length} régime(s) alimentaire(s) sans restauration enregistrée`,
      why: `Régimes déclarés : ${kinds.join(', ')}. Aucune ressource de restauration ne permet de les vérifier.`,
      affected: names(diets.map((a) => a.participantId)), affectedIds: diets.map((a) => a.participantId),
      action: 'Ajouter le traiteur dans les ressources en indiquant les régimes couverts.',
      impact: 'Permet de confirmer ou d\'invalider la compatibilité alimentaire.',
      route: '/app/budgets', routeLabel: 'Budgets & ressources'
    });
  }

  const lowData = attendees.filter((a) => a.fit.confidence < 0.5);
  if (lowData.length && lowData.length >= attendees.length / 3) {
    out.push({
      id: 'data', severity: 'warn',
      title: `${lowData.length} profil(s) trop incomplets`,
      why: 'Leur score d\'adéquation est absent ou peu fiable : le manque d\'information n\'est pas une incompatibilité.',
      affected: names(lowData.map((a) => a.participantId)), affectedIds: lowData.map((a) => a.participantId),
      action: 'Relancer le questionnaire participant.',
      impact: `Complétude moyenne actuelle : ${Math.round(kpis.completeness * 100)}%.`,
      route: '/app/participants', routeLabel: 'Participants'
    });
  }

  const accomMismatch = attendees.filter((a) => a.fit.factors.some((f) => f.key === 'accommodation' && f.status === 'mismatch'));
  if (accomMismatch.length) {
    out.push({
      id: 'accommodation', severity: 'warn',
      title: 'Hébergement non prévu sur un événement de plusieurs jours',
      why: `${accomMismatch.length} participant(s) ont déclaré avoir besoin d'un hébergement.`,
      affected: names(accomMismatch.map((a) => a.participantId)), affectedIds: accomMismatch.map((a) => a.participantId),
      action: 'Activer « hébergement requis » et budgéter les nuitées.',
      impact: 'Lève un facteur d\'incompatibilité ; impact budgétaire à chiffrer.',
      route: '/app/events', routeLabel: 'Paramètres de l\'événement'
    });
  }

  if (kpis.targetBudget > 0 && kpis.plannedBudget > kpis.targetBudget) {
    out.push({
      id: 'budget', severity: 'risk',
      title: 'Budget planifié supérieur à la cible',
      why: `${fmtEur(kpis.plannedBudget)} planifiés pour une cible de ${fmtEur(kpis.targetBudget)}.`,
      affected: 'Budget', affectedIds: [],
      action: 'Revoir les postes les plus lourds.',
      impact: `Dépassement de ${fmtEur(kpis.plannedBudget - kpis.targetBudget)}.`,
      route: '/app/budgets', routeLabel: 'Budgets & ressources'
    });
  }

  const order = { risk: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function fmtEur(n: number): string {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

// ---- scenario comparison -------------------------------------------------------

export interface ScenarioMetric {
  label: string;
  baseline: string;
  scenario: string;
  better: boolean | null;
}

export function compareScenario(base: TwinModel, alt: TwinModel): ScenarioMetric[] {
  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
  const metrics: ScenarioMetric[] = [];
  const delta = (a: number, b: number, higherIsBetter: boolean) => (a === b ? null : higherIsBetter ? b > a : b < a);

  if (base.transport && alt.transport) {
    metrics.push({ label: 'Véhicules', baseline: `${base.transport.vehicles.length}`, scenario: `${alt.transport.vehicles.length}`, better: null });
    metrics.push({ label: 'Places', baseline: `${base.transport.totalSeats}`, scenario: `${alt.transport.totalSeats}`, better: null });
    metrics.push({ label: 'Voyageurs sans siège', baseline: `${base.transport.unseated.length}`, scenario: `${alt.transport.unseated.length}`, better: delta(base.transport.unseated.length, alt.transport.unseated.length, false) });
  }
  if (base.venue && alt.venue) {
    metrics.push({ label: 'Places en salle', baseline: `${base.venue.hallCapacity}`, scenario: `${alt.venue.hallCapacity}`, better: null });
    metrics.push({ label: 'Personnes sans place', baseline: `${base.venue.overflow.length}`, scenario: `${alt.venue.overflow.length}`, better: delta(base.venue.overflow.length, alt.venue.overflow.length, false) });
  }
  const u1 = base.kpis.utilization, u2 = alt.kpis.utilization;
  metrics.push({ label: 'Taux d\'occupation', baseline: pct(u1), scenario: pct(u2), better: u1 === null || u2 === null ? null : delta(Math.abs(0.85 - u1), Math.abs(0.85 - u2), false) });
  metrics.push({
    label: 'Adéquation moyenne', baseline: base.kpis.avgFit === null ? '—' : `${base.kpis.avgFit}`, scenario: alt.kpis.avgFit === null ? '—' : `${alt.kpis.avgFit}`,
    better: base.kpis.avgFit === null || alt.kpis.avgFit === null ? null : delta(base.kpis.avgFit, alt.kpis.avgFit, true)
  });
  const r1 = base.recommendations.filter((r) => r.severity === 'risk').length;
  const r2 = alt.recommendations.filter((r) => r.severity === 'risk').length;
  metrics.push({ label: 'Risques bloquants', baseline: `${r1}`, scenario: `${r2}`, better: delta(r1, r2, false) });
  return metrics;
}
