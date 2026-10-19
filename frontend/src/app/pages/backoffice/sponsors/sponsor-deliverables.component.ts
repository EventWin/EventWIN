import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin, tap } from 'rxjs';
import { SponsorPageBase, SpStateComponent, todayIso } from '../../../sponsors/sponsors-ui';
import {
  ApiError, ApiSponsorDeliverable, DELIVERABLE_STATUS_LABELS, DELIVERABLE_TYPE_LABELS, DeliverableStatus, ResourceLite, ScheduleItemLite
} from '../../../sponsors/sponsors.models';

@Component({
  selector: 'app-sponsor-deliverables',
  standalone: true,
  imports: [CommonModule, FormsModule, SpStateComponent],
  template: `
    <sp-state [event]="event" [loading]="loading" [error]="error" [forbidden]="forbidden" [hasContent]="loaded" (retry)="reload()">
      @if (loaded) {
        @if (!items.length) {
          <div class="empty"><h4>Aucune contrepartie</h4><p>Elles sont créées automatiquement quand un dossier passe à « Signé ».</p></div>
        } @else {
          <section class="card" style="margin-bottom:16px">
            <div class="sp-row"><b style="flex:1">{{ delivered }}/{{ items.length }} contreparties livrées</b><span class="muted tiny">{{ progress }} %</span></div>
            <div class="sp-bar" style="margin-top:8px"><i [style.width.%]="progress"></i></div>
          </section>

          <div class="sp-toolbar">
            <select class="in" [(ngModel)]="statusFilter" aria-label="Filtrer par statut">
              <option value="">Tous les statuts</option>
              @for (k of statusKeys; track k) { <option [value]="k">{{ statusLabels[k] }}</option> }
            </select>
            <select class="in" [(ngModel)]="sponsorFilter" aria-label="Filtrer par sponsor">
              <option value="">Tous les sponsors</option>
              @for (s of sponsorNames; track s) { <option [value]="s">{{ s }}</option> }
            </select>
          </div>

          <div class="tw">
            <table>
              <thead><tr><th>Contrepartie</th><th>Type</th><th>Échéance</th><th>Statut</th><th>Planning / ressource</th><th>Asset</th><th>Actions</th></tr></thead>
              <tbody>
                @for (group of groups; track group.sponsor) {
                  <tr class="sp-group"><td colspan="7">{{ group.sponsor }}</td></tr>
                  @for (d of group.items; track d.id) {
                    <tr [class.sp-row-late]="isLate(d)">
                      <td><b>{{ d.title }}</b></td>
                      <td>{{ typeLabels[d.deliverable_type] }}</td>
                      <td>{{ d.due_date || '—' }} @if (isLate(d)) { <span class="chip risk">En retard</span> }</td>
                      <td><span class="chip" [class.gain]="d.status === 'delivered'" [class.warn]="d.status === 'at_risk'">{{ statusLabels[d.status] }}</span></td>
                      <td class="tiny">{{ linkedLabel(d) }}</td>
                      <td>@if (d.asset_url) { <a class="link" [href]="d.asset_url" target="_blank" rel="noopener noreferrer">Ouvrir</a> } @else { — }</td>
                      <td><div class="row-actions">
                        @if (d.status !== 'delivered') { <button type="button" class="sp-link" (click)="setStatus(d, 'delivered')">Marquer livré</button> }
                        @if (d.status !== 'at_risk' && d.status !== 'delivered') { <button type="button" class="sp-link" (click)="setStatus(d, 'at_risk')">À risque</button> }
                        <button type="button" class="sp-link" (click)="edit(d)">Modifier</button>
                      </div></td>
                    </tr>
                  }
                } @empty { <tr><td colspan="7" class="muted">Aucune contrepartie pour ces filtres.</td></tr> }
              </tbody>
            </table>
          </div>
        }

        @if (editing) {
          <div class="sp-overlay" (click)="editing = null"></div>
          <div class="sp-modal" role="dialog" aria-label="Modifier la contrepartie">
            <h3>{{ editing.title }}</h3>
            <p class="muted tiny">{{ editing.sponsor_name }}</p>
            @if (editError) { <div class="sp-error" role="alert"><span>{{ editError }}</span></div> }
            @for (w of editing.warnings ?? []; track $index) { <div class="sp-warn">{{ w }}</div> }
            <div class="sp-two">
              <div class="field"><label>Échéance</label><input class="in" type="date" [(ngModel)]="form.due_date" /></div>
              <div class="field"><label>Statut</label>
                <select class="in" [(ngModel)]="form.status">@for (k of statusKeys; track k) { <option [value]="k">{{ statusLabels[k] }}</option> }</select></div>
            </div>
            <div class="field"><label>Élément du planning</label>
              <select class="in" [(ngModel)]="form.schedule_item"><option [ngValue]="null">Aucun</option>
                @for (s of schedule; track s.id) { <option [ngValue]="s.id">{{ s.title }}</option> }</select></div>
            <div class="field"><label>Ressource</label>
              <select class="in" [(ngModel)]="form.resource"><option [ngValue]="null">Aucune</option>
                @for (r of resources; track r.id) { <option [ngValue]="r.id">{{ r.name }} ({{ r.resource_type }})</option> }</select></div>
            <div class="field"><label>Lien de l'asset</label><input class="in" [(ngModel)]="form.asset_url" placeholder="https://" /></div>
            <div class="form-actions">
              <button type="button" class="btn btn-sm" (click)="editing = null">Annuler</button>
              <button type="button" class="btn btn-sm btn-primary" (click)="saveEdit()">Enregistrer</button>
            </div>
          </div>
        }
      }
    </sp-state>
  `
})
export class SponsorDeliverablesComponent extends SponsorPageBase {
  items: ApiSponsorDeliverable[] = [];
  schedule: ScheduleItemLite[] = [];
  resources: ResourceLite[] = [];
  statusFilter = '';
  sponsorFilter = '';
  editing: ApiSponsorDeliverable | null = null;
  editError = '';
  form = { due_date: '' as string | null, status: 'pending' as DeliverableStatus, schedule_item: null as string | null, resource: null as string | null, asset_url: '' };
  readonly statusLabels = DELIVERABLE_STATUS_LABELS;
  readonly statusKeys = Object.keys(DELIVERABLE_STATUS_LABELS) as DeliverableStatus[];
  readonly typeLabels = DELIVERABLE_TYPE_LABELS;

