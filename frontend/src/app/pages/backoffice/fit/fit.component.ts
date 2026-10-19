import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';

/**
 * Adéquation participants × événements évaluée par Gemini.
 *
 * Le serveur fait un appel IA par participant (tous les événements comparés
 * dans le même appel) et calcule lui-même les scores : cette page se contente
 * d'afficher la matrice et, pour un participant, ce qui change d'un événement
 * à l'autre. Les participants sont analysés un par un (3 en parallèle) pour
 * que la matrice se remplisse progressivement.
 */

interface FitOption { id: string; name: string; type: string; status: string; start_date: string | null; location: string; }
interface ParticipantOption { id: string; full_name: string; email: string; constraints_count: number; preferences_count: number; }
interface Dimension { key: string; label: string; weight: number; }
interface DimensionScore { score: number | null; note: string; }
interface EventResult {
  score: number | null; base_score: number | null; capped: boolean;
  verdict: { key: string; label: string };
  dimensions: Record<string, DimensionScore>;
  blockers: { constraint: string; reason: string }[];
  strengths: string[]; risks: string[]; adaptations: string[]; summary: string;
}
interface Differentiator {
  dimension: string; label: string; spread: number;
  best_event_id: string; best_score: number; worst_event_id: string; worst_score: number;
}
interface ParticipantFit {
  id: string; full_name: string; email: string;
  profile: {
    constraints: { type: string; value: string; strict: boolean }[];
    preferences: { type: string; value: string; weight: number }[];
  };
  registered_event_ids: string[];
  cached: boolean;
  error: { kind: string; message: string } | null;
  results?: Record<string, EventResult>;
  comparison?: string;
  best_event_id?: string | null;
  worst_event_id?: string | null;
  differentiators?: Differentiator[];
}
interface FitResponse {
  model: string; dimensions: Dimension[]; blocker_cap: number;
  events: { id: string; name: string; type: string; format: string; start_date: string | null; location: string }[];
  participants: ParticipantFit[];
}

type RowState = { status: 'pending' | 'loading' | 'done' | 'error'; data?: ParticipantFit; message?: string };

const CONCURRENCY = 3;

@Component({
  selector: 'app-fit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './fit.component.html',
  styleUrls: ['./fit.component.css'],
})
export class FitComponent implements OnInit, OnDestroy {
  eventOptions: FitOption[] = [];
  participantOptions: ParticipantOption[] = [];
  limits = { events: 8, participants: 30 };
  selectedEvents = new Set<string>();
  selectedParticipants = new Set<string>();
  refresh = false;
  loadingOptions = true;
  optionsError = '';

  // Résultat courant
  model = '';
  dimensions: Dimension[] = [];
  blockerCap = 35;
  events: FitResponse['events'] = [];
  rows: { id: string; name: string; state: RowState }[] = [];
  running = false;
  globalError = '';

  selectedRowId: string | null = null;
  focusEventId: string | null = null;

