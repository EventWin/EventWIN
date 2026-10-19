import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EventContextService } from '../../../twin/event-context.service';

type EventItem = {
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
  registered_count?: number;
  created_at: string;
};


type OrganizationItem = {
  id: string;
  name: string;
  legal_name: string;
  created_at: string;
};

type EventForm = {
  organization: string;
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
  start_date: string;
  end_date: string;
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
};

type EventFormStatus = {
  hasOrganization: boolean;
  hasName: boolean;
  hasDates: boolean;
  dateOrderValid: boolean;
  hasLocation: boolean;
  hasBudget: boolean;
  hasType: boolean;
  hasFormat: boolean;
};

const EVENT_TYPES = [
  { value: 'conference', label: 'Conférence' },
  { value: 'workshop', label: 'Atelier' },
  { value: 'road_trip', label: 'Road trip' },
  { value: 'retreat', label: 'Séminaire / retraite' },
  { value: 'gala', label: 'Gala' },
  { value: 'product_launch', label: 'Lancement produit' },
  { value: 'internal_meeting', label: 'Réunion interne' },
  { value: 'other', label: 'Autre' }
];

// Statuts acceptés par l'API (Event.EVENT_STATUSES).
const EVENT_STATUSES = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'published', label: 'Publié' },
  { value: 'completed', label: 'Terminé' },
  { value: 'cancelled', label: 'Annulé' }
];

const EVENT_FORMATS = [
  { value: 'onsite', label: 'Sur site' },
  { value: 'hybrid', label: 'Hybride' },
  { value: 'remote', label: 'À distance' },
  { value: 'mobile', label: 'Itinérant' },
  { value: 'multi_site', label: 'Multi-sites' }
];

const AUDIENCE_TYPES = [
  { value: 'internal', label: 'Interne' },
  { value: 'external', label: 'Externe' },
  { value: 'mixed', label: 'Mixte' }
];

const MOBILITY_LEVELS = [
  { value: 'low', label: 'Faible' },
  { value: 'medium', label: 'Moyenne' },
  { value: 'high', label: 'Élevée' }
];

const ACCESSIBILITY_LEVELS = [
  { value: 'standard', label: 'Standard' },
  { value: 'enhanced', label: 'Renforcée' },
  { value: 'strict', label: 'Stricte' }
];

