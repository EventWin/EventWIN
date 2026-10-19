import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../../services/auth.service';

type EventItem = {
  id: string;
  name: string;
  organization_name?: string;
  event_type: string;
  event_format: string;
  objective: string;
  audience_type: string;
  accommodation_required: boolean;
  accessibility_level: string;
  status: string;
  capacity: number;
  has_capacity_limit: boolean;
  registered_count: number;
  start_date: string | null;
  end_date: string | null;
  location: string;
};

type Registration = {
  id: string;
  event: string;
  attendance_status: string;
  created_at: string;
};

type Tab = 'available' | 'mine' | 'past';
type SortKey = 'date' | 'spots' | 'name';

/** Disponibilité affichée d'un événement, du point de vue du participant. */
type Availability = 'registered' | 'open' | 'last_spots' | 'full' | 'past' | 'closed';

type Toast = { kind: 'gain' | 'risk'; text: string };

const TYPE_META: Record<string, { label: string; tone: string; icon: string }> = {
  conference: { label: 'Conférence', tone: 'violet', icon: 'M4 5h16v10H4zM12 15v4M8 19h8' },
  workshop: { label: 'Atelier', tone: 'amber', icon: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z' },
  road_trip: { label: 'Road trip', tone: 'teal', icon: 'M3 17h18M5 17l2-6h10l2 6M7.5 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z' },
  retreat: { label: 'Séminaire', tone: 'green', icon: 'M3 20l6-11 4 7 3-4 5 8zM16 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
  gala: { label: 'Gala', tone: 'rose', icon: 'M8 3h8l-1 7a3 3 0 0 1-6 0zM12 13v6M8 21h8' },
  product_launch: { label: 'Lancement', tone: 'blue', icon: 'M12 2c3 3 4 7 3 11l-3 3-3-3c-1-4 0-8 3-11zM9 16l-3 4M15 16l3 4' },
  internal_meeting: { label: 'Réunion', tone: 'slate', icon: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5' },
  other: { label: 'Événement', tone: 'violet', icon: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4' },
};

const FORMAT_LABELS: Record<string, string> = {
  onsite: 'Sur site',
  hybrid: 'Hybride',
  remote: 'À distance',
  mobile: 'Itinérant',
  multi_site: 'Multi-sites',
};

const AUDIENCE_LABELS: Record<string, string> = {
  internal: 'Interne',
  external: 'Externe',
  mixed: 'Mixte',
};

const ACCESSIBILITY_LABELS: Record<string, string> = {
  standard: 'Standard',
  enhanced: 'Renforcée',
  strict: 'Stricte',
};

/**
 * Espace « Événements » du participant : découverte des événements ouverts,
 * inscription / désinscription, suivi de ses rendez-vous.
 *
 * Les contrôles affichés (complet, terminé, déjà inscrit) ne sont qu'un
 * confort : le serveur revérifie publication, capacité, dates et doublons.
 */
@Component({
  selector: 'app-participant-events',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './participant-events.component.html',
  styleUrls: ['./participant-events.component.css'],
})
export class ParticipantEventsComponent implements OnInit, OnDestroy {
  events: EventItem[] = [];
  /** Inscriptions du participant, indexées par identifiant d'événement. */
  registrations = new Map<string, Registration>();

  loading = true;
  loadError = false;
  tab: Tab = 'available';
  query = '';
  typeFilter = '';
  sort: SortKey = 'date';

  selected: EventItem | null = null;
  busyId: string | null = null;
  confirmLeave = false;
  justJoinedId: string | null = null;
  toast: Toast | null = null;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly http: HttpClient, private readonly auth: AuthService) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    clearTimeout(this.toastTimer);
    document.body.classList.remove('pe-lock');
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.selected) this.close();
  }

  load(): void {
    this.loading = true;
    this.loadError = false;
    forkJoin({
      events: this.http.get<EventItem[]>('/api/events/'),
      registrations: this.http.get<Registration[]>('/api/event-participants/'),
    }).subscribe({
      next: ({ events, registrations }) => {
        this.events = events;
        this.registrations = new Map(registrations.map((r) => [r.event, r]));
        this.loading = false;
        // Ouvre directement « Mes inscriptions » si rien n'est à découvrir.
        if (!this.countFor('available') && this.countFor('mine')) this.tab = 'mine';
      },
      error: () => {
        this.loading = false;
        this.loadError = true;
      },
    });
  }

  // --- Lecture -------------------------------------------------------------

  get firstName(): string {
    return (this.auth.fullName || '').split(' ')[0] || '';
  }

  get visibleEvents(): EventItem[] {
    const query = this.query.trim().toLowerCase();
    const list = this.events.filter((e) => {
      if (!this.inTab(e, this.tab)) return false;
      if (this.typeFilter && e.event_type !== this.typeFilter) return false;
      if (!query) return true;
      return [e.name, e.location, e.objective, e.organization_name, this.typeLabel(e.event_type)]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
    return list.sort((a, b) => this.compare(a, b));
  }

  /** Types réellement présents dans l'onglet courant (puces de filtre). */
  get typeOptions(): { value: string; label: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const e of this.events) {
      if (this.inTab(e, this.tab)) counts.set(e.event_type, (counts.get(e.event_type) || 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ value, label: this.typeLabel(value), count }));
  }

  /** Prochain événement auquel le participant est inscrit. */
  get nextEvent(): EventItem | null {
    return this.events
      .filter((e) => this.isRegistered(e) && !this.isPast(e) && e.status !== 'cancelled')
      .sort((a, b) => this.dateValue(a) - this.dateValue(b))[0] || null;
  }

  get upcomingRegisteredCount(): number {
    return this.events.filter((e) => this.isRegistered(e) && !this.isPast(e)).length;
  }

  countFor(tab: Tab): number {
    return this.events.filter((e) => this.inTab(e, tab)).length;
  }

  private inTab(e: EventItem, tab: Tab): boolean {
    if (tab === 'mine') return this.isRegistered(e) && !this.isPast(e);
    if (tab === 'past') return this.isPast(e);
    return e.status === 'published' && !this.isPast(e) && !this.isRegistered(e);
  }

  private compare(a: EventItem, b: EventItem): number {
    if (this.sort === 'name') return a.name.localeCompare(b.name, 'fr');
    if (this.sort === 'spots') return this.spotsSortValue(b) - this.spotsSortValue(a);
    const diff = this.dateValue(a) - this.dateValue(b);
    return this.tab === 'past' ? -diff : diff;
  }

  private spotsSortValue(e: EventItem): number {
    return e.has_capacity_limit ? this.spotsLeft(e) : Number.MAX_SAFE_INTEGER;
  }

  isRegistered(e: EventItem): boolean {
    return this.registrations.has(e.id);
  }

  isPast(e: EventItem): boolean {
    const last = this.parseDate(e.end_date || e.start_date);
    return !!last && last.getTime() < this.today().getTime();
  }

  spotsLeft(e: EventItem): number {
    return Math.max(0, e.capacity - e.registered_count);
  }

  fillPercent(e: EventItem): number {
    if (!e.has_capacity_limit) return 0;
    return Math.min(100, Math.round((e.registered_count / e.capacity) * 100));
  }

  availability(e: EventItem): Availability {
    if (this.isRegistered(e)) return 'registered';
    if (this.isPast(e)) return 'past';
    if (e.status !== 'published') return 'closed';
    if (e.has_capacity_limit) {
      const left = this.spotsLeft(e);
      if (left === 0) return 'full';
      if (left <= Math.max(3, Math.ceil(e.capacity * 0.1))) return 'last_spots';
    }
    return 'open';
  }

  availabilityLabel(e: EventItem): string {
    switch (this.availability(e)) {
      case 'registered': return this.isPast(e) ? 'Participé' : 'Inscrit';
      case 'past': return 'Terminé';
      case 'closed': return e.status === 'cancelled' ? 'Annulé' : 'Fermé';
      case 'full': return 'Complet';
      case 'last_spots': return `Plus que ${this.spotsLeft(e)} place${this.spotsLeft(e) > 1 ? 's' : ''}`;
      default: return 'Ouvert';
    }
  }

  canJoin(e: EventItem): boolean {
    const a = this.availability(e);
    return a === 'open' || a === 'last_spots';
  }

  canLeave(e: EventItem): boolean {
    return this.isRegistered(e) && !this.isPast(e);
  }

  // --- Présentation ----------------------------------------------------------

  typeLabel(type: string): string {
    return (TYPE_META[type] || TYPE_META['other']).label;
  }

  typeTone(type: string): string {
    return (TYPE_META[type] || TYPE_META['other']).tone;
  }

  typeIcon(type: string): string {
    return (TYPE_META[type] || TYPE_META['other']).icon;
  }

  formatLabel(format: string): string {
    return FORMAT_LABELS[format] || format;
  }

  audienceLabel(value: string): string {
    return AUDIENCE_LABELS[value] || value;
  }

  accessibilityLabel(value: string): string {
    return ACCESSIBILITY_LABELS[value] || value;
  }

  dayOf(e: EventItem): string {
    const d = this.parseDate(e.start_date);
    return d ? String(d.getDate()) : '—';
  }

  monthOf(e: EventItem): string {
    const d = this.parseDate(e.start_date);
    return d ? d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') : '';
  }

  dateRange(e: EventItem): string {
    const start = this.parseDate(e.start_date);
    const end = this.parseDate(e.end_date);
    if (!start) return 'Date à confirmer';
    const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'long' };
    if (!end || end.getTime() === start.getTime()) {
      return start.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' });
    }
    return `${start.toLocaleDateString('fr-FR', opts)} → ${end.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`;
  }

  durationDays(e: EventItem): number {
    const start = this.parseDate(e.start_date);
    const end = this.parseDate(e.end_date) || start;
    if (!start || !end) return 0;
    return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  }

  daysUntil(e: EventItem): number | null {
    const start = this.parseDate(e.start_date);
    if (!start) return null;
    return Math.round((start.getTime() - this.today().getTime()) / 86400000);
  }

  countdownLabel(e: EventItem): string {
    const days = this.daysUntil(e);
    if (days === null) return 'Date à confirmer';
    if (days < 0) return this.isPast(e) ? 'Terminé' : 'En cours';
    if (days === 0) return "Aujourd'hui";
    if (days === 1) return 'Demain';
    if (days < 7) return `Dans ${days} jours`;
    if (days < 60) return `Dans ${Math.round(days / 7)} semaine${Math.round(days / 7) > 1 ? 's' : ''}`;
    return `Dans ${Math.round(days / 30)} mois`;
  }

  // --- Actions ---------------------------------------------------------------

  setTab(tab: Tab): void {
    this.tab = tab;
    this.typeFilter = '';
  }

  open(e: EventItem): void {
    this.selected = e;
    this.confirmLeave = false;
    document.body.classList.add('pe-lock');
  }

  close(): void {
    this.selected = null;
    this.confirmLeave = false;
    document.body.classList.remove('pe-lock');
  }

  join(e: EventItem, evt?: Event): void {
    evt?.stopPropagation();
    if (!this.canJoin(e) || this.busyId) return;
    this.busyId = e.id;
    this.http.post<Registration>('/api/event-participants/', { event: e.id }).subscribe({
      next: (registration) => {
        this.registrations.set(e.id, registration);
        e.registered_count += 1;
        this.busyId = null;
        this.justJoinedId = e.id;
        setTimeout(() => { if (this.justJoinedId === e.id) this.justJoinedId = null; }, 2400);
        this.notify('gain', `Inscription confirmée : ${e.name}`);
      },
      error: (err) => {
        this.busyId = null;
        // 409 « déjà inscrit » / « complet » : on resynchronise avec le serveur.
        if (err?.status === 409) this.load();
        this.notify('risk', err?.error?.error || "L'inscription a échoué. Réessayez.");
      },
    });
  }

  leave(e: EventItem): void {
    const registration = this.registrations.get(e.id);
    if (!registration || this.busyId) return;
    this.busyId = e.id;
    this.http.delete(`/api/event-participants/${registration.id}/`).subscribe({
      next: () => {
        this.registrations.delete(e.id);
        e.registered_count = Math.max(0, e.registered_count - 1);
        this.busyId = null;
        this.confirmLeave = false;
        this.notify('gain', `Vous êtes désinscrit de ${e.name}`);
      },
      error: (err) => {
        this.busyId = null;
        this.notify('risk', err?.error?.error || err?.error?.detail || 'La désinscription a échoué.');
      },
    });
  }

  private notify(kind: Toast['kind'], text: string): void {
    this.toast = { kind, text };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), 3800);
  }

  trackById(_: number, e: EventItem): string {
    return e.id;
  }

  // --- Dates -----------------------------------------------------------------

  /** ``YYYY-MM-DD`` lu en date locale (``new Date(str)`` le lirait en UTC). */
  private parseDate(value: string | null): Date | null {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    return y && m && d ? new Date(y, m - 1, d) : null;
  }

  private today(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private dateValue(e: EventItem): number {
    return this.parseDate(e.start_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  }
}
