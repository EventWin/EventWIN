import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, forkJoin } from 'rxjs';
import { SponsorsDataService } from '../../../sponsors/sponsors-data.service';
import { SponsorsStateService } from '../../../sponsors/sponsors-state.service';
import { PortalLinkComponent, currentRole } from '../../../sponsors/sponsors-ui';
import {
  ALLOWED_TRANSITIONS, ApiError, ApiSponsorshipActivity, ApiSponsorshipDeal, DEAL_STATUS_LABELS, DealReport,
  DealStatus, DELIVERABLE_STATUS_LABELS, DELIVERABLE_TYPE_LABELS, OrganizerItem, PAYMENT_STATUS_LABELS, money
} from '../../../sponsors/sponsors.models';

type Tab = 'summary' | 'deliverables' | 'payments' | 'history';

/** Panneau latéral d'un deal : résumé, contreparties, paiements, historique. */
@Component({
  selector: 'sp-deal-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, PortalLinkComponent],
  template: `
    @if (deal) {
      <div class="sp-overlay" (click)="close()"></div>
      <aside class="sp-drawer" role="dialog" aria-label="Détail du dossier sponsor">
        <div class="sp-drawer-head">
          <div class="sp-avatar">@if (deal.sponsor_logo_url) { <img [src]="deal.sponsor_logo_url" alt="" /> } @else { {{ initials(deal.sponsor_name) }} }</div>
          <h3>{{ deal.sponsor_name }}<br /><small class="muted">{{ deal.package_name || 'Sans package' }}</small></h3>
          <span class="chip" [class.gain]="deal.status === 'signed' || deal.status === 'paid'" [class.risk]="deal.status === 'lost'">
            {{ statusLabels[deal.status] }}
          </span>
          <button type="button" class="btn btn-sm" (click)="close()" aria-label="Fermer">✕</button>
        </div>

        @if (error) { <div class="sp-error" role="alert"><span>{{ error }}</span></div> }

        <div class="sp-inner-tabs">
          <button type="button" [class.active]="tab === 'summary'" (click)="tab = 'summary'">Résumé</button>
          <button type="button" [class.active]="tab === 'deliverables'" (click)="tab = 'deliverables'">Contreparties</button>
          <button type="button" [class.active]="tab === 'payments'" (click)="tab = 'payments'">Paiements</button>
          <button type="button" [class.active]="tab === 'history'" (click)="tab = 'history'">Historique</button>
        </div>

        @if (tab === 'summary') {
          <div class="sp-two">
            <div class="field"><label>Montant cash ({{ deal.currency }})</label>
              <input class="in" type="number" min="0" [(ngModel)]="cash" (change)="saveAmounts()" /></div>
            <div class="field"><label>Valeur en nature</label>
              <input class="in" type="number" min="0" [(ngModel)]="inKind" (change)="saveAmounts()" /></div>
          </div>
          <div class="field">
            <label>Probabilité : <b>{{ probability }} %</b></label>
            <input type="range" min="0" max="100" step="5" [(ngModel)]="probability" (change)="saveProbability()" style="width:100%" />
          </div>
          <div class="field"><label>Responsable du dossier</label>
            <select class="in" [ngModel]="deal.owner" (ngModelChange)="changeOwner($event)">
              @if (!deal.owner) { <option [ngValue]="null">Non assigné</option> }
              @for (o of organizers; track o.id) { <option [ngValue]="o.id">{{ o.full_name }}</option> }
            </select>
          </div>
          <div class="field"><label>Notes internes</label>
            <textarea class="in" rows="3" [(ngModel)]="notes" (blur)="saveNotes()"></textarea></div>

          @if (deal.status === 'lost' && deal.lost_reason) { <div class="sp-warn">Motif de perte : {{ deal.lost_reason }}</div> }

          @if (allowed.length) {
            <div class="field"><label>Faire avancer le dossier</label>
              <div class="row-actions">
                @for (status of allowed; track status) {
                  <button type="button" class="btn btn-sm" [class.btn-primary]="status !== 'lost'" [class.btn-danger]="status === 'lost'"
                          (click)="transition(status)">{{ statusLabels[status] }}</button>
                }
              </div>
            </div>
          }
          @if (lostMode) {
            <div class="field"><label>Motif de la perte (obligatoire)</label>
              <textarea class="in" rows="2" [(ngModel)]="lostReason"></textarea>
              <div class="form-actions">
                <button type="button" class="btn btn-sm" (click)="lostMode = false">Annuler</button>
                <button type="button" class="btn btn-sm btn-danger" [disabled]="!lostReason.trim()" (click)="confirmLost()">Marquer comme perdu</button>
              </div>
            </div>
          }
          @if (deal.status === 'signed' || deal.status === 'paid') {
            <sp-portal-link [dealId]="deal.id" [sponsorEmail]="''"></sp-portal-link>
          }
        }

        @if (tab === 'deliverables') {
          @if (report && report.deliverables.length) {
            <div class="sp-list">
              @for (d of report.deliverables; track d.title) {
                <div class="sp-list-item">
                  <div class="grow"><b>{{ d.title }}</b><p>{{ typeLabels[d.type] }} · échéance {{ d.due_date || '—' }}</p></div>
                  <span class="chip" [class.gain]="d.status === 'delivered'" [class.warn]="d.status === 'at_risk'">{{ delStatus[d.status] }}</span>
                </div>
              }
            </div>
          } @else { <div class="empty"><h4>Aucune contrepartie</h4><p>Elles sont créées automatiquement à la signature selon le package.</p></div> }
        }

        @if (tab === 'payments') {
          @if (report && report.payments.length) {
            <div class="sp-list">
              @for (p of report.payments; track p.label) {
                <div class="sp-list-item">
                  <div class="grow"><b>{{ p.label }}</b><p>Échéance {{ p.due_date || '—' }}</p></div>
                  <span class="sp-money">{{ fmt(p.amount) }}</span>
                  <span class="chip" [class.gain]="p.status === 'paid'" [class.risk]="p.status === 'overdue'">{{ payStatus[p.status] }}</span>
                </div>
              }
            </div>
          } @else { <div class="empty"><h4>Aucun paiement</h4><p>L'échéancier est créé à la signature.</p></div> }
        }

        @if (tab === 'history') {
          <div class="field">
            <div class="sp-row">
              <input class="in" placeholder="Ajouter une note interne…" [(ngModel)]="note" (keyup.enter)="addNote()" />
              <button type="button" class="btn btn-sm" [disabled]="!note.trim()" (click)="addNote()">Ajouter</button>
            </div>
          </div>
          @if (activities.length) {
            <div class="tl">
              @for (a of activities; track a.id) {
                <div class="tl-item">
                  <div class="tl-date">{{ a.created_at | date: 'dd/MM HH:mm' }}</div>
                  <div><h4>{{ a.actor_name }}</h4><p>{{ a.message || a.action }}</p></div>
                </div>
              }
            </div>
          } @else { <div class="empty"><h4>Historique vide</h4></div> }
        }
      </aside>
    }
  `
})
export class SponsorDealPanelComponent implements OnInit, OnDestroy {
  private readonly state = inject(SponsorsStateService);
  private readonly data = inject(SponsorsDataService);

