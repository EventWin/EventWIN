import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { EventContextService } from '../../../twin/event-context.service';
import {
  ANALYSIS_ENGINE_LABEL,
  DEFAULT_WEIGHTS,
  FACTOR_LABELS,
  ScenarioMetric,
  baselineParams,
  buildTwin,
  compareScenario,
  fmtEur,
  isTransportEvent
} from '../../../twin/twin-analysis';
import { TwinDataService } from '../../../twin/twin-data.service';
import { CameraPreset, LayerKey, SceneSelection, TwinScene, fitColor } from '../../../twin/twin-scene';
import {
  ApiEvent,
  ApiParticipant,
  Attendee,
  FactorStatus,
  FitFactorKey,
  Recommendation,
  TwinModel,
  TwinScenarioParams,
  TwinSource,
  VehicleSpec
} from '../../../twin/twin.models';

const EVENT_TYPE_LABELS: Record<string, string> = {
  conference: 'Conférence',
  workshop: 'Atelier',
  road_trip: 'Road trip',
  retreat: 'Séminaire / retraite',
  gala: 'Gala',
  product_launch: 'Lancement produit',
  internal_meeting: 'Réunion interne',
  other: 'Autre'
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  planned: 'Planifié',
  active: 'Actif',
  confirmed: 'Confirmé',
  completed: 'Terminé',
  cancelled: 'Annulé'
};

type PageState = 'loading' | 'error' | 'empty' | 'ready';

interface CreateForm {
  name: string;
  event_type: string;
  start_date: string;
  end_date: string;
  location: string;
  participant_expected: number | null;
  target_budget: number | null;
  bus_standard_count: number | null;
}

