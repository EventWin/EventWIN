import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Observable, forkJoin, tap } from 'rxjs';
import { PortalLinkComponent, SponsorPageBase, SpStateComponent } from '../../../sponsors/sponsors-ui';
import {
  ApiError, ApiSponsorFit, ApiSponsorshipDeal, DEAL_STATUS_LABELS, DealReport, INDUSTRY_LABELS, SponsorConflict, money
} from '../../../sponsors/sponsors.models';

@Component({
  selector: 'app-sponsor-fit',
  standalone: true,
  imports: [CommonModule, SpStateComponent, PortalLinkComponent],
  template: `
    <sp-state [event]="event" [loading]="loading" [error]="error" [forbidden]="forbidden" [hasContent]="loaded" (retry)="reload()">
      @if (loaded) {
        @if (conflicts.length) {
          <section class="sp-warn" role="alert">
            <b>Conflits détectés</b>
            <ul style="margin:6px 0 0 18px">
              @for (c of conflicts; track $index) {
                <li><span class="chip" [class.risk]="c.severity === 'error'" [class.warn]="c.severity === 'warning'">{{ c.severity === 'error' ? 'Bloquant' : 'Attention' }}</span>
                  {{ c.message }}
                  @for (id of c.deal_ids.slice(0, 3); track id) { <button type="button" class="sp-link" style="margin-left:8px" (click)="state.openDeal(id)">Dossier</button> }</li>
              }
            </ul>
          </section>
        }

        <section class="card" style="margin-bottom:16px">
          <div class="card-head"><div><h3>Pertinence des sponsors</h3><p>Score explicable : secteur, audience, budget, historique</p></div>
            <button type="button" class="btn btn-sm btn-primary" [disabled]="evaluating" (click)="evaluate()">{{ evaluating ? 'Évaluation…' : 'Évaluer les sponsors' }}</button></div>
          @if (!fits.length) {
            <div class="empty"><h4>Aucune évaluation</h4><p>Lancez l'évaluation pour classer vos sponsors selon leur pertinence pour cet événement.</p></div>
          } @else {
            <div class="sp-list">
              @for (f of fits; track f.evaluation_id) {
                <div class="sp-list-item">
                  <div class="grow"><b>{{ f.sponsor_name }}</b>
                    <div class="row-actions" style="margin-top:4px">
                      <span class="chip" [class.gain]="f.industry_match">{{ f.industry_match ? 'Secteur compatible' : 'Secteur peu adapté' }}</span>
                      <span class="chip" [class.gain]="f.budget_fit" [class.warn]="!f.budget_fit">{{ f.budget_fit ? 'Budget cohérent' : 'Budget à vérifier' }}</span>
                      <span class="chip">{{ f.audience_match_count }} participant(s) concerné(s)</span>
                    </div></div>
                  <div style="width:120px"><div class="sp-bar"><i [style.width.%]="f.fit_score"></i></div></div>
                  <span class="sp-score">{{ f.fit_score }}</span>
                  <button type="button" class="sp-link" (click)="selected = f">Pourquoi ?</button>
                </div>
              }
            </div>
          }
        </section>

        <section class="card">
          <div class="card-head"><div><h3>Rapport ROI par dossier</h3><p>Livré vs promis, paiements et exposition estimée</p></div></div>
          @if (!signed.length) {
            <div class="empty"><h4>Aucun dossier signé</h4><p>Les rapports sont disponibles dès qu'un sponsor est signé.</p></div>
          } @else {
            <div class="tw">
              <table>
                <thead><tr><th>Sponsor</th><th>Statut</th><th>Montant</th><th>Versé</th><th>Contreparties</th><th>Actions</th></tr></thead>
                <tbody>
                  @for (d of signed; track d.id) {
                    <tr>
                      <td><b>{{ d.sponsor_name }}</b><small style="display:block">{{ d.package_name }}</small></td>
                      <td><span class="chip gain">{{ statusLabels[d.status] }}</span></td>
                      <td class="sp-money">{{ fmt(d.cash_amount) }}</td>
                      <td>{{ fmt(d.paid_amount) }}</td>
                      <td style="min-width:140px">{{ d.deliverables_done }}/{{ d.deliverables_total }}
                        <div class="sp-bar mini"><i [style.width.%]="d.deliverables_total ? (d.deliverables_done / d.deliverables_total) * 100 : 0"></i></div></td>
                      <td><div class="row-actions">
                        <button type="button" class="sp-link" (click)="openReport(d)">Rapport</button>
                        <button type="button" class="sp-link" (click)="exportCsv(d)">Exporter CSV</button>
                        <sp-portal-link [dealId]="d.id" label="Lien portail"></sp-portal-link>
                      </div></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        @if (selected) {
          <div class="sp-overlay" (click)="selected = null"></div>
          <aside class="sp-drawer" role="dialog" aria-label="Explication du score">
            <div class="sp-drawer-head"><h3>{{ selected.sponsor_name }} <span class="sp-score">{{ selected.fit_score }}/100</span></h3>
              <button type="button" class="btn btn-sm" (click)="selected = null" aria-label="Fermer">✕</button></div>
            <p class="muted">{{ selected.explanation }}</p>
            @for (c of selected.breakdown; track c.key) {
              <div class="sp-crit"><span>{{ c.label }}<br /><small>poids {{ (c.weight * 100).toFixed(0) }} %</small></span>
                <div class="sp-bar"><i [style.width.%]="c.score"></i></div><b>{{ c.score }}</b><small>{{ c.detail }}</small></div>
            }
            @for (h of selected.hard_constraint_failures; track h.code) { <div class="sp-warn">{{ h.message }}</div> }
            @if (selected.estimated_roi !== null) { <p class="muted tiny">Revenu attendu pondéré : {{ fmt(selected.estimated_roi) }}</p> }
          </aside>
        }

        @if (report) {
          <div class="sp-overlay" (click)="report = null"></div>
          <aside class="sp-drawer" role="dialog" aria-label="Rapport du dossier">
            <div class="sp-drawer-head"><h3>{{ report.sponsor }}<br /><small class="muted">{{ report.package }}</small></h3>
              <button type="button" class="btn btn-sm" (click)="report = null" aria-label="Fermer">✕</button></div>
            <div class="sp-kv">
              <div><small>Montant</small><b>{{ fmt(report.cash_amount) }}</b></div>
              <div><small>Versé</small><b>{{ fmt(report.payments_paid) }} / {{ fmt(report.payments_planned) }}</b></div>
              <div><small>Contreparties livrées</small><b>{{ report.deliverables_delivered }}/{{ report.deliverables_total }}</b></div>
              <div><small>Exposition estimée</small><b>{{ report.exposure.estimated_exposure | number }} contacts</b></div>
            </div>
            <p class="muted tiny">Calcul : {{ report.exposure.participants }} participants × poids livré {{ report.exposure.delivered_weight }} × visibilité du package {{ report.exposure.visibility_weight }}.</p>
            <button type="button" class="btn btn-sm" (click)="state.openDeal(report.deal_id)">Ouvrir le dossier</button>
          </aside>
        }
      }
    </sp-state>
  `
})
export class SponsorFitComponent extends SponsorPageBase {
  conflicts: SponsorConflict[] = [];
  deals: ApiSponsorshipDeal[] = [];
  fits: ApiSponsorFit[] = [];
  evaluating = false;
  selected: ApiSponsorFit | null = null;
  report: DealReport | null = null;
  readonly statusLabels = DEAL_STATUS_LABELS;
  readonly industries = INDUSTRY_LABELS;

  get signed(): ApiSponsorshipDeal[] { return this.deals.filter(d => d.status === 'signed' || d.status === 'paid'); }

  protected fetch(eventId: string): Observable<unknown> {
    return forkJoin({ conflicts: this.data.conflicts(eventId), deals: this.data.deals(eventId) }).pipe(
      tap(({ conflicts, deals }) => { this.conflicts = conflicts; this.deals = deals; })
    );
  }

  fmt(value: number | string): string { return money(value); }

  evaluate(): void {
    if (!this.event) return;
    this.evaluating = true;
    this.error = '';
    this.data.evaluateFit(this.event.id).subscribe({
      next: list => { this.evaluating = false; this.fits = list; },
      error: (e: ApiError) => { this.evaluating = false; this.fail(e); }
    });
  }

  openReport(d: ApiSponsorshipDeal): void {
    this.data.report(d.id).subscribe({ next: r => (this.report = r), error: (e: ApiError) => this.fail(e) });
  }

  exportCsv(d: ApiSponsorshipDeal): void {
    this.data.reportCsv(d.id).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rapport-${d.sponsor_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: (e: ApiError) => this.fail(e)
    });
  }
}