  deal: ApiSponsorshipDeal | null = null;
  report: DealReport | null = null;
  activities: ApiSponsorshipActivity[] = [];
  organizers: OrganizerItem[] = [];
  tab: Tab = 'summary';
  error = '';
  lostMode = false;
  lostReason = '';
  note = '';
  notes = '';
  cash = '0';
  inKind = '0';
  probability = 0;

  readonly statusLabels = DEAL_STATUS_LABELS;
  readonly typeLabels = DELIVERABLE_TYPE_LABELS;
  readonly delStatus = DELIVERABLE_STATUS_LABELS;
  readonly payStatus = PAYMENT_STATUS_LABELS;
  private subs = new Subscription();
  private openId: string | null = null;

  get allowed(): DealStatus[] { return this.deal ? ALLOWED_TRANSITIONS[this.deal.status] : []; }

  ngOnInit(): void {
    this.subs.add(this.state.openDealId$.subscribe(id => {
      this.openId = id;
      this.tab = 'summary';
      this.error = '';
      this.lostMode = false;
      if (!id) { this.deal = null; return; }
      this.load(id);
    }));
    this.subs.add(this.state.context$.subscribe(() => { if (this.openId) this.load(this.openId); }));
  }

  ngOnDestroy(): void { this.subs.unsubscribe(); }

  initials(name: string): string { return (name || '?').split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join(''); }
  fmt(value: number | string): string { return money(value, this.deal?.currency ?? 'EUR'); }
  close(): void { this.state.openDeal(null); }

  private load(id: string): void {
    forkJoin({ deal: this.data.deal(id), report: this.data.report(id), activities: this.data.activities(id) }).subscribe({
      next: ({ deal, report, activities }) => {
        this.deal = deal;
        this.report = report;
        this.activities = activities;
        this.notes = deal.notes;
        this.cash = deal.cash_amount;
        this.inKind = deal.in_kind_value;
        this.probability = deal.probability_percent;
        this.loadOrganizers(deal);
      },
      error: (e: ApiError) => { this.error = e.message; }
    });
  }

  private loadOrganizers(deal: ApiSponsorshipDeal): void {
    if (this.organizers.length) return;
    this.data.organizers().subscribe({
      next: list => {
        const admin = currentRole() === 'admin';
        this.organizers = list.filter(o => admin || o.organization === deal.sponsor_organization);
      },
      error: () => { this.organizers = []; }
    });
  }

  private patch(body: Partial<ApiSponsorshipDeal>): void {
    if (!this.deal) return;
    this.error = '';
    this.data.updateDeal(this.deal.id, body).subscribe({
      next: () => this.state.refresh(),
      error: (e: ApiError) => { this.error = e.message; }
    });
  }

  saveAmounts(): void { this.patch({ cash_amount: String(this.cash || 0), in_kind_value: String(this.inKind || 0) }); }
  saveProbability(): void { this.patch({ probability_percent: Number(this.probability) }); }
  saveNotes(): void { if (this.deal && this.notes !== this.deal.notes) this.patch({ notes: this.notes }); }

  changeOwner(ownerId: string | null): void {
    if (!this.deal || !ownerId) return;
    this.error = '';
    this.data.assign(this.deal.id, ownerId).subscribe({
      next: () => this.state.refresh(),
      error: (e: ApiError) => { this.error = e.message; }
    });
  }

  transition(status: DealStatus): void {
    if (status === 'lost') { this.lostMode = true; return; }
    this.doTransition(status);
  }

  confirmLost(): void {
    this.doTransition('lost', this.lostReason.trim());
    this.lostMode = false;
    this.lostReason = '';
  }

  private doTransition(status: DealStatus, lostReason?: string): void {
    if (!this.deal) return;
    this.error = '';
    this.data.transition(this.deal.id, status, lostReason ? { lost_reason: lostReason } : {}).subscribe({
      next: () => this.state.refresh(),
      error: (e: ApiError) => { this.error = e.message; }
    });
  }

  addNote(): void {
    if (!this.deal || !this.note.trim()) return;
    this.data.addNote(this.deal.id, this.note.trim()).subscribe({
      next: () => { this.note = ''; this.state.refresh(); },
      error: (e: ApiError) => { this.error = e.message; }
    });
  }
}
