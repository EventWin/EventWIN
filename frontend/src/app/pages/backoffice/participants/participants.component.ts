import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

interface ApiParticipant {
  id: string;
  full_name: string;
  email: string;
  role: 'participant' | 'organizer';
  status: 'active' | 'invited' | 'disabled';
  created_at: string;
  preferences: { id: string; type: string; value: string; weight?: number }[];
  constraints: { id: string; type: string; value: string; is_hard: boolean }[];
}

interface ApiRegistration {
  id: string;
  event: string;
  event_name: string;
  participant: string;
  attendance_status: string;
  created_at: string;
}

interface Row extends ApiParticipant {
  registrations: ApiRegistration[];
  strict: number;
  initials: string;
}

const STATUS_LABEL: Record<string, string> = { active: 'Actif', invited: 'Invité', disabled: 'Désactivé' };
const ROLE_LABEL: Record<string, string> = { participant: 'Participant', organizer: 'Organisateur' };

/**
 * Annuaire des comptes : uniquement des données réelles (API participants +
 * inscriptions). Tous les indicateurs sont calculés à partir de ces listes.
 */
@Component({
  selector: 'app-participants',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './participants.component.html',
  styleUrls: ['./participants.component.css'],
})
export class ParticipantsComponent implements OnInit {
  loading = true;
  error = '';
  rows: Row[] = [];
  query = '';
  roleFilter: 'all' | 'participant' | 'organizer' = 'participant';
  expanded: string | null = null;

  readonly statusLabel = STATUS_LABEL;
  readonly roleLabel = ROLE_LABEL;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    forkJoin({
      participants: this.http.get<ApiParticipant[]>('/api/participants/'),
      registrations: this.http.get<ApiRegistration[]>('/api/event-participants/'),
    }).subscribe({
      next: ({ participants, registrations }) => {
        const byParticipant = new Map<string, ApiRegistration[]>();
        registrations.forEach(r => byParticipant.set(r.participant, [...(byParticipant.get(r.participant) ?? []), r]));
        this.rows = participants.map(p => ({
          ...p,
          registrations: byParticipant.get(p.id) ?? [],
          strict: p.constraints.filter(c => c.is_hard).length,
          initials: this.initialsOf(p.full_name || p.email),
        }));
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || err?.error?.detail || 'Impossible de charger les participants.';
        this.loading = false;
      },
    });
  }

  // --- Listes filtrées --------------------------------------------------------

  /** Comptes participants (hors organisateurs) : base de tous les indicateurs. */
  get participants(): Row[] {
    return this.rows.filter(r => r.role === 'participant');
  }

  get visible(): Row[] {
    const q = this.normalize(this.query);
    return this.rows
      .filter(r => this.roleFilter === 'all' || r.role === this.roleFilter)
      .filter(r => !q || this.normalize([
        r.full_name, r.email,
        ...r.constraints.map(c => `${c.type} ${c.value}`),
        ...r.preferences.map(p => `${p.type} ${p.value}`),
        ...r.registrations.map(x => x.event_name),
      ].join(' ')).includes(q))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'fr'));
  }

  count(role: 'all' | 'participant' | 'organizer'): number {
    return role === 'all' ? this.rows.length : this.rows.filter(r => r.role === role).length;
  }

  // --- Indicateurs -------------------------------------------------------------

  get newThisWeek(): number {
    const limit = Date.now() - 7 * 24 * 3600 * 1000;
    return this.participants.filter(p => new Date(p.created_at).getTime() >= limit).length;
  }

  get profiled(): number {
    return this.participants.filter(p => p.preferences.length || p.constraints.length).length;
  }

  get profiledRate(): number {
    return this.participants.length ? Math.round((this.profiled / this.participants.length) * 100) : 0;
  }

  get withStrict(): number {
    return this.participants.filter(p => p.strict > 0).length;
  }

  get registrationsTotal(): number {
    return this.participants.reduce((sum, p) => sum + p.registrations.length, 0);
  }

  get registeredPeople(): number {
    return this.participants.filter(p => p.registrations.length).length;
  }

  /** Contraintes strictes regroupées par type (combien de personnes concernées). */
  get strictByType(): { type: string; people: number; examples: string[] }[] {
    const map = new Map<string, { people: Set<string>; examples: Set<string> }>();
    for (const p of this.participants) {
      for (const c of p.constraints.filter(x => x.is_hard)) {
        const entry = map.get(c.type) ?? { people: new Set(), examples: new Set() };
        entry.people.add(p.id);
        entry.examples.add(c.value);
        map.set(c.type, entry);
      }
    }
    return [...map.entries()]
      .map(([type, v]) => ({ type, people: v.people.size, examples: [...v.examples].slice(0, 2) }))
      .sort((a, b) => b.people - a.people);
  }

  /** Préférences les plus déclarées, en part des profils renseignés. */
  get topPreferences(): { label: string; people: number; rate: number }[] {
    const map = new Map<string, Set<string>>();
    for (const p of this.participants) {
      for (const pref of p.preferences) {
        if (/^Intérêt|^Type de Profil/i.test(pref.type)) continue;
        const label = `${pref.type} · ${pref.value}`;
        map.set(label, (map.get(label) ?? new Set()).add(p.id));
      }
    }
    const base = this.profiled || 1;
    return [...map.entries()]
      .map(([label, people]) => ({ label, people: people.size, rate: Math.round((people.size / base) * 100) }))
      .filter(x => x.people > 1 || map.size <= 6)
      .sort((a, b) => b.people - a.people)
      .slice(0, 6);
  }

  /** Moyenne des intérêts notés « x/10 » dans le questionnaire. */
  get interests(): { label: string; avg: number; n: number }[] {
    const map = new Map<string, number[]>();
    for (const p of this.participants) {
      for (const pref of p.preferences) {
        const match = /^Intérêt\s+(.+)$/i.exec(pref.type);
        const score = /^(\d+(?:[.,]\d+)?)\s*\/\s*10/.exec(pref.value);
        if (match && score) {
          map.set(match[1], [...(map.get(match[1]) ?? []), parseFloat(score[1].replace(',', '.'))]);
        }
      }
    }
    return [...map.entries()]
      .map(([label, values]) => ({ label, avg: values.reduce((a, b) => a + b, 0) / values.length, n: values.length }))
      .sort((a, b) => b.avg - a.avg);
  }

  // --- Actions -------------------------------------------------------------------

  toggle(id: string): void {
    this.expanded = this.expanded === id ? null : id;
  }

  exportCsv(): void {
    const header = ['Nom', 'E-mail', 'Rôle', 'Statut', 'Contraintes', 'Préférences', 'Inscriptions', 'Créé le'];
    const lines = this.visible.map(r => [
      r.full_name, r.email, ROLE_LABEL[r.role] ?? r.role, STATUS_LABEL[r.status] ?? r.status,
      r.constraints.map(c => `${c.is_hard ? '[stricte] ' : ''}${c.type}: ${c.value}`).join(' | '),
      r.preferences.map(p => `${p.type}: ${p.value}`).join(' | '),
      r.registrations.map(x => x.event_name).join(' | '),
      new Date(r.created_at).toLocaleDateString('fr-FR'),
    ]);
    const csv = [header, ...lines]
      .map(cols => cols.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `participants-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // --- Aides ---------------------------------------------------------------------

  sortedPreferences(r: Row) {
    return [...r.preferences].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));
  }

  private initialsOf(name: string): string {
    return name.replace(/@.*/, '').split(/[\s.]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  }

  private normalize(value: string): string {
    return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
}