@Component({
  selector: 'app-events',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="title">Événements</h1>
        <p class="lede">Créez et gérez vos événements. Chaque ligne alimente ensuite les participants, le budget et la simulation.</p>
      </div>
      <div class="acts">
        <button class="btn btn-sm" type="button" (click)="refresh()">Rafraîchir</button>
        <button class="btn btn-primary btn-sm" type="button" (click)="startCreate()">Nouvel événement</button>
      </div>
    </div>

    <div class="grid g4">
      <div class="stat"><div class="lab">Total</div><div class="val n">{{ filteredEvents.length }}</div><div class="foot">événements affichés</div></div>
      <div class="stat"><div class="lab">Brouillons</div><div class="val n">{{ statusCount('draft') }}</div><div class="foot">encore modifiables</div></div>
      <div class="stat"><div class="lab">Publiés</div><div class="val n">{{ statusCount('published') }}</div><div class="foot">ouverts aux inscriptions</div></div>
      <div class="stat lit"><div class="lab"><span class="dotlive"></span> Inscriptions</div><div class="val n">{{ registrationsTotal }}</div><div class="foot">sur les événements affichés</div></div>
    </div>

    <div class="card mt">
      <div class="card-head">
        <h3>Filtres</h3>
        <p>Recherche rapide sur l'API</p>
      </div>
      <div class="grid g3 filter-grid">
        <input class="in" type="search" [(ngModel)]="query" placeholder="Chercher un événement, un lieu, un statut" />
        <select class="in" [(ngModel)]="statusFilter">
          <option value="">Tous les statuts</option>
          <option *ngFor="let item of eventStatuses" [value]="item.value">{{ item.label }}</option>
        </select>
        <button class="btn" type="button" (click)="clearFilters()">Réinitialiser</button>
      </div>
    </div>

    <div class="card mt">
      <div class="card-head">
        <h3>Vos événements</h3>
        <p>{{ filteredEvents.length }} élément(s)</p>
        <button class="btn btn-sm" type="button" (click)="startCreate()">Ajouter</button>
      </div>

      <div class="tw" *ngIf="!loading; else loadingTpl">
        <table>
          <thead>
            <tr>
              <th>Événement</th>
              <th>Type</th>
              <th>Organisation</th>
              <th>Date</th>
              <th>Lieu</th>
              <th>Participants</th>
              <th>Budget cible</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let event of filteredEvents">
              <td>
                <div class="who">
                  <i>{{ initials(event.name) }}</i>
                  <div>
                    <b>{{ event.name }}</b>
                    <small>{{ event.created_at | date:'mediumDate' }}</small>
                  </div>
                </div>
              </td>
              <td>{{ labelOf(eventTypes, event.event_type) }}</td>
              <td>{{ event.organization_name || '—' }}</td>
              <td>
                <div class="n">{{ event.start_date ? (event.start_date | date:'d MMM yyyy') : '—' }}</div>
                <div class="tiny muted" *ngIf="event.end_date && event.end_date !== event.start_date">→ {{ event.end_date | date:'d MMM yyyy' }}</div>
              </td>
              <td>{{ event.location || '—' }}</td>
              <td class="n" title="Inscrits / attendus">{{ event.registered_count ?? 0 }} / {{ event.participant_expected }}</td>
              <td class="n">{{ +event.target_budget ? (+event.target_budget | number:'1.0-0') + ' €' : '—' }}</td>
              <td><span class="chip" [class.gain]="event.status === 'published'" [class.warn]="event.status === 'draft'" [class.risk]="event.status === 'cancelled'">{{ labelOf(eventStatuses, event.status) }}</span></td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-sm btn-primary" type="button" (click)="openTwin(event)">Jumeau 3D</button>
                  <button class="btn btn-sm" type="button" (click)="startEdit(event)">Modifier</button>
                  <button class="btn btn-sm btn-danger" type="button" (click)="remove(event)">Supprimer</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ng-template #loadingTpl>
        <div class="empty">Chargement des événements...</div>
      </ng-template>

      <div class="empty" *ngIf="!loading && filteredEvents.length === 0">Aucun événement ne correspond aux filtres.</div>
    </div>

    <div class="card mt" *ngIf="formOpen">
      <div #eventFormAnchor></div>
      <div class="card-head">
        <h3>{{ editingEvent ? 'Modifier' : 'Créer' }} un événement</h3>
        <p>Le formulaire écrit directement dans l'API et prépare les données de simulation</p>
      </div>

      <form class="grid g2 event-form" (ngSubmit)="save()">
        <div class="card inner-card gfull">
          <div class="card-head">
            <h3>1. Cadre de l'événement</h3>
            <p>Ce que le jumeau doit représenter</p>
          </div>

          <div class="grid g2">
            <div class="field">
              <label>Organisation</label>
              <select class="in" name="organization" [(ngModel)]="form.organization" required>
                <option value="">{{ organizations.length ? 'Sélectionnez une organisation' : 'Aucune organisation disponible' }}</option>
                <option *ngFor="let organization of organizations" [value]="organization.id">
                  {{ organization.name }}
                </option>
              </select>
            </div>
            <div class="field">
              <label>Nom de l'événement</label>
              <input class="in" name="name" [(ngModel)]="form.name" placeholder="Séminaire annuel" required />
            </div>
            <div class="field">
              <label>Type d'événement</label>
              <select class="in" name="event_type" [(ngModel)]="form.event_type" required>
                <option *ngFor="let item of eventTypes" [value]="item.value">{{ item.label }}</option>
              </select>
            </div>
            <div class="field">
              <label>Format</label>
              <select class="in" name="event_format" [(ngModel)]="form.event_format" required>
                <option *ngFor="let item of eventFormats" [value]="item.value">{{ item.label }}</option>
              </select>
            </div>
            <div class="field">
              <label>Statut de préparation</label>
              <select class="in" name="status" [(ngModel)]="form.status">
                <option *ngFor="let item of eventStatuses" [value]="item.value">{{ item.label }}</option>
              </select>
            </div>
            <div class="field">
              <label>Lieu principal</label>
              <input class="in" name="location" [(ngModel)]="form.location" placeholder="Lyon, siège principal" required />
            </div>
            <div class="field gfull">
              <label>Objectif</label>
              <input class="in" name="objective" [(ngModel)]="form.objective" placeholder="Créer de l'engagement et valider un concept" />
            </div>
          </div>
        </div>

        <div class="card inner-card gfull">
          <div class="card-head">
            <h3>2. Calendrier</h3>
            <p>Dates obligatoires pour la simulation</p>
          </div>

          <div class="grid g2">
            <div class="field">
              <label>Date de début <span class="hint">obligatoire</span></label>
              <input class="in" name="start_date" [(ngModel)]="form.start_date" type="date" required />
            </div>
            <div class="field">
              <label>Date de fin <span class="hint">obligatoire</span></label>
              <input class="in" name="end_date" [(ngModel)]="form.end_date" type="date" required />
            </div>
          </div>
          <p class="tiny muted">Le jumeau a besoin d'une fenêtre temporelle complète pour simuler les participants, la logistique et les coûts.</p>
        </div>

        <div class="card inner-card gfull">
          <div class="card-head">
            <h3>3. Participants et capacité</h3>
            <p>Hypothèses de présence avant import détaillé des participants</p>
          </div>

          <div class="grid g2">
            <div class="field">
              <label>Participants cibles</label>
              <input class="in" name="participant_target" [(ngModel)]="form.participant_target" type="number" min="0" />
            </div>
            <div class="field">
              <label>Participants attendus</label>
              <input class="in" name="participant_expected" [(ngModel)]="form.participant_expected" type="number" min="0" />
            </div>
            <div class="field gfull">
              <div class="event-readout">
                <div>
                  <span>Taux de remplissage</span>
                  <b>{{ participantFillRateLabel }}</b>
                </div>
                <div>
                  <span>Capacité bus (si mobile)</span>
                  <b>{{ transportCapacityLabel }}</b>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card inner-card gfull">
          <div class="card-head">
            <h3>4. Budget global et cadrage</h3>
            <p>Un seul montant pour l'ensemble du budget, avec la répartition détaillée à travailler plus tard</p>
          </div>

          <div class="grid g2">
            <div class="field">
              <label>Budget total</label>
              <input class="in" name="target_budget" [(ngModel)]="form.target_budget" type="number" step="0.01" min="0" required />
            </div>
            <div class="field">
              <label>Audience</label>
              <select class="in" name="audience_type" [(ngModel)]="form.audience_type">
                <option *ngFor="let item of audienceTypes" [value]="item.value">{{ item.label }}</option>
              </select>
            </div>
            <div class="field">
              <label>Niveau de mobilité</label>
              <select class="in" name="mobility_level" [(ngModel)]="form.mobility_level">
                <option *ngFor="let item of mobilityLevels" [value]="item.value">{{ item.label }}</option>
              </select>
            </div>
            <div class="field">
              <label>Accessibilité</label>
              <select class="in" name="accessibility_level" [(ngModel)]="form.accessibility_level">
                <option *ngFor="let item of accessibilityLevels" [value]="item.value">{{ item.label }}</option>
              </select>
            </div>
            <div class="field gfull">
              <label>Lecture rapide</label>
              <div class="event-readout">
                <div>
                  <span>Durée</span>
                  <b>{{ eventDurationLabel }}</b>
                </div>
                <div>
                  <span>Budget total</span>
                  <b>{{ budgetLabel }}</b>
                </div>
                <div>
                  <span>Prêt simulation</span>
                  <b [class.gain]="formReadiness.dateOrderValid && formReadiness.hasOrganization && formReadiness.hasName">{{ readinessLabel }}</b>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card inner-card gfull" *ngIf="showTransportPlanning">
          <div class="card-head">
            <h3>5. Transport (mobile / road trip)</h3>
            <p>Types de bus et capacité</p>
          </div>

          <div class="grid g3">
            <div class="field">
              <label>Bus standard (50 places) - nombre</label>
              <input class="in" name="bus_standard_count" [(ngModel)]="form.bus_standard_count" type="number" min="0" />
            </div>
            <div class="field">
              <label>Bus standard - capacité unitaire</label>
              <input class="in" name="bus_standard_capacity" [(ngModel)]="form.bus_standard_capacity" type="number" min="1" />
            </div>
            <div class="field">
              <label>Bus mini (30 places) - nombre</label>
              <input class="in" name="bus_mini_count" [(ngModel)]="form.bus_mini_count" type="number" min="0" />
            </div>
            <div class="field">
              <label>Bus mini - capacité unitaire</label>
              <input class="in" name="bus_mini_capacity" [(ngModel)]="form.bus_mini_capacity" type="number" min="1" />
            </div>
            <div class="field">
              <label>Bus VIP (20 places) - nombre</label>
              <input class="in" name="bus_vip_count" [(ngModel)]="form.bus_vip_count" type="number" min="0" />
            </div>
            <div class="field">
              <label>Bus VIP - capacité unitaire</label>
              <input class="in" name="bus_vip_capacity" [(ngModel)]="form.bus_vip_capacity" type="number" min="1" />
            </div>
          </div>
          <p class="tiny muted">Capacité totale calculée: {{ transportCapacityLabel }}.</p>
        </div>

        <div class="card inner-card gfull">
          <div class="card-head">
            <h3>6. Logistique spéciale</h3>
            <p>Important pour road trips, multi-sites et événements mobiles</p>
          </div>

          <div class="field">
            <label>Hébergement requis</label>
            <select class="in" name="accommodation_required" [(ngModel)]="form.accommodation_required">
              <option [ngValue]="false">Non</option>
              <option [ngValue]="true">Oui</option>
            </select>
          </div>

          <div class="field">
            <label>Route / logistics notes</label>
            <textarea class="in" name="route_or_logistics_notes" [(ngModel)]="form.route_or_logistics_notes" rows="4" placeholder="Route, stops, transport, overnight stays, weather risks..."></textarea>
          </div>
        </div>

        <div class="card inner-card gfull">
          <div class="card-head">
            <h3>7. Dépendances inter-modules</h3>
            <p>Ce qui est autonome ici vs ce qui dépend d'autres tables</p>
          </div>
          <div class="grid g2">
            <div>
              <h4>Données gérées ici (Event)</h4>
              <div class="chips-panel mt">
                <span class="chip">Type / format</span>
                <span class="chip">Dates / lieu</span>
                <span class="chip">Budget prévisionnel</span>
                <span class="chip">Transport planifié</span>
                <span class="chip">Participants cibles</span>
              </div>
            </div>
            <div>
              <h4>Dépendances autres tables</h4>
              <div class="chips-panel mt">
                <span class="chip ai">Participants réels</span>
                <span class="chip ai">Contraintes / préférences</span>
                <span class="chip ai">Budgets détaillés</span>
                <span class="chip ai">Satisfaction AI</span>
                <span class="chip ai">Scénarios simulation</span>
              </div>
            </div>
          </div>
        </div>

        <div class="acts gfull form-actions">
          <button class="btn" type="button" (click)="closeForm()">Annuler</button>
          <button class="btn btn-ai" type="submit">{{ editingEvent ? 'Enregistrer' : 'Créer' }}</button>
        </div>
      </form>
    </div>
  `
})
export class EventsComponent implements OnInit {
  @ViewChild('eventFormAnchor') eventFormAnchor?: ElementRef<HTMLDivElement>;

  events: EventItem[] = [];
  organizations: OrganizationItem[] = [];
  eventTypes = EVENT_TYPES;
  eventStatuses = EVENT_STATUSES;
  eventFormats = EVENT_FORMATS;
  audienceTypes = AUDIENCE_TYPES;
  mobilityLevels = MOBILITY_LEVELS;
  accessibilityLevels = ACCESSIBILITY_LEVELS;
  loading = false;
  loadingOrganizations = false;
  query = '';
  statusFilter = '';
  formOpen = false;
  editingEvent: EventItem | null = null;
  form: EventForm = this.emptyForm();

  constructor(
    private readonly http: HttpClient,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly context: EventContextService
  ) {}

  ngOnInit(): void {
    this.loadOrganizations();
    this.refresh(true);
  }

  openTwin(event: EventItem): void {
    this.context.select(event.id, event.name);
    this.router.navigate(['/app/home'], { queryParams: { event: event.id } });
  }

  /** Deep links from the twin home: ?edit=<id> opens the editor, ?create=1 the creation form. */
  private applyDeepLink(): void {
    const q = this.route.snapshot.queryParamMap;
    const edit = q.get('edit');
    const target = edit ? this.events.find((e) => e.id === edit) : undefined;
    if (target) {
      this.startEdit(target);
      setTimeout(() => this.eventFormAnchor?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    } else if (q.get('create') === '1') {
      this.startCreate();
    }
  }

  get filteredEvents(): EventItem[] {
    const query = this.query.trim().toLowerCase();
    return this.events.filter((event) => {
      const matchesStatus = !this.statusFilter || event.status === this.statusFilter;
      const matchesQuery = !query || [event.name, event.location, event.status, event.organization_name || event.organization]
        .join(' ')
        .toLowerCase()
        .includes(query);

      return matchesStatus && matchesQuery;
    });
  }

  get formReadiness(): EventFormStatus {
    const startDate = this.form.start_date.trim();
    const endDate = this.form.end_date.trim();

    return {
      hasOrganization: Boolean(this.form.organization),
      hasName: Boolean(this.form.name.trim()),
      hasDates: Boolean(startDate && endDate),
      dateOrderValid: Boolean(startDate && endDate && startDate <= endDate),
      hasLocation: Boolean(this.form.location.trim()),
      hasBudget: Number(this.form.target_budget) >= 0,
      hasType: Boolean(this.form.event_type),
      hasFormat: Boolean(this.form.event_format)
    };
  }

  get showTransportPlanning(): boolean {
    return this.form.event_type === 'road_trip' || this.form.event_format === 'mobile' || this.form.event_format === 'multi_site';
  }

  get eventDurationLabel(): string {
    if (!this.form.start_date || !this.form.end_date) {
      return 'à définir';
    }

    const start = new Date(this.form.start_date);
    const end = new Date(this.form.end_date);
    const dayCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);

    return `${dayCount} jour(s)`;
  }

  get budgetLabel(): string {
    const amount = Number(this.form.target_budget || 0);
    return Number.isFinite(amount) ? amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '—';
  }

  get participantFillRateLabel(): string {
    if (this.form.participant_target <= 0) {
      return 'n/a';
    }

    const rate = (this.form.participant_expected / this.form.participant_target) * 100;
    return `${Math.max(0, rate).toFixed(1)}%`;
  }

  get transportCapacity(): number {
    return (this.form.bus_standard_count * this.form.bus_standard_capacity)
      + (this.form.bus_mini_count * this.form.bus_mini_capacity)
      + (this.form.bus_vip_count * this.form.bus_vip_capacity);
  }

  get transportCapacityLabel(): string {
    return `${this.transportCapacity} places`;
  }

  get readinessLabel(): string {
    return this.formReadiness.hasOrganization && this.formReadiness.hasName && this.formReadiness.hasType && this.formReadiness.hasFormat && this.formReadiness.hasDates && this.formReadiness.dateOrderValid && this.formReadiness.hasLocation
      ? 'Oui'
      : 'Non';
  }

  refresh(applyDeepLink = false): void {
    this.loading = true;
    this.http.get<EventItem[]>('/api/events/').subscribe({
      next: (events) => {
        this.events = events;
        this.loading = false;
        if (applyDeepLink) this.applyDeepLink();
      },
      error: () => {
        this.events = [];
        this.loading = false;
      }
    });
  }

  loadOrganizations(): void {
    this.loadingOrganizations = true;
    this.http.get<OrganizationItem[]>('/api/organizations/').subscribe({
      next: (organizations) => {
        // Organisations réelles uniquement : aucune n'est inventée côté client.
        this.organizations = organizations;
        if (!this.form.organization && organizations.length) {
          this.form.organization = organizations[0].id;
        }
        this.loadingOrganizations = false;
      },
      error: () => {
        this.organizations = [];
        this.loadingOrganizations = false;
      }
    });
  }

  statusCount(status: string): number {
    return this.events.filter((event) => event.status === status).length;
  }

  clearFilters(): void {
    this.query = '';
    this.statusFilter = '';
  }

  startCreate(): void {
    this.editingEvent = null;
    this.form = this.emptyForm();
    this.form.organization = this.organizations[0]?.id || '';
    this.formOpen = true;
    setTimeout(() => {
      this.eventFormAnchor?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  startEdit(event: EventItem): void {
    this.editingEvent = event;
    this.form = {
      organization: event.organization,
      name: event.name,
      event_type: event.event_type,
      event_format: event.event_format,
      objective: event.objective,
      audience_type: event.audience_type,
      mobility_level: event.mobility_level,
      accommodation_required: event.accommodation_required,
      accessibility_level: event.accessibility_level,
      route_or_logistics_notes: event.route_or_logistics_notes,
      status: event.status,
      start_date: event.start_date || '',
      end_date: event.end_date || '',
      location: event.location,
      target_budget: event.target_budget,
      participant_target: event.participant_target,
      participant_expected: event.participant_expected,
      bus_standard_count: event.bus_standard_count,
      bus_standard_capacity: event.bus_standard_capacity,
      bus_mini_count: event.bus_mini_count,
      bus_mini_capacity: event.bus_mini_capacity,
      bus_vip_count: event.bus_vip_count,
      bus_vip_capacity: event.bus_vip_capacity
    };
    this.formOpen = true;
  }

  closeForm(): void {
    this.formOpen = false;
    this.editingEvent = null;
  }

  save(): void {
    if (!this.formReadiness.hasOrganization || !this.formReadiness.hasName || !this.formReadiness.hasType || !this.formReadiness.hasFormat || !this.formReadiness.hasDates || !this.formReadiness.dateOrderValid || !this.formReadiness.hasLocation) {
      window.alert('Complètez l organisation, le nom, le type, le format, les dates, l ordre des dates et le lieu avant de créer un événement.');
      return;
    }

    const payload = {
      ...this.form,
      start_date: this.form.start_date || null,
      end_date: this.form.end_date || null
    };

    if (this.editingEvent) {
      this.http.put<EventItem>(`/api/events/${this.editingEvent.id}/`, payload).subscribe({
        next: () => {
          this.closeForm();
          this.refresh();
        }
      });
      return;
    }

    this.http.post<EventItem>('/api/events/', payload).subscribe({
      next: (created) => {
        this.closeForm();
        this.openTwin(created);
      }
    });
  }

  remove(event: EventItem): void {
    const confirmed = window.confirm(`Delete ${event.name}?`);
    if (!confirmed) {
      return;
    }

    this.http.delete(`/api/events/${event.id}/`).subscribe({
      next: () => this.refresh()
    });
  }

  labelOf(list: { value: string; label: string }[], value: string): string {
    return list.find(item => item.value === value)?.label ?? value;
  }

  get registrationsTotal(): number {
    return this.filteredEvents.reduce((sum, e) => sum + (e.registered_count ?? 0), 0);
  }

  initials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('');
  }

  private emptyForm(): EventForm {
    return {
      organization: '',
      name: '',
      event_type: 'other',
      event_format: 'onsite',
      objective: '',
      audience_type: 'mixed',
      mobility_level: 'medium',
      accommodation_required: false,
      accessibility_level: 'standard',
      route_or_logistics_notes: '',
      status: 'draft',
      start_date: '',
      end_date: '',
      location: '',
      target_budget: '0',
      participant_target: 0,
      participant_expected: 0,
      bus_standard_count: 0,
      bus_standard_capacity: 50,
      bus_mini_count: 0,
      bus_mini_capacity: 30,
      bus_vip_count: 0,
      bus_vip_capacity: 20
    };
  }
}