  private queue: string[] = [];
  private active = 0;
  private runEventIds: string[] = [];
  private subs: Subscription[] = [];

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.http.get<{ events: FitOption[]; participants: ParticipantOption[]; limits: any }>(
      '/api/ai/participant-fit/options/'
    ).subscribe({
      next: (res) => {
        this.eventOptions = res.events;
        this.participantOptions = res.participants;
        this.limits = res.limits ?? this.limits;
        res.events.filter(e => e.status === 'published').slice(0, 6).forEach(e => this.selectedEvents.add(e.id));
        res.participants.slice(0, this.limits.participants).forEach(p => this.selectedParticipants.add(p.id));
        this.loadingOptions = false;
      },
      error: (err) => {
        this.optionsError = err?.error?.error || 'Impossible de charger les événements et participants.';
        this.loadingOptions = false;
      },
    });
  }

  ngOnDestroy(): void {
    this.queue = [];
    this.subs.forEach(s => s.unsubscribe());
  }

  // --- Sélection ------------------------------------------------------------

  toggleEvent(id: string): void {
    if (this.selectedEvents.has(id)) this.selectedEvents.delete(id);
    else if (this.selectedEvents.size < this.limits.events) this.selectedEvents.add(id);
  }

  toggleParticipant(id: string): void {
    if (this.selectedParticipants.has(id)) this.selectedParticipants.delete(id);
    else if (this.selectedParticipants.size < this.limits.participants) this.selectedParticipants.add(id);
  }

  selectAllParticipants(all: boolean): void {
    this.selectedParticipants.clear();
    if (all) this.participantOptions.slice(0, this.limits.participants).forEach(p => this.selectedParticipants.add(p.id));
  }

  get canRun(): boolean {
    return !this.running && this.selectedEvents.size > 0 && this.selectedParticipants.size > 0;
  }

  // --- Analyse --------------------------------------------------------------

  run(): void {
    if (!this.canRun) return;
    this.globalError = '';
    this.selectedRowId = null;
    this.focusEventId = null;
    // Ordre des colonnes = ordre chronologique des options.
    this.runEventIds = this.eventOptions.filter(e => this.selectedEvents.has(e.id)).map(e => e.id);
    this.events = this.eventOptions
      .filter(e => this.selectedEvents.has(e.id))
      .map(e => ({ id: e.id, name: e.name, type: e.type, format: '', start_date: e.start_date, location: e.location }));
    this.rows = this.participantOptions
      .filter(p => this.selectedParticipants.has(p.id))
      .map(p => ({ id: p.id, name: p.full_name, state: { status: 'pending' } as RowState }));
    this.queue = this.rows.map(r => r.id);
    this.running = true;
    this.pump();
  }

  retry(rowId: string): void {
    const row = this.rows.find(r => r.id === rowId);
    if (!row) return;
    row.state = { status: 'pending' };
    this.queue.push(rowId);
    this.running = true;
    this.pump();
  }

  private pump(): void {
    while (this.active < CONCURRENCY && this.queue.length) {
      const id = this.queue.shift()!;
      this.fetchRow(id);
    }
    if (!this.active && !this.queue.length) this.running = false;
  }

  private fetchRow(id: string): void {
    const row = this.rows.find(r => r.id === id);
    if (!row) return;
    row.state = { status: 'loading' };
    this.active++;
    const sub = this.http.post<FitResponse>('/api/ai/participant-fit/', {
      event_ids: this.runEventIds,
      participant_ids: [id],
      refresh: this.refresh,
    }).subscribe({
      next: (res) => {
        this.model = res.model;
        this.dimensions = res.dimensions;
        this.blockerCap = res.blocker_cap;
        // Le serveur renvoie les détails (format…) : on les reprend.
        if (res.events?.length) {
          const byId = new Map(res.events.map(e => [e.id, e]));
          this.events = this.runEventIds.map(eid => byId.get(eid)!).filter(Boolean);
        }
        const data = res.participants[0];
        row.state = data.error
          ? { status: 'error', data, message: data.error.message }
          : { status: 'done', data };
        if (!this.selectedRowId && !data.error) this.selectedRowId = id;
        this.finish();
      },
      error: (err) => {
        const message = err?.error?.error || 'Erreur réseau pendant l’analyse.';
        row.state = { status: 'error', message };
        if (err?.status === 503) {
          // IA indisponible : inutile d'enchaîner les autres appels.
          this.globalError = message;
          this.queue.forEach(qid => {
            const r = this.rows.find(x => x.id === qid);
            if (r) r.state = { status: 'error', message };
          });
          this.queue = [];
        }
        this.finish();
      },
    });
    this.subs.push(sub);
  }

  private finish(): void {
    this.active--;
    this.pump();
  }

  // --- Lecture des résultats ---------------------------------------------------

  get doneCount(): number {
    return this.rows.filter(r => r.state.status === 'done' || r.state.status === 'error').length;
  }

  get selectedRow(): ParticipantFit | null {
    const row = this.rows.find(r => r.id === this.selectedRowId);
    return row?.state.data && !row.state.data.error ? row.state.data : null;
  }

  result(row: { state: RowState }, eventId: string): EventResult | null {
    return row.state.data?.results?.[eventId] ?? null;
  }

  isRegistered(row: { state: RowState }, eventId: string): boolean {
    return !!row.state.data?.registered_event_ids?.includes(eventId);
  }

  openCell(rowId: string, eventId: string | null = null): void {
    const row = this.rows.find(r => r.id === rowId);
    if (row?.state.status !== 'done') return;
    this.selectedRowId = rowId;
    this.focusEventId = eventId;
    setTimeout(() => document.getElementById('fit-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  eventName(id: string | null | undefined): string {
    return this.events.find(e => e.id === id)?.name ?? '—';
  }

  /** Moyenne et nombre de blocages par événement, sur les lignes analysées. */
  eventStats(eventId: string): { avg: number | null; blockers: number; best: number } {
    const done = this.rows.filter(r => r.state.status === 'done');
    const scores = done.map(r => this.result(r, eventId)?.score).filter((s): s is number => s != null);
    return {
      avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      blockers: done.filter(r => (this.result(r, eventId)?.blockers.length ?? 0) > 0).length,
      best: done.filter(r => r.state.data?.best_event_id === eventId).length,
    };
  }

  scoreClass(score: number | null | undefined): string {
    if (score == null) return 's-none';
    if (score >= 75) return 's-excellent';
    if (score >= 55) return 's-good';
    if (score > this.blockerCap) return 's-partial';
    return 's-poor';
  }

  isDifferentiator(p: ParticipantFit, key: string): Differentiator | undefined {
    return p.differentiators?.find(d => d.dimension === key);
  }

  initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  topPreferences(p: ParticipantFit) {
    return [...p.profile.preferences].sort((a, b) => b.weight - a.weight).slice(0, 6);
  }

  shortDate(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
