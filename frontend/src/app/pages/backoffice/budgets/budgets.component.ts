import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { BudgetEvent } from '../../budgets/budget.service';

type State = 'loading' | 'error' | 'ok';

/**
 * Page « Budgets & ressources » : liste de tous les événements créés.
 *
 * Tous les événements sont affichés (pas de filtrage par organisation).
 * Chaque carte ouvre le budget de l'événement correspondant.
 */
@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <h1 class="title">Budgets &amp; ressources</h1>
        <p class="lede">Estimation IA des prix, scénarios d'optimisation et suivi du budget par événement. Aucun prix n'est saisi à la main.</p>
      </div>
      <div class="acts">
        <button class="btn btn-sm" type="button" (click)="load()" [disabled]="state === 'loading'">Rafraîchir</button>
      </div>
    </div>

    <!-- Indicateur -->
    <div class="grid g4 mt" *ngIf="state === 'ok' && events.length">
      <div class="stat"><div class="lab">Événements</div><div class="val n">{{ events.length }}</div><div class="foot">au total</div></div>
      <div class="stat"><div class="lab">Budget cumulé</div><div class="val n">{{ totalBudget() | number:'1.0-0' }}<sup>€</sup></div><div class="foot">tous événements</div></div>
      <div class="stat"><div class="lab">Participants prévus</div><div class="val n">{{ totalParticipants() | number:'1.0-0' }}</div><div class="foot">cumul attendus</div></div>
      <div class="stat lit"><div class="lab"><span class="dotlive"></span> Budgets suivis</div><div class="val n">{{ events.length }}</div><div class="foot">cliquez pour ouvrir</div></div>
    </div>

    <!-- Champ de recherche -->
    <div class="card mt" *ngIf="state === 'ok' && events.length">
      <input class="in" type="search" [(ngModel)]="query" placeholder="Rechercher un événement (nom, type, lieu, organisation)…">
    </div>

    <!-- État de chargement -->
    <div class="card mt" *ngIf="state === 'loading'">
      <div class="empty"><h4>Chargement des événements…</h4><p>Récupération depuis l'API.</p></div>
    </div>

    <!-- État d'erreur -->
    <div class="card mt" *ngIf="state === 'error'">
      <div class="empty"><h4>Impossible de charger les événements</h4>
        <p>Vérifiez que le backend Django est démarré (port 8000) puis réessayez.</p>
        <button class="btn btn-sm mt" type="button" (click)="load()">Réessayer</button></div>
    </div>

    <!-- État vide -->
    <div class="card mt" *ngIf="state === 'ok' && events.length === 0">
      <div class="empty"><h4>Aucun événement pour le moment</h4>
        <p>Créez un événement pour commencer à construire son budget.</p>
        <button class="btn btn-ai btn-sm mt" routerLink="/app/events">Créer un événement</button></div>
    </div>

    <!-- Aucun résultat de recherche -->
    <div class="card mt" *ngIf="state === 'ok' && events.length > 0 && filtered.length === 0">
      <div class="empty"><h4>Aucun événement ne correspond à « {{ query }} »</h4></div>
    </div>

    <!-- Liste -->
    <div class="grid g2 mt" *ngIf="filtered.length">
      <div class="card evcard" *ngFor="let e of filtered">
        <div class="evhead">
          <div>
            <h3>{{ e.name }}</h3>
            <p class="muted">{{ e.event_type }}<span *ngIf="e.location"> · {{ e.location }}</span></p>
            <p class="muted tiny" *ngIf="e.organization_name">🏢 {{ e.organization_name }}</p>
          </div>
          <span class="chip" [class.gain]="e.status === 'confirmed'" [class.warn]="e.status === 'draft'">{{ e.status }}</span>
        </div>

        <div class="evstats">
          <div class="evstat">
            <span class="lab">Budget initial</span>
            <b class="n">{{ e.target_budget || 0 | number:'1.0-0' }} €</b>
          </div>
          <div class="evstat">
            <span class="lab">Participants</span>
            <b class="n">{{ e.participant_expected || 0 }} / {{ e.participant_target || 0 }}</b>
          </div>
        </div>

        <div class="track" *ngIf="e.participant_target" title="Participants attendus / cible">
          <i [style.width.%]="participantRate(e)"></i>
        </div>

        <div class="evacts">
          <button class="btn btn-ai btn-sm"
            [routerLink]="['/app/budgets', e.id]"
            [queryParams]="{ analyze: true }">
            Voir le budget
          </button>
          <span class="muted tiny" *ngIf="e.start_date">{{ e.start_date | date:'dd/MM/yyyy' }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .evcard{display:flex;flex-direction:column;gap:16px;transition:transform .3s var(--ease),box-shadow .3s var(--ease)}
    .evcard:hover{transform:translateY(-3px);box-shadow:var(--sh-ai)}
    .evhead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .evhead h3{font-size:18px}
    .evstats{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .evstat{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:12px;
      background:var(--sub);border:1px solid var(--line)}
    .evstat .lab{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--tx-2)}
    .evstat b{font-size:19px;font-family:var(--font-ui);color:var(--blue)}
    .evacts{display:flex;align-items:center;justify-content:space-between;gap:12px}
    @media (prefers-reduced-motion: reduce){.evcard{transition:none}.evcard:hover{transform:none}}
  `]
})
export class BudgetsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  state: State = 'loading';
  events: BudgetEvent[] = [];
  query = '';

  ngOnInit(): void {
    this.load();
  }

  get filtered(): BudgetEvent[] {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.events;
    return this.events.filter((e) =>
      [e.name, e.event_type, e.location, e.organization_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }

  load(): void {
    this.state = 'loading';
    this.http
      .get<BudgetEvent[]>('/api/events/')
      .pipe(
        map((events) => events ?? []),
        catchError(() => {
          this.state = 'error';
          return of([] as BudgetEvent[]);
        })
      )
      .subscribe((events) => {
        if (this.state === 'error') return;
        this.events = events;
        this.state = 'ok';
      });
  }

  totalBudget(): number {
    return this.events.reduce((s, e) => s + (Number(e.target_budget) || 0), 0);
  }

  totalParticipants(): number {
    return this.events.reduce((s, e) => s + (e.participant_expected || e.participant_target || 0), 0);
  }

  participantRate(e: BudgetEvent): number {
    const target = e.participant_target || 0;
    if (!target) return 0;
    return Math.min(100, Math.round(((e.participant_expected || 0) / target) * 100));
  }
}