@Component({
  selector: 'app-twin-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './twin-home.component.html',
  styleUrls: ['./twin-home.component.css']
})
export class TwinHomeComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('viewport') viewport?: ElementRef<HTMLDivElement>;

  readonly engineLabel = ANALYSIS_ENGINE_LABEL;
  readonly typeLabels = EVENT_TYPE_LABELS;
  readonly eventTypes = Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));
  readonly factorKeys = Object.keys(DEFAULT_WEIGHTS) as FitFactorKey[];
  readonly factorLabels = FACTOR_LABELS;

  state: PageState = 'loading';
  errorMessage = '';
  events: ApiEvent[] = [];
  event: ApiEvent | null = null;
  source: TwinSource | null = null;
  baseline: TwinModel | null = null;
  scenarioModel: TwinModel | null = null;
  twinLoading = false;
  twinError = '';

  layers: Record<LayerKey, boolean> = { participants: true, structure: true, route: true, resources: true, risks: true };
  selection: SceneSelection | null = null;
  emphasisedRec: string | null = null;
  expandedRec: string | null = null;

  weights: Record<FitFactorKey, number> = { ...DEFAULT_WEIGHTS };
  showWeights = false;

  params: TwinScenarioParams | null = null;
  viewScenario = false;
  metrics: ScenarioMetric[] = [];
  scenarioBusy = false;
  scenarioNotice = '';

  attendeeSort: 'fit' | 'name' | 'confidence' = 'fit';
  attendeeQuery = '';

  createOpen = false;
  createBusy = false;
  createError = '';
  form: CreateForm = this.emptyForm();
  showExplainer = false;

  linkOpen = false;
  linkBusy = false;
  linkError = '';
  linkChoice = new Set<string>();

  private scene: TwinScene | null = null;
  private sceneHost: HTMLElement | null = null;
  private subs = new Subscription();
  private themeObserver?: MutationObserver;

  constructor(
    private readonly data: TwinDataService,
    private readonly context: EventContextService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly zone: NgZone
  ) {}

  // ---- lifecycle ------------------------------------------------------------

  ngOnInit(): void {
    this.subs.add(this.route.queryParamMap.subscribe((q) => {
      if (q.get('create') === '1') this.openCreate();
      const id = q.get('event');
      if (id && this.events.length && id !== this.event?.id) {
        const found = this.events.find((e) => e.id === id);
        if (found) this.selectEvent(found);
      }
    }));
    this.loadEvents();
  }

  ngAfterViewInit(): void {
    this.themeObserver = new MutationObserver(() => this.scene?.setTheme(this.isDark()));
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.themeObserver?.disconnect();
    this.scene?.dispose();
  }

  // ---- loading ----------------------------------------------------------------

  loadEvents(preferId?: string): void {
    // Keep the current view on refresh; only show the full-page loader on first load.
    if (this.state !== 'ready') this.state = 'loading';
    this.data.listEvents().subscribe({
      next: (events) => {
        this.events = events;
        if (!events.length) {
          this.state = 'empty';
          this.event = null;
          this.context.clear();
          this.destroyScene();
          return;
        }
        this.state = 'ready';
        const wanted = preferId || this.route.snapshot.queryParamMap.get('event') || this.context.current?.id;
        this.selectEvent(events.find((e) => e.id === wanted) || events[0]);
      },
      error: (err) => {
        this.state = 'error';
        this.errorMessage = !err?.status || err.status >= 500
          ? 'L\'API EventTwin est injoignable. Vérifiez que le backend tourne sur le port 8000.'
          : 'Impossible de charger les événements.';
      }
    });
  }

  selectEvent(event: ApiEvent): void {
    this.event = event;
    this.context.select(event.id, event.name);
    this.selection = null;
    this.emphasisedRec = null;
    this.viewScenario = false;
    this.scenarioNotice = '';
    if (this.route.snapshot.queryParamMap.get('event') !== event.id) {
      this.router.navigate([], { relativeTo: this.route, queryParams: { event: event.id }, replaceUrl: true });
    }
    this.refreshTwin(true);
  }

  onEventChange(id: string): void {
    const found = this.events.find((e) => e.id === id);
    if (found) this.selectEvent(found);
  }

  refreshTwin(resetCamera = false): void {
    if (!this.event) return;
    const event = this.event;
    this.twinLoading = true;
    this.twinError = '';
    this.data.loadTwin(event).subscribe({
      next: (source) => {
        if (this.event?.id !== event.id) return;
        this.source = source;
        this.twinLoading = false;
        this.recompute(true, resetCamera);
      },
      error: () => {
        this.twinLoading = false;
        this.twinError = 'Le jumeau n\'a pas pu être chargé.';
      }
    });
  }

  /** Rebuilds the baseline (and scenario) models from the loaded source. */
  recompute(resetParams = false, resetCamera = false): void {
    if (!this.source) return;
    this.baseline = buildTwin(this.source, this.weights);
    if (resetParams || !this.params) this.params = baselineParams(this.source, this.baseline.venue);
    this.updateScenario();
    // The viewport only exists once the template has rendered the ready state.
    setTimeout(() => this.renderScene(resetCamera));
  }

  // ---- scene ---------------------------------------------------------------------

  private renderScene(resetCamera: boolean): void {
    const host = this.viewport?.nativeElement;
    const model = this.displayed;
    if (!host || !model) return;
    // The viewport element is recreated when the template re-renders: re-attach the scene.
    if (this.scene && this.sceneHost !== host) this.destroyScene();
    if (!this.scene) {
      this.sceneHost = host;
      this.zone.runOutsideAngular(() => {
        this.scene = new TwinScene(host, this.isDark());
      });
      this.scene!.onSelect = (sel) => this.zone.run(() => (this.selection = sel));
      resetCamera = true;
    }
    this.scene!.setModel(model, resetCamera);
    (Object.keys(this.layers) as LayerKey[]).forEach((k) => this.scene!.setLayer(k, this.layers[k]));
    this.scene!.select(this.selection, false);
    const rec = this.displayed?.recommendations.find((r) => r.id === this.emphasisedRec);
    this.scene!.emphasise(rec ? rec.affectedIds : []);
  }

  private destroyScene(): void {
    this.scene?.dispose();
    this.scene = null;
    this.sceneHost = null;
  }

  get displayed(): TwinModel | null {
    return this.viewScenario && this.scenarioModel ? this.scenarioModel : this.baseline;
  }

  get availableLayers(): { key: LayerKey; label: string }[] {
    const transport = this.displayed?.kind === 'transport';
    return [
      { key: 'participants', label: 'Participants' },
      { key: 'structure', label: transport ? 'Véhicules' : 'Lieu & sièges' },
      ...(transport ? [{ key: 'route' as LayerKey, label: 'Itinéraire' }] : [{ key: 'resources' as LayerKey, label: 'Salles & ressources' }]),
      { key: 'risks', label: 'Risques' }
    ];
  }

  toggleLayer(key: LayerKey): void {
    this.layers[key] = !this.layers[key];
    this.scene?.setLayer(key, this.layers[key]);
  }

  camera(preset: CameraPreset): void {
    this.scene?.setCamera(preset);
  }

  selectAttendee(a: Attendee): void {
    this.selection = { kind: 'participant', id: a.participantId };
    this.scene?.select(this.selection, true);
  }

  clearSelection(): void {
    this.selection = null;
    this.scene?.select(null);
  }

  // ---- selection details -------------------------------------------------------------

  get selectedAttendee(): Attendee | null {
    const s = this.selection;
    return s?.kind === 'participant' ? this.displayed?.attendees.find((a) => a.participantId === s.id) ?? null : null;
  }

  get selectedVehicle(): (VehicleSpec & { passengers: Attendee[] }) | null {
    const s = this.selection;
    const plan = this.displayed?.transport;
    if (s?.kind !== 'vehicle' || !plan) return null;
    const v = plan.vehicles.find((x) => x.id === s.id);
    if (!v) return null;
    const ids = plan.assignments.filter((a) => a.vehicleId === v.id).map((a) => a.participantId);
    return { ...v, passengers: this.displayed!.attendees.filter((a) => ids.includes(a.participantId)) };
  }

  get selectedRoom() {
    const s = this.selection;
    return s?.kind === 'room' ? this.displayed?.venue?.rooms.find((r) => r.id === s.id) ?? null : null;
  }

  get selectedZone(): string | null {
    return this.selection?.kind === 'zone' ? this.selection.id : null;
  }

  seatLabel(a: Attendee): string {
    const m = this.displayed;
    if (m?.transport) {
      const s = m.transport.assignments.find((x) => x.participantId === a.participantId);
      const v = m.transport.vehicles.find((x) => x.id === s?.vehicleId);
      return v && s?.seatIndex !== null && s?.seatIndex !== undefined ? `${v.label} · siège ${s.seatIndex + 1}` : 'Aucun siège disponible';
    }
    const s = m?.venue?.assignments.find((x) => x.participantId === a.participantId);
    return s?.seatIndex !== null && s?.seatIndex !== undefined ? `Salle principale · place ${s.seatIndex + 1}` : 'Sans place assise';
  }

  get overflowAttendees(): Attendee[] {
    const m = this.displayed;
    const ids = m?.transport?.unseated ?? m?.venue?.overflow ?? [];
    return m ? m.attendees.filter((a) => ids.includes(a.participantId)) : [];
  }

  // ---- recommendations ------------------------------------------------------------------

  toggleRec(r: Recommendation): void {
    this.expandedRec = this.expandedRec === r.id ? null : r.id;
  }

  inspectRec(r: Recommendation): void {
    this.emphasisedRec = this.emphasisedRec === r.id ? null : r.id;
    this.scene?.emphasise(this.emphasisedRec ? r.affectedIds : []);
    if (this.emphasisedRec && r.affectedIds.length === 1) {
      this.selection = { kind: 'participant', id: r.affectedIds[0] };
      this.scene?.select(this.selection, true);
    } else if (this.emphasisedRec && (r.id === 'seat-gap' || r.id === 'hall-capacity' || r.id === 'no-vehicle')) {
      this.selection = { kind: 'zone', id: 'overflow' };
      this.scene?.select(this.selection, true);
    }
  }

  testRec(r: Recommendation): void {
    if (!r.scenario || !this.params) return;
    this.params = { ...this.params, ...r.scenario };
    this.viewScenario = true;
    this.updateScenario();
    this.renderScene(false);
    document.getElementById('scenario')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- scenarios --------------------------------------------------------------------------

  get isTransport(): boolean {
    return !!this.event && isTransportEvent(this.event);
  }

  get scenarioDirty(): boolean {
    if (!this.source || !this.params || !this.baseline) return false;
    const b = baselineParams(this.source, this.baseline.venue);
    return this.isTransport
      ? b.bus_standard_count !== this.params.bus_standard_count || b.bus_mini_count !== this.params.bus_mini_count || b.bus_vip_count !== this.params.bus_vip_count
      : b.hall_capacity !== this.params.hall_capacity;
  }

  step(key: keyof TwinScenarioParams, delta: number): void {
    if (!this.params) return;
    const max = key === 'hall_capacity' ? 600 : 20;
    this.params = { ...this.params, [key]: Math.max(0, Math.min(max, (this.params[key] || 0) + delta)) };
    this.onParamsChange();
  }

  onParamsChange(): void {
    this.updateScenario();
    if (this.viewScenario) this.renderScene(false);
  }

  setView(scenario: boolean): void {
    this.viewScenario = scenario;
    this.renderScene(false);
  }

  resetScenario(): void {
    if (!this.source || !this.baseline) return;
    this.params = baselineParams(this.source, this.baseline.venue);
    this.updateScenario();
    this.viewScenario = false;
    this.renderScene(false);
  }

  private updateScenario(): void {
    if (!this.source || !this.baseline || !this.params) return;
    this.scenarioModel = buildTwin(this.source, this.weights, this.params);
    this.metrics = compareScenario(this.baseline, this.scenarioModel);
  }

  async saveScenario(): Promise<void> {
    if (!this.event || !this.params || !this.scenarioModel) return;
    this.scenarioBusy = true;
    this.scenarioNotice = '';
    const p = this.params;
    const name = this.isTransport
      ? `Flotte ${p.bus_standard_count} autocar(s) / ${p.bus_mini_count} minibus / ${p.bus_vip_count} VIP`
      : `Salle de ${p.hall_capacity} places`;
    const description = JSON.stringify({
      engine: ANALYSIS_ENGINE_LABEL,
      params: p,
      metrics: this.metrics.map(({ label, baseline, scenario }) => ({ label, baseline, scenario }))
    });
    try {
      await this.data.saveScenario(this.event.id, name, description);
      this.scenarioNotice = 'Scénario enregistré.';
      this.refreshTwin();
    } catch {
      this.scenarioNotice = 'Échec de l\'enregistrement du scénario.';
    } finally {
      this.scenarioBusy = false;
    }
  }

  async applyScenario(): Promise<void> {
    if (!this.event || !this.params || !this.source) return;
    if (!window.confirm('Appliquer ce scénario à l\'événement ? La configuration réelle sera modifiée.')) return;
    this.scenarioBusy = true;
    this.scenarioNotice = '';
    try {
      if (this.isTransport) {
        const updated = await this.data.updateEvent(this.event.id, {
          bus_standard_count: this.params.bus_standard_count,
          bus_mini_count: this.params.bus_mini_count,
          bus_vip_count: this.params.bus_vip_count
        });
        this.replaceEvent(updated);
      } else {
        const hall = this.source.resources.filter((r) => /room|salle|hall/i.test(r.resource_type)).sort((a, b) => b.capacity - a.capacity)[0];
        await this.data.upsertHallResource(this.event.id, hall, this.params.hall_capacity);
      }
      this.viewScenario = false;
      this.scenarioNotice = 'Scénario appliqué à l\'événement.';
      this.refreshTwin();
    } catch {
      this.scenarioNotice = 'Échec de l\'application du scénario.';
    } finally {
      this.scenarioBusy = false;
    }
  }

  private replaceEvent(updated: ApiEvent): void {
    this.events = this.events.map((e) => (e.id === updated.id ? updated : e));
    this.event = updated;
    if (this.source) this.source = { ...this.source, event: updated };
  }

  // ---- weights ------------------------------------------------------------------------------

  onWeightsChange(): void {
    this.recompute(false, false);
  }

  resetWeights(): void {
    this.weights = { ...DEFAULT_WEIGHTS };
    this.recompute(false, false);
  }

  // ---- attendees list ----------------------------------------------------------------------

  get attendees(): Attendee[] {
    const list = this.displayed?.attendees ?? [];
    const q = this.attendeeQuery.trim().toLowerCase();
    const filtered = q ? list.filter((a) => `${a.name} ${a.email}`.toLowerCase().includes(q)) : list;
    const sorted = [...filtered];
    if (this.attendeeSort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    if (this.attendeeSort === 'fit') sorted.sort((a, b) => (a.fit.score ?? 999) - (b.fit.score ?? 999));
    if (this.attendeeSort === 'confidence') sorted.sort((a, b) => a.fit.confidence - b.fit.confidence);
    return sorted;
  }

  mismatches(a: Attendee) {
    return a.fit.factors.filter((f) => f.status === 'mismatch');
  }

  riskCount(m: TwinModel): number {
    return m.recommendations.filter((r) => r.severity === 'risk').length;
  }

  // ---- link participants ----------------------------------------------------------------------

  get linkable(): ApiParticipant[] {
    if (!this.source) return [];
    const linked = new Set(this.source.links.map((l) => l.participant));
    return this.source.participants.filter((p) => !linked.has(p.id) && (p.role || 'participant') === 'participant');
  }

  openLink(): void {
    this.linkOpen = true;
    this.linkError = '';
    this.linkChoice = new Set();
  }

  toggleLink(id: string): void {
    this.linkChoice.has(id) ? this.linkChoice.delete(id) : this.linkChoice.add(id);
  }

  async confirmLink(): Promise<void> {
    if (!this.event || !this.linkChoice.size) return;
    this.linkBusy = true;
    this.linkError = '';
    try {
      for (const id of this.linkChoice) await this.data.linkParticipant(this.event.id, id);
      this.linkOpen = false;
      this.refreshTwin();
    } catch {
      this.linkError = 'Certains participants n\'ont pas pu être rattachés.';
      this.refreshTwin();
    } finally {
      this.linkBusy = false;
    }
  }

  // ---- create event ---------------------------------------------------------------------------

  openCreate(): void {
    this.form = this.emptyForm();
    this.createError = '';
    this.createOpen = true;
  }

  closeCreate(): void {
    this.createOpen = false;
    if (this.route.snapshot.queryParamMap.get('create')) {
      this.router.navigate([], { relativeTo: this.route, queryParams: { create: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  get formErrors(): string[] {
    const f = this.form;
    const errors: string[] = [];
    if (!f.name.trim()) errors.push('Le nom est requis.');
    if (!f.start_date) errors.push('La date de début est requise.');
    if (f.end_date && f.start_date && f.end_date < f.start_date) errors.push('La date de fin précède la date de début.');
    if (!f.location.trim()) errors.push(this.form.event_type === 'road_trip' ? 'Le point de départ / itinéraire est requis.' : 'Le lieu est requis.');
    if ((f.participant_expected ?? 0) < 0 || (f.target_budget ?? 0) < 0) errors.push('Les valeurs ne peuvent pas être négatives.');
    return errors;
  }

  createTouched = false;

  async submitCreate(): Promise<void> {
    this.createTouched = true;
    if (this.formErrors.length) return;
    this.createBusy = true;
    this.createError = '';
    const f = this.form;
    const roadTrip = f.event_type === 'road_trip';
    try {
      const created = await this.data.createEvent({
        name: f.name.trim(),
        event_type: f.event_type,
        event_format: roadTrip ? 'mobile' : 'onsite',
        start_date: f.start_date,
        end_date: f.end_date || f.start_date,
        location: f.location.trim(),
        route_or_logistics_notes: roadTrip ? f.location.trim() : '',
        participant_expected: f.participant_expected ?? 0,
        participant_target: f.participant_expected ?? 0,
        target_budget: String(f.target_budget ?? 0),
        bus_standard_count: roadTrip ? Math.max(0, f.bus_standard_count ?? 0) : 0,
        status: 'draft'
      });
      this.createOpen = false;
      this.createTouched = false;
      this.router.navigate([], { relativeTo: this.route, queryParams: { event: created.id, create: null }, queryParamsHandling: 'merge', replaceUrl: true });
      this.loadEvents(created.id);
    } catch (err: any) {
      const detail = err?.error && typeof err.error === 'object' ? Object.values(err.error).flat().join(' ') : '';
      this.createError = !err?.status || err.status >= 500
        ? 'API injoignable : l\'événement n\'a pas été créé.'
        : `Création refusée par l'API. ${detail}`;
    } finally {
      this.createBusy = false;
    }
  }

  private emptyForm(): CreateForm {
    return { name: '', event_type: 'conference', start_date: '', end_date: '', location: '', participant_expected: null, target_budget: null, bus_standard_count: 1 };
  }

  // ---- formatting helpers -----------------------------------------------------------------------

  fmtEur = fmtEur;

  pct(v: number | null): string {
    return v === null ? '—' : `${Math.round(v * 100)}%`;
  }

  scoreColor(score: number | null): string {
    return `#${fitColor(score).toString(16).padStart(6, '0')}`;
  }

  statusLabel(s: string): string {
    return STATUS_LABELS[s] || s;
  }

  attendanceLabel(s: string): string {
    return ({ registered: 'Inscrit', confirmed: 'Confirmé', invited: 'Invité', cancelled: 'Annulé', attended: 'Présent' } as Record<string, string>)[s] || s;
  }

  factorClass(s: FactorStatus): string {
    return { ok: 'gain', partial: 'warn', mismatch: 'risk', unverified: '', missing: 'muted' }[s];
  }

  factorStatusLabel(s: FactorStatus): string {
    return { ok: 'Compatible', partial: 'Partiel', mismatch: 'Incompatibilité', unverified: 'À vérifier', missing: 'Donnée manquante' }[s];
  }

  dateRange(e: ApiEvent): string {
    if (!e.start_date) return 'Date à définir';
    const f = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    return e.end_date && e.end_date !== e.start_date ? `${f(e.start_date)} → ${f(e.end_date)}` : f(e.start_date);
  }

  daysUntil(e: ApiEvent): string {
    if (!e.start_date) return '';
    const d = Math.ceil((Date.parse(e.start_date) - Date.now()) / 86400000);
    return d > 0 ? `J-${d}` : d === 0 ? 'Aujourd\'hui' : 'Passé';
  }

  get simulationVersion(): string {
    return `v1.${this.source?.scenarios.length ?? 0}`;
  }

  initials(name: string): string {
    return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
  }

  isDark(): boolean {
    return document.documentElement.dataset['theme'] === 'dark';
  }
}
