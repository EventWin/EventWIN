import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../services/auth.service';

interface DashboardEvent {
  id: string; name: string; organization_name: string; event_type: string;
  status: string; status_label: string; start_date: string | null; end_date: string | null;
  days_until: number | null; finished: boolean; location: string;
  registered: number; expected: number; capacity: number;
  budget: number | null; estimated_total: number | null; budget_status: string; usage_rate: number | null;
  priced_count: number; unpriced_count: number; items_count: number;
  fit: { average: number; count: number } | null;
  sponsoring_confirmed: number;
  sponsoring_weighted: number;
  net_cost: number | null;
  sponsor_alerts: { severity: 'error' | 'warning' | string; message: string }[];
}
interface Dashboard {
  scope: 'admin' | 'organizer';
  totals: {
    events: number; active: number; drafts: number; upcoming_30d: number; organizations: number;
    registrations: number; participants: number; expected: number;
    budget: number; estimated_total: number; over_budget: number; budget_missing: number; without_estimate: number;
    sponsoring_confirmed: number; sponsoring_weighted: number;
  };
  events: DashboardEvent[];
  activity: { kind: 'registration' | 'event' | 'fit'; at: string; title: string; detail: string; event_id: string | null }[];
}
interface Alert { level: 'risk' | 'warn' | 'info'; title: string; detail: string; eventId: string; }

/**
 * Supervision : portefeuille d'événements calculé par le serveur
 * (``/api/dashboard/``). Aucun chiffre n'est saisi en dur ici.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
})
export class HomeComponent implements OnInit {
  data: Dashboard | null = null;
  loading = true;
  error = '';
  showFinished = false;

  constructor(private http: HttpClient, private router: Router, readonly auth: AuthService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.http.get<Dashboard>('/api/dashboard/').subscribe({
      next: (data) => { this.data = data; this.loading = false; },
      error: (err) => {
        this.error = err?.error?.detail || err?.error?.error || 'Impossible de charger le tableau de bord.';
        this.loading = false;
      },
    });
  }

  get firstName(): string {
    return (this.auth.fullName || '').split(' ')[0] || '';
  }

  get greeting(): string {
    const hour = new Date().getHours();
    return hour < 5 || hour >= 18 ? 'Bonsoir' : 'Bonjour';
  }

  get events(): DashboardEvent[] {
    return (this.data?.events ?? []).filter(e => this.showFinished || !e.finished);
  }

  get finishedCount(): number {
    return (this.data?.events ?? []).filter(e => e.finished).length;
  }

  get registrationRate(): number | null {
    const t = this.data?.totals;
    return t && t.expected ? Math.round((t.registrations / t.expected) * 100) : null;
  }

  get budgetRate(): number | null {
    const t = this.data?.totals;
    return t && t.budget ? Math.round((t.estimated_total / t.budget) * 100) : null;
  }

  /** Points d'attention déduits des chiffres réels, du plus grave au moins grave. */
  get alerts(): Alert[] {
    const out: Alert[] = [];
    for (const e of (this.data?.events ?? []).filter(x => !x.finished)) {
      if (e.budget_status === 'over_budget') {
        out.push({ level: 'risk', eventId: e.id, title: `${e.name} dépasse son budget`,
          detail: `${this.money(e.estimated_total)} estimés pour ${this.money(e.budget)} prévus.` });
      }
      if (e.days_until != null && e.days_until >= 0 && e.days_until <= 30 && e.expected && e.registered < e.expected * 0.5) {
        out.push({ level: 'warn', eventId: e.id, title: `${e.name} : inscriptions en retard`,
          detail: `${e.registered} inscrit(s) sur ${e.expected} attendus, J-${e.days_until}.` });
      }
      if (e.capacity && e.registered > e.capacity) {
        out.push({ level: 'risk', eventId: e.id, title: `${e.name} : capacité dépassée`,
          detail: `${e.registered} inscrits pour ${e.capacity} places.` });
      }
      if (e.budget_status === 'budget_missing') {
        out.push({ level: 'info', eventId: e.id, title: `${e.name} : budget non défini`,
          detail: 'Renseignez un budget cible pour suivre les dépassements.' });
      } else if (!e.items_count && e.status !== 'draft') {
        out.push({ level: 'info', eventId: e.id, title: `${e.name} : aucune ressource chiffrée`,
          detail: 'Ajoutez les postes de dépense pour estimer le coût réel.' });
      }
      for (const a of e.sponsor_alerts ?? []) {
        out.push({ level: a.severity === 'error' ? 'risk' : 'warn', eventId: e.id,
          title: `${e.name} : sponsoring`, detail: a.message });
      }
      if (e.fit && e.fit.average < 50) {
        out.push({ level: 'warn', eventId: e.id, title: `${e.name} : adéquation faible`,
          detail: `Adéquation IA moyenne de ${e.fit.average}/100 sur ${e.fit.count} profil(s).` });
      }
    }
    const order = { risk: 0, warn: 1, info: 2 };
    return out.sort((a, b) => order[a.level] - order[b.level]).slice(0, 6);
  }

  openTwin(eventId: string): void {
    this.router.navigate(['/app/home'], { queryParams: { event: eventId } });
  }

  // --- Mise en forme ------------------------------------------------------------

  money(value: number | null | undefined): string {
    if (value == null) return '—';
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M€`;
    if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000).toLocaleString('fr-FR')} k€`;
    return `${Math.round(value).toLocaleString('fr-FR')} €`;
  }

  pct(part: number | null | undefined, whole: number | null | undefined): number {
    if (!part || !whole) return 0;
    return Math.min(100, Math.round((part / whole) * 100));
  }

  budgetTone(e: DashboardEvent): string {
    if (e.budget_status === 'over_budget') return 'risk';
    if ((e.usage_rate ?? 0) >= 90) return 'warn';
    return 'gain';
  }

  countdown(e: DashboardEvent): string {
    if (e.finished) return 'Terminé';
    if (e.days_until == null) return 'Date à définir';
    if (e.days_until < 0) return 'En cours';
    if (e.days_until === 0) return "Aujourd'hui";
    return `J-${e.days_until}`;
  }

  relative(iso: string): string {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "à l'instant";
    if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
    if (diff < 7 * 86400) return `il y a ${Math.floor(diff / 86400)} j`;
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
}