  protected fetch(eventId: string): Observable<unknown> {
    return forkJoin({
      items: this.data.deliverables(eventId), schedule: this.data.scheduleItems(eventId), resources: this.data.resources(eventId)
    }).pipe(tap(({ items, schedule, resources }) => { this.items = items; this.schedule = schedule; this.resources = resources; }));
  }

  get delivered(): number { return this.items.filter(d => d.status === 'delivered').length; }
  get progress(): number { return this.items.length ? Math.round((this.delivered / this.items.length) * 100) : 0; }
  get sponsorNames(): string[] { return [...new Set(this.items.map(d => d.sponsor_name))].sort(); }

  get groups(): { sponsor: string; items: ApiSponsorDeliverable[] }[] {
    const filtered = this.items.filter(d => (!this.statusFilter || d.status === this.statusFilter) && (!this.sponsorFilter || d.sponsor_name === this.sponsorFilter));
    const map = new Map<string, ApiSponsorDeliverable[]>();
    for (const d of filtered) map.set(d.sponsor_name, [...(map.get(d.sponsor_name) ?? []), d]);
    return [...map.entries()].map(([sponsor, items]) => ({ sponsor, items }));
  }

  isLate(d: ApiSponsorDeliverable): boolean { return d.status !== 'delivered' && !!d.due_date && d.due_date < todayIso(); }

  linkedLabel(d: ApiSponsorDeliverable): string {
    const parts = [
      this.schedule.find(s => s.id === d.schedule_item)?.title,
      this.resources.find(r => r.id === d.resource)?.name
    ].filter(Boolean);
    return parts.join(' · ') || '—';
  }

  setStatus(d: ApiSponsorDeliverable, status: DeliverableStatus): void {
    const body: Partial<ApiSponsorDeliverable> = { status, delivered_at: status === 'delivered' ? todayIso() : null };
    this.run(this.data.updateDeliverable(d.id, body));
  }

  edit(d: ApiSponsorDeliverable): void {
    this.editing = d;
    this.editError = '';
    this.form = { due_date: d.due_date, status: d.status, schedule_item: d.schedule_item, resource: d.resource, asset_url: d.asset_url };
  }

  saveEdit(): void {
    if (!this.editing) return;
    const body: Partial<ApiSponsorDeliverable> = {
      due_date: this.form.due_date || null, status: this.form.status, schedule_item: this.form.schedule_item,
      resource: this.form.resource, asset_url: this.form.asset_url.trim(),
      delivered_at: this.form.status === 'delivered' ? (this.editing.delivered_at ?? todayIso()) : null
    };
    this.data.updateDeliverable(this.editing.id, body).subscribe({
      next: () => { this.editing = null; this.state.refresh(); },
      error: (e: ApiError) => { this.editError = e.message; }
    });
  }
}
