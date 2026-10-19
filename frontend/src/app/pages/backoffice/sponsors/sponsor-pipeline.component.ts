import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin, tap } from 'rxjs';
import { SponsorPageBase, SpStateComponent } from '../../../sponsors/sponsors-ui';
import {
  ApiError, ApiSponsorshipDeal, ApiSponsorshipPackage, DEAL_STATUS_LABELS, DealStatus, INDUSTRY_LABELS, Industry,
  PIPELINE_COLUMNS, initials, money
} from '../../../sponsors/sponsors.models';

@Component({
  selector: 'app-sponsor-pipeline',
  standalone: true,
  imports: [CommonModule, FormsModule, SpStateComponent],
  template: `
    <sp-state [event]="event" [loading]="loading" [error]="error" [forbidden]="forbidden" [hasContent]="loaded" (retry)="reload()">
      @if (loaded) {
        <div class="sp-toolbar">
          <input class="in sp-search" type="search" placeholder="Rechercher un sponsor…" [(ngModel)]="search" aria-label="Rechercher" />
          <select class="in" [(ngModel)]="packageFilter" aria-label="Filtrer par package">
            <option value="">Tous les packages</option>
            @for (p of packages; track p.id) { <option [value]="p.id">{{ p.name }}</option> }
          </select>
          <select class="in" [(ngModel)]="industryFilter" aria-label="Filtrer par secteur">
            <option value="">Tous les secteurs</option>
            @for (k of industryKeys; track k) { <option [value]="k">{{ industries[k] }}</option> }
          </select>
          <div class="pills">
            <button type="button" class="pill" [attr.aria-pressed]="mineOnly" (click)="setMine(true)">Mes deals</button>
            <button type="button" class="pill" [attr.aria-pressed]="!mineOnly" (click)="setMine(false)">Tous les deals</button>
          </div>
        </div>

        @if (!deals.length) {
          <div class="empty"><h4>Aucun dossier dans le pipeline</h4>
            <p>Créez un sponsor et ajoutez-le au pipeline pour suivre sa progression.</p>
            <button type="button" class="btn btn-sm btn-primary" (click)="state.openSponsorForm()">Nouveau sponsor</button></div>
        } @else {
          <div class="sp-board" role="list">
            @for (col of columns; track col) {
              <div class="sp-col" role="listitem" [class.over]="overCol === col"
                   (dragover)="allowDrop($event, col)" (dragleave)="overCol = null" (drop)="drop($event, col)">
                <div class="sp-col-head"><b>{{ labels[col] }}</b>
                  <span>{{ inColumn(col).length }} dossier(s) · {{ total(col) }}{{ isOpen(col) ? ' pondéré' : '' }}</span></div>
                @for (d of inColumn(col); track d.id) { <ng-container *ngTemplateOutlet="card; context: { $implicit: d }"></ng-container> }
              </div>
            }
          </div>

          <section class="sp-lost">
            <button type="button" class="sp-link" (click)="showLost = !showLost">
              {{ showLost ? 'Masquer' : 'Afficher' }} les dossiers perdus ({{ inColumn('lost').length }})</button>
            @if (showLost) {
              <div class="sp-col" style="margin-top:10px" [class.over]="overCol === 'lost'"
                   (dragover)="allowDrop($event, 'lost')" (dragleave)="overCol = null" (drop)="drop($event, 'lost')">
                @for (d of inColumn('lost'); track d.id) { <ng-container *ngTemplateOutlet="card; context: { $implicit: d }"></ng-container> }
                @if (!inColumn('lost').length) { <span class="muted tiny">Aucun dossier perdu. Glissez une carte ici pour la marquer comme perdue.</span> }
              </div>
            } @else if (dragging) {
              <div class="sp-col" style="margin-top:10px" [class.over]="overCol === 'lost'"
                   (dragover)="allowDrop($event, 'lost')" (dragleave)="overCol = null" (drop)="drop($event, 'lost')">
                <span class="muted tiny">Déposez ici pour marquer comme perdu</span></div>
            }
          </section>
        }

        <ng-template #card let-d>
          <article class="sp-card" draggable="true" [class.dragging]="dragging?.id === d.id" tabindex="0"
                   (dragstart)="dragStart($event, d)" (dragend)="dragging = null; overCol = null"
                   (click)="state.openDeal(d.id)" (keydown.enter)="state.openDeal(d.id)">
            <div class="sp-card-top">
              <div class="sp-avatar">@if (d.sponsor_logo_url) { <img [src]="d.sponsor_logo_url" alt="" /> } @else { {{ ini(d.sponsor_name) }} }</div>
              <div><h4>{{ d.sponsor_name }}</h4>@if (d.package_name) { <span class="chip">{{ d.package_name }}</span> }</div>
            </div>
            <div class="sp-card-meta"><span class="sp-money">{{ fmt(d.cash_amount) }}</span><span>{{ d.probability_percent }} %</span></div>
            <div class="sp-bar mini"><i [style.width.%]="d.probability_percent"></i></div>
            <div class="sp-card-meta">
              <span>@if (d.deliverables_total) { {{ d.deliverables_done }}/{{ d.deliverables_total }} livrées } @else { Échéance {{ d.next_due_date || '—' }} }</span>
              <span title="Responsable">{{ d.owner_name || 'Non assigné' }}</span>
            </div>
          </article>
        </ng-template>

        @if (lostFor) {
          <div class="sp-overlay" (click)="cancelLost()"></div>
          <div class="sp-modal" role="dialog" aria-label="Motif de la perte">
            <h3>Marquer « {{ lostFor.sponsor_name }} » comme perdu</h3>
            <div class="field"><label for="lost-reason">Motif (obligatoire)</label>
              <textarea id="lost-reason" class="in" rows="3" [(ngModel)]="lostReason"></textarea></div>
            <div class="form-actions">
              <button type="button" class="btn btn-sm" (click)="cancelLost()">Annuler</button>
              <button type="button" class="btn btn-sm btn-danger" [disabled]="!lostReason.trim()" (click)="confirmLost()">Confirmer</button>
            </div>
          </div>
        }
      }
    </sp-state>
  `
})
export class SponsorPipelineComponent extends SponsorPageBase {
  deals: ApiSponsorshipDeal[] = [];
  packages: ApiSponsorshipPackage[] = [];
  mineOnly = false;
  search = '';
  packageFilter = '';
  industryFilter = '';
  showLost = false;
  dragging: ApiSponsorshipDeal | null = null;
  overCol: DealStatus | null = null;
  lostFor: ApiSponsorshipDeal | null = null;
  lostReason = '';

