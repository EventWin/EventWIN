import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { Subscription, switchMap, of, catchError } from 'rxjs';
import { SponsorsDataService } from '../../../sponsors/sponsors-data.service';
import { SponsorsStateService } from '../../../sponsors/sponsors-state.service';
import { ApiError, NetBudget, money } from '../../../sponsors/sponsors.models';

/**
 * Carte « Budget net » autonome et réutilisable (ex. par le module Budget) :
 * <app-sponsor-net-budget-card [eventId]="id" />. Sans eventId, suit l'événement sélectionné.
 */
@Component({
  selector: 'app-sponsor-net-budget-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="card">
      <div class="card-head"><div><h3>Budget net</h3><p>Coûts prévus moins financement sponsors</p></div></div>
      @if (error) { <div class="sp-error" role="alert"><span>{{ error }}</span></div> }
      @if (!id) {
        <p class="muted">Sélectionnez un événement.</p>
      } @else if (loading && !net) {
        <p class="muted">Chargement…</p>
      } @else if (net) {
        @if (!net.has_budget) { <div class="sp-warn">Aucun budget n'est défini pour cet événement : le coût prévu est à 0.</div> }
        <div class="tw">
          <table>
            <thead><tr><th>Scénario</th><th>Coût prévu</th><th>Sponsoring</th><th>Net</th></tr></thead>
            <tbody>
              <tr><td><b>Pessimiste</b><br /><small class="muted">Deals signés</small></td><td>{{ fmt(net.planned_cost) }}</td><td>{{ fmt(net.confirmed_sponsorship) }}</td><td class="sp-money">{{ fmt(net.net_pessimistic) }}</td></tr>
              <tr><td><b>Pondéré</b><br /><small class="muted">+ pipeline × probabilité</small></td><td>{{ fmt(net.planned_cost) }}</td><td>{{ fmt(net.confirmed_sponsorship + net.weighted_sponsorship) }}</td><td class="sp-money">{{ fmt(net.net_weighted) }}</td></tr>
              <tr><td><b>Optimiste</b><br /><small class="muted">Tous les deals ouverts</small></td><td>{{ fmt(net.planned_cost) }}</td><td>{{ fmt(net.best_case_sponsorship) }}</td><td class="sp-money">{{ fmt(net.net_optimistic) }}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="muted tiny" style="margin-top:10px">Un net négatif signifie que le sponsoring dépasse les coûts prévus.</p>
      }
    </section>
  `
})
export class SponsorNetBudgetCardComponent implements OnInit, OnDestroy {
  private readonly data = inject(SponsorsDataService);
  private readonly state = inject(SponsorsStateService);
  @Input() eventId?: string;

  id: string | null = null;
  net: NetBudget | null = null;
  loading = false;
  error = '';
  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.state.context$.pipe(
      switchMap(event => {
        this.id = this.eventId ?? event?.id ?? null;
        if (!this.id) { this.net = null; return of(null); }
        this.loading = true;
        this.error = '';
        return this.data.netBudget(this.id).pipe(catchError((e: ApiError) => { this.error = e.message; return of(null); }));
      })
    ).subscribe(net => { this.loading = false; if (net) this.net = net; });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  fmt(value: number): string { return money(value, this.net?.currency ?? 'EUR'); }
}
