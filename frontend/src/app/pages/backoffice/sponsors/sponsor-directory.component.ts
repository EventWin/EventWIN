import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin, tap } from 'rxjs';
import { SponsorPageBase, SpStateComponent, currentParticipantId, currentRole } from '../../../sponsors/sponsors-ui';
import {
  ApiError, ApiSponsor, ApiSponsorFit, ApiSponsorshipDeal, INDUSTRY_LABELS, ImportReport, Industry,
  RELATIONSHIP_LABELS, RelationshipStatus, initials
} from '../../../sponsors/sponsors.models';

@Component({
  selector: 'app-sponsor-directory',
  standalone: true,
  imports: [CommonModule, FormsModule, SpStateComponent],
  template: `
    <sp-state [event]="event" [loading]="loading" [error]="error" [forbidden]="forbidden" [hasContent]="loaded" (retry)="reload()">
      @if (loaded) {
        @if (!sponsors.length) {
          <div class="empty"><h4>Créez votre premier sponsor</h4>
            <p>Ajoutez vos contacts à la main ou importez-les depuis un fichier CSV.</p>
            <div class="row-actions" style="justify-content:center">
              <button type="button" class="btn btn-sm btn-primary" (click)="state.openSponsorForm()">Nouveau sponsor</button>
              <button type="button" class="btn btn-sm" (click)="openImport()">Importer un CSV</button>
            </div></div>
        } @else {
          <div class="sp-toolbar">
            <input class="in sp-search" type="search" placeholder="Rechercher…" [(ngModel)]="search" aria-label="Rechercher un sponsor" />
            <select class="in" [(ngModel)]="industryFilter" aria-label="Filtrer par secteur">
              <option value="">Tous les secteurs</option>
              @for (k of industryKeys; track k) { <option [value]="k">{{ industries[k] }}</option> }
            </select>
            <select class="in" [(ngModel)]="relFilter" aria-label="Filtrer par statut">
              <option value="">Tous les statuts</option>
              @for (k of relKeys; track k) { <option [value]="k">{{ relLabels[k] }}</option> }
            </select>
            <span class="spacer"></span>
            <button type="button" class="btn btn-sm" (click)="evaluate(null)" [disabled]="evaluating">{{ evaluating ? 'Évaluation…' : 'Évaluer la pertinence' }}</button>
            <button type="button" class="btn btn-sm" (click)="openImport()">Importer CSV</button>
            <button type="button" class="btn btn-sm btn-primary" (click)="state.openSponsorForm()">Nouveau sponsor</button>
          </div>

          <div class="tw">
            <table>
              <thead><tr><th>Sponsor</th><th>Secteur</th><th>Contact</th><th>Relation</th><th>Créé par</th><th>Deals</th><th>Pertinence</th><th>Actions</th></tr></thead>
              <tbody>
                @for (s of filtered; track s.id) {
                  <tr>
                    <td><div class="sp-who"><div class="sp-avatar">@if (s.logo_url) { <img [src]="s.logo_url" alt="" /> } @else { {{ ini(s.name) }} }</div>
                      <div><b>{{ s.name }}</b><small>{{ s.country }}</small></div></div></td>
                    <td><span class="chip">{{ industries[s.industry] }}</span></td>
                    <td>{{ s.contact_name }}<small style="display:block">{{ s.contact_email }}</small></td>
                    <td><span class="chip" [class.gain]="s.relationship_status === 'active'">{{ relLabels[s.relationship_status] }}</span></td>
                    <td>{{ s.created_by_name || '—' }}</td>
                    <td>{{ dealCount(s.id) }}</td>
                    <td>@if (scoreOf(s.id) !== null) { <div class="sp-bar" style="min-width:70px" [attr.title]="scoreOf(s.id) + ' / 100'"><i [style.width.%]="scoreOf(s.id)"></i></div> } @else { <span class="muted tiny">—</span> }</td>
                    <td><div class="row-actions">
                      <button type="button" class="sp-link" (click)="state.openSponsorForm(s)">Modifier</button>
                      <button type="button" class="sp-link" (click)="evaluate(s)">Évaluer</button>
                      <button type="button" class="sp-link" [disabled]="dealCount(s.id) > 0" (click)="addToPipeline(s)">{{ dealCount(s.id) > 0 ? 'Dans le pipeline' : 'Ajouter au pipeline' }}</button>
                      @if (canDelete(s)) { <button type="button" class="sp-link" style="color:var(--risk)" (click)="remove(s)">Supprimer</button> }
                    </div></td>
                  </tr>
                } @empty { <tr><td colspan="8" class="muted">Aucun sponsor ne correspond à ces filtres.</td></tr> }
              </tbody>
            </table>
          </div>
        }

        @if (importOpen) {
          <div class="sp-overlay" (click)="importOpen = false"></div>
          <div class="sp-modal" role="dialog" aria-label="Importer des sponsors">
            <h3>Importer des sponsors (CSV)</h3>
            <p class="muted tiny">Colonnes : name, industry, contact_name, contact_email, website, country. Les doublons sont ignorés.</p>
            <div class="field"><input type="file" accept=".csv,text/csv" (change)="onFile($event)" aria-label="Fichier CSV" /></div>
            @if (preview.length) {
              <div class="tw"><table><tbody>@for (line of preview; track $index) { <tr><td>{{ line }}</td></tr> }</tbody></table></div>
              <p class="muted tiny">Aperçu des {{ preview.length }} premières lignes.</p>
            }
            @if (importError) { <div class="sp-error" role="alert"><span>{{ importError }}</span></div> }
            @if (report) {
              <div class="sp-ok">{{ report.created }} créé(s) · {{ report.skipped }} ignoré(s) · {{ report.errors.length }} erreur(s)</div>
              @if (report.errors.length) { <ul class="tiny">@for (e of report.errors; track $index) { <li>Ligne {{ e.line }} : {{ e.message }}</li> }</ul> }
              @if (report.skipped_details.length) { <ul class="tiny">@for (e of report.skipped_details; track $index) { <li>Ligne {{ e.line }} ({{ e.name }}) : {{ e.reason }}</li> }</ul> }
            }
            <div class="form-actions">
              <button type="button" class="btn btn-sm" (click)="importOpen = false">Fermer</button>
              <button type="button" class="btn btn-sm btn-primary" [disabled]="!file || importing" (click)="doImport()">{{ importing ? 'Import…' : 'Importer' }}</button>
            </div>
          </div>
        }

        @if (fits) {
          <div class="sp-overlay" (click)="fits = null"></div>
          <aside class="sp-drawer" role="dialog" aria-label="Pertinence des sponsors">
            <div class="sp-drawer-head"><h3>Pertinence pour « {{ event?.name }} »</h3><button type="button" class="btn btn-sm" (click)="fits = null" aria-label="Fermer">✕</button></div>
            @for (f of fits; track f.evaluation_id) {
              <section class="card" style="margin-bottom:14px">
                <div class="sp-row"><b style="flex:1">{{ f.sponsor_name }}</b><span class="sp-score">{{ f.fit_score }}/100</span></div>
                <p class="muted tiny">{{ f.explanation }}</p>
                @for (c of f.breakdown; track c.key) {
                  <div class="sp-crit"><span>{{ c.label }}<br /><small>poids {{ (c.weight * 100).toFixed(0) }} %</small></span>
                    <div class="sp-bar"><i [style.width.%]="c.score"></i></div><b>{{ c.score }}</b><small>{{ c.detail }}</small></div>
                }
                @for (h of f.hard_constraint_failures; track h.code) { <div class="sp-warn">{{ h.message }}</div> }
              </section>
            } @empty { <div class="empty"><h4>Aucun résultat</h4></div> }
          </aside>
        }
      }
    </sp-state>
  `
})
export class SponsorDirectoryComponent extends SponsorPageBase {
  sponsors: ApiSponsor[] = [];
  deals: ApiSponsorshipDeal[] = [];
  scores = new Map<string, number>();
  search = '';
  industryFilter = '';
  relFilter = '';
  evaluating = false;
  fits: ApiSponsorFit[] | null = null;
  importOpen = false;
  file: File | null = null;
  preview: string[] = [];
  report: ImportReport | null = null;
  importError = '';
  importing = false;

