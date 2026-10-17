import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, forkJoin, tap } from 'rxjs';
import { SponsorPageBase, SpStateComponent, currentParticipantId } from '../../../sponsors/sponsors-ui';
import {
  ApiSponsorshipDeal, DEAL_STATUS_LABELS, PackageRecommendation, SponsorAlert, SponsorshipSummary, money
} from '../../../sponsors/sponsors.models';
import { SponsorNetBudgetCardComponent } from './sponsor-net-budget-card.component';

@Component({
  selector: 'app-sponsor-overview',
  standalone: true,
  imports: [CommonModule, RouterLink, SpStateComponent, SponsorNetBudgetCardComponent],
  template: `
    <sp-state [event]="event" [loading]="loading" [error]="error" [forbidden]="forbidden" [hasContent]="!!summary" (retry)="reload()">
      @if (summary) {
        <div class="sp-stats">
          <div class="stat"><div class="lab">Objectif de financement</div><div class="val">{{ fmt(summary.target_budget) }}</div><div class="foot">Budget cible de l'événement</div></div>
          <div class="stat lit"><div class="lab">Confirmé</div><div class="val">{{ fmt(summary.confirmed_cash) }}</div><div class="foot">{{ summary.coverage_percent }} % de couverture</div></div>
          <div class="stat"><div class="lab">Pipeline pondéré</div><div class="val">{{ fmt(summary.weighted_pipeline) }}</div><div class="foot">{{ summary.active_deals }} deal(s) actif(s)</div></div>
          <div class="stat"><div class="lab">Écart restant</div>
            <div class="val">{{ fmt(summary.funding_gap) }}</div>
            <div class="foot"><span class="chip" [class.risk]="summary.funding_gap > 0" [class.gain]="summary.funding_gap === 0">
              {{ summary.funding_gap > 0 ? 'À financer' : 'Objectif atteint' }}</span></div></div>
        </div>

        <div class="sp-cols">
          <section class="card">
            <div class="card-head"><div><h3>Couverture du budget</h3><p>Confirmé, pipeline pondéré et écart</p></div></div>
            <div class="sp-stack" role="img" [attr.aria-label]="'Confirmé ' + pct.confirmed + ' %, pondéré ' + pct.weighted + ' %, écart ' + pct.gap + ' %'">
              <i class="sp-seg-confirmed" [style.width.%]="pct.confirmed"></i>
              <i class="sp-seg-weighted" [style.width.%]="pct.weighted"></i>
              <i class="sp-seg-gap" [style.width.%]="pct.gap"></i>
            </div>
            <div class="sp-legend">
              <span class="c">Confirmé {{ fmt(summary.confirmed_cash) }}</span>
              <span class="w">Pondéré {{ fmt(summary.weighted_pipeline) }}</span>
              <span>Écart {{ fmt(summary.funding_gap) }}</span>
            </div>
          </section>

          <app-sponsor-net-budget-card />
        </div>

        <div class="sp-cols">
          <section class="card">
            <div class="card-head"><div><h3>Alertes</h3><p>Ce qui demande votre attention</p></div></div>
            @if (alerts.length) {
              <div class="sp-list">
                @for (a of alerts.slice(0, 8); track $index) {
                  <div class="sp-list-item">
                    <span class="chip" [class.risk]="a.severity === 'error'" [class.warn]="a.severity === 'warning'">{{ a.severity === 'error' ? 'Urgent' : 'À surveiller' }}</span>
                    <div class="grow">{{ a.message }}</div>
                    <a class="sp-link" [routerLink]="'/app/sponsors/' + target(a)">Voir</a>
                  </div>
                }
              </div>
              @if (alerts.length > 8) { <p class="muted tiny" style="margin-top:8px">+ {{ alerts.length - 8 }} autre(s) alerte(s)</p> }
            } @else { <div class="empty"><h4>Aucune alerte</h4><p>Paiements, contreparties et négociations sont à jour.</p></div> }
          </section>

          <section class="card">
            <div class="card-head"><div><h3>Mes dossiers</h3><p>Deals dont vous êtes responsable</p></div>
              <a class="btn btn-sm" routerLink="/app/sponsors/pipeline">Ouvrir le pipeline</a></div>
            @if (mine.length) {
              <div class="sp-list">
                @for (d of mine; track d.id) {
                  <div class="sp-list-item">
                    <div class="grow"><b>{{ d.sponsor_name }}</b><p>{{ labels[d.status] }} · échéance {{ d.next_due_date || '—' }}</p></div>
                    <span class="sp-money">{{ fmt(d.cash_amount) }}</span>
                    <button type="button" class="sp-link" (click)="state.openDeal(d.id)">Ouvrir</button>
                  </div>
                }
              </div>
            } @else { <div class="empty"><h4>Aucun dossier assigné</h4><p>Les deals que vous créez vous sont assignés automatiquement.</p></div> }
          </section>
        </div>

        <section class="reco"><div class="reco-in">
          <div class="reco-head"><h3>Recommandation de packages</h3></div>
          @if (summary.funding_gap === 0) {
            <p>L'objectif de financement est atteint par les deals confirmés.</p>
          } @else if (!proposals.length) {
            <div class="reco-empty"><b>Aucun package disponible</b>Créez des packages ou libérez des places pour obtenir une recommandation.
              <br /><a class="btn btn-sm" style="margin-top:10px" routerLink="/app/sponsors/packages">Gérer les packages</a></div>
          } @else {
            <p>Pour couvrir l'écart de {{ fmt(summary.funding_gap) }} :</p>
            <p class="sp-money" style="font-size:18px">{{ describe(proposals[0]) }}</p>
            @if (!proposals[0].covers_gap) { <div class="sp-warn">Couverture partielle : il manquerait encore {{ fmt(proposals[0].shortfall) }}.</div> }
            @if (proposals.length > 1) {
              <button type="button" class="btn btn-sm" (click)="showAlternatives = !showAlternatives">
                {{ showAlternatives ? 'Masquer les alternatives' : 'Voir les alternatives' }}</button>
            }
            @if (showAlternatives) {
              <div class="sp-list" style="margin-top:12px">
                @for (p of proposals.slice(1); track $index) {
                  <div class="sp-list-item"><div class="grow">{{ describe(p) }}</div>
                    <span class="chip" [class.gain]="p.covers_gap" [class.warn]="!p.covers_gap">
                      {{ p.covers_gap ? 'Surplus ' + fmt(p.surplus) : 'Partiel' }}</span></div>
                }
              </div>
            }
          }
        </div></section>
      }
    </sp-state>
  `
})
export class SponsorOverviewComponent extends SponsorPageBase {
  summary: SponsorshipSummary | null = null;
  alerts: SponsorAlert[] = [];
  mine: ApiSponsorshipDeal[] = [];
  proposals: PackageRecommendation[] = [];
  showAlternatives = false;
  readonly labels = DEAL_STATUS_LABELS;