  readonly columns = PIPELINE_COLUMNS;
  readonly labels = DEAL_STATUS_LABELS;
  readonly industries = INDUSTRY_LABELS;
  readonly industryKeys = Object.keys(INDUSTRY_LABELS) as Industry[];

  protected fetch(eventId: string): Observable<unknown> {
    return forkJoin({ deals: this.data.deals(eventId, this.mineOnly), packages: this.data.packages(eventId) }).pipe(
      tap(({ deals, packages }) => { this.deals = deals; this.packages = packages; })
    );
  }

  setMine(value: boolean): void { this.mineOnly = value; this.reload(); }
  ini(name: string): string { return initials(name); }
  fmt(value: string | number): string { return money(value); }
  isOpen(col: DealStatus): boolean { return col !== 'signed' && col !== 'paid' && col !== 'lost'; }

  inColumn(col: DealStatus): ApiSponsorshipDeal[] {
    const term = this.search.trim().toLowerCase();
    return this.deals.filter(d =>
      d.status === col &&
      (!term || d.sponsor_name.toLowerCase().includes(term)) &&
      (!this.packageFilter || d.package === this.packageFilter) &&
      (!this.industryFilter || d.sponsor_industry === this.industryFilter));
  }

  total(col: DealStatus): string {
    const sum = this.inColumn(col).reduce((acc, d) => {
      const cash = Number(d.cash_amount);
      return acc + (this.isOpen(col) ? (cash * d.probability_percent) / 100 : cash);
    }, 0);
    return money(sum);
  }

  dragStart(event: DragEvent, deal: ApiSponsorshipDeal): void {
    this.dragging = deal;
    event.dataTransfer?.setData('text/plain', deal.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  allowDrop(event: DragEvent, col: DealStatus): void {
    event.preventDefault();
    this.overCol = col;
  }

  drop(event: DragEvent, col: DealStatus): void {
    event.preventDefault();
    const deal = this.dragging;
    this.overCol = null;
    this.dragging = null;
    if (!deal || deal.status === col) return;
    if (col === 'lost') { this.lostFor = deal; this.lostReason = ''; return; }
    this.move(deal, col);
  }

  /** Mise à jour optimiste ; la carte revient à sa place si le serveur refuse la transition. */
  private move(deal: ApiSponsorshipDeal, status: DealStatus, lostReason?: string): void {
    const previous = deal.status;
    this.error = '';
    deal.status = status;
    this.data.transition(deal.id, status, lostReason ? { lost_reason: lostReason } : {}).subscribe({
      next: () => this.state.refresh(),
      error: (e: ApiError) => { deal.status = previous; this.error = e.message; }
    });
  }

  cancelLost(): void { this.lostFor = null; }
  confirmLost(): void {
    if (!this.lostFor || !this.lostReason.trim()) return;
    const deal = this.lostFor;
    this.lostFor = null;
    this.move(deal, 'lost', this.lostReason.trim());
  }
}