  readonly industries = INDUSTRY_LABELS;
  readonly industryKeys = Object.keys(INDUSTRY_LABELS) as Industry[];
  readonly relLabels = RELATIONSHIP_LABELS;
  readonly relKeys = Object.keys(RELATIONSHIP_LABELS) as RelationshipStatus[];

  protected fetch(eventId: string): Observable<unknown> {
    return forkJoin({ sponsors: this.data.sponsors(), deals: this.data.deals(eventId), fits: this.data.fitEvaluations(eventId) }).pipe(
      tap(({ sponsors, deals, fits }) => {
        this.sponsors = sponsors;
        this.deals = deals;
        this.scores = new Map();
        for (const f of fits) { if (!this.scores.has(f.sponsor)) this.scores.set(f.sponsor, f.fit_score); } // le plus récent d'abord
      })
    );
  }

  get filtered(): ApiSponsor[] {
    const term = this.search.trim().toLowerCase();
    return this.sponsors.filter(s =>
      (!term || `${s.name} ${s.contact_name} ${s.contact_email}`.toLowerCase().includes(term)) &&
      (!this.industryFilter || s.industry === this.industryFilter) &&
      (!this.relFilter || s.relationship_status === this.relFilter));
  }

  ini(name: string): string { return initials(name); }
  dealCount(id: string): number { return this.deals.filter(d => d.sponsor === id).length; }
  scoreOf(id: string): number | null { return this.scores.get(id) ?? null; }
  canDelete(s: ApiSponsor): boolean { return currentRole() === 'admin' || s.created_by === currentParticipantId(); }

  addToPipeline(s: ApiSponsor): void {
    if (!this.event) return;
    this.run(this.data.createDeal({ event: this.event.id, sponsor: s.id }));
  }

  remove(s: ApiSponsor): void {
    if (!confirm(`Supprimer définitivement « ${s.name} » et ses dossiers ?`)) return;
    this.run(this.data.deleteSponsor(s.id));
  }

  evaluate(s: ApiSponsor | null): void {
    if (!this.event) return;
    this.evaluating = true;
    this.error = '';
    this.data.evaluateFit(this.event.id, s ? [s.id] : undefined).subscribe({
      next: results => { this.evaluating = false; this.fits = results; this.state.refresh(); },
      error: (e: ApiError) => { this.evaluating = false; this.fail(e); }
    });
  }

  openImport(): void { this.importOpen = true; this.file = null; this.preview = []; this.report = null; this.importError = ''; }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file = input.files?.[0] ?? null;
    this.report = null;
    this.importError = '';
    this.preview = [];
    if (!this.file) return;
    const reader = new FileReader();
    reader.onload = () => { this.preview = String(reader.result ?? '').split(/\r?\n/).filter(Boolean).slice(0, 5); };
    reader.readAsText(this.file);
  }

  doImport(): void {
    if (!this.file) return;
    this.importing = true;
    this.importError = '';
    this.data.importCsv(this.file).subscribe({
      next: report => { this.importing = false; this.report = report; if (report.created) this.state.refresh(); },
      error: (e: ApiError) => { this.importing = false; this.importError = e.message; }
    });
  }
}