  get pct() {
    const s = this.summary;
    if (!s) return { confirmed: 0, weighted: 0, gap: 0 };
    const base = Math.max(s.target_budget, s.confirmed_cash + s.weighted_pipeline, 1);
    const confirmed = Math.min(100, (s.confirmed_cash / base) * 100);
    const weighted = Math.min(100 - confirmed, (s.weighted_pipeline / base) * 100);
    const gap = Math.max(0, 100 - confirmed - weighted);
    const round = (n: number) => Math.round(n * 10) / 10;
    return { confirmed: round(confirmed), weighted: round(weighted), gap: round(gap) };
  }

  protected fetch(eventId: string): Observable<unknown> {
    return forkJoin({
      summary: this.data.summary(eventId),
      recommendations: this.data.recommendations(eventId),
      mine: this.data.deals(eventId, true)
    }).pipe(tap(({ summary, recommendations, mine }) => {
      this.summary = summary.summary;
      this.alerts = summary.alerts;
      this.proposals = recommendations.proposals;
      this.mine = mine.filter(d => d.status !== 'lost' && d.status !== 'paid');
    }));
  }

  fmt(value: number | string): string { return money(value); }
  target(a: SponsorAlert): string { return a.target === 'conflicts' ? 'analysis' : a.target; }
  describe(p: PackageRecommendation): string {
    return p.items.map(i => `${i.quantity} × ${i.package_name}`).join(' + ') + ' = ' + money(p.total);
  }
  protected readonly currentParticipantId = currentParticipantId;
}
