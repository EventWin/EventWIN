import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin, tap } from 'rxjs';
import { SponsorPageBase, SpStateComponent } from '../../../sponsors/sponsors-ui';
import {
  ApiError, ApiSponsorshipDeal, ApiSponsorshipPackage, DELIVERABLE_TYPE_LABELS, DeliverableType, PackageBenefit, money
} from '../../../sponsors/sponsors.models';

type PackageForm = {
  name: string; tier_rank: number; price: string; slots_total: number; exclusive_industry: boolean;
  visibility_weight: string; description: string; active: boolean; benefits: PackageBenefit[];
};

const blank = (): PackageForm => ({
  name: '', tier_rank: 1, price: '0', slots_total: 1, exclusive_industry: false,
  visibility_weight: '1', description: '', active: true, benefits: []
});

@Component({
  selector: 'app-sponsor-packages',
  standalone: true,
  imports: [CommonModule, FormsModule, SpStateComponent],
  template: `
    <sp-state [event]="event" [loading]="loading" [error]="error" [forbidden]="forbidden" [hasContent]="loaded" (retry)="reload()">
      @if (loaded) {
        <div class="sp-toolbar"><span class="muted">{{ packages.length }} package(s)</span><span class="spacer"></span>
          <button type="button" class="btn btn-sm btn-primary" (click)="openForm(null)">Nouveau package</button></div>

        @if (!packages.length) {
          <div class="empty"><h4>Aucun package</h4><p>Définissez vos offres (Or, Argent, Bronze…) avec leur prix et leurs contreparties.</p>
            <button type="button" class="btn btn-sm btn-primary" (click)="openForm(null)">Créer un package</button></div>
        } @else {
          <div class="sp-pkg-grid">
            @for (p of packages; track p.id) {
              <section class="card sp-pkg">
                <div class="sp-row"><h3 style="flex:1">{{ p.name }}</h3>
                  @if (!p.active) { <span class="chip warn">Inactif</span> }
                  @if (p.exclusive_industry) { <span class="chip ai">Exclusivité sectorielle</span> }</div>
                <div class="sp-money" style="font-size:22px">{{ fmt(p.price) }}</div>
                <div><div class="sp-row tiny muted"><span style="flex:1">Places vendues</span><b>{{ sold(p.id) }} / {{ p.slots_total }}</b></div>
                  <div class="sp-bar"><i [style.width.%]="p.slots_total ? (sold(p.id) / p.slots_total) * 100 : 0"></i></div></div>
                @if (p.description) { <p class="muted tiny">{{ p.description }}</p> }
                @if (p.benefits.length) { <ul>@for (b of p.benefits; track $index) { <li>{{ b.title }}</li> }</ul> }
                <div class="row-actions">
                  <button type="button" class="btn btn-sm" (click)="openForm(p)">Modifier</button>
                  <button type="button" class="btn btn-sm btn-danger" (click)="remove(p)">Supprimer</button></div>
              </section>
            }
          </div>
        }

        @if (formOpen) {
          <div class="sp-overlay" (click)="formOpen = false"></div>
          <div class="sp-modal" role="dialog" [attr.aria-label]="editId ? 'Modifier le package' : 'Nouveau package'">
            <h3>{{ editId ? 'Modifier le package' : 'Nouveau package' }}</h3>
            @if (formError) { <div class="sp-error" role="alert"><span>{{ formError }}</span></div> }
            <div class="sp-two">
              <div class="field"><label>Nom *</label><input class="in" [(ngModel)]="form.name" />
                @if (errors['name']) { <div class="sp-field-error">{{ errors['name'] }}</div> }</div>
              <div class="field"><label>Rang (1 = plus haut)</label><input class="in" type="number" min="1" [(ngModel)]="form.tier_rank" /></div>
            </div>
            <div class="sp-two">
              <div class="field"><label>Prix (€)</label><input class="in" type="number" min="0" [(ngModel)]="form.price" />
                @if (errors['price']) { <div class="sp-field-error">{{ errors['price'] }}</div> }</div>
              <div class="field"><label>Places</label><input class="in" type="number" min="0" [(ngModel)]="form.slots_total" />
                @if (errors['slots_total']) { <div class="sp-field-error">{{ errors['slots_total'] }}</div> }</div>
            </div>
            <div class="sp-two">
              <div class="field"><label>Poids de visibilité</label><input class="in" type="number" min="0" step="0.1" [(ngModel)]="form.visibility_weight" /></div>
              <div class="field"><label>&nbsp;</label>
                <label><input type="checkbox" [(ngModel)]="form.exclusive_industry" /> Exclusivité sectorielle</label>
                <label><input type="checkbox" [(ngModel)]="form.active" /> Package actif</label></div>
            </div>
            <div class="field"><label>Description</label><textarea class="in" rows="2" [(ngModel)]="form.description"></textarea></div>
            <div class="field"><label>Contreparties types</label>
              @for (b of form.benefits; track $index) {
                <div class="sp-benefit-row">
                  <select class="in" [(ngModel)]="b.type" [attr.aria-label]="'Type ' + ($index + 1)">
                    @for (k of typeKeys; track k) { <option [value]="k">{{ typeLabels[k] }}</option> }</select>
                  <input class="in" placeholder="Titre" [(ngModel)]="b.title" [attr.aria-label]="'Titre ' + ($index + 1)" />
                  <input class="in" type="number" [(ngModel)]="b.offset_days" title="Jours par rapport au début de l'événement" [attr.aria-label]="'Décalage ' + ($index + 1)" />
                  <button type="button" class="btn btn-sm btn-danger" (click)="removeBenefit($index)" aria-label="Retirer">✕</button>
                </div>
              }
              <button type="button" class="btn btn-sm" (click)="addBenefit()">Ajouter une contrepartie</button>
              <p class="muted tiny" style="margin-top:6px">Le décalage est en jours par rapport au début de l'événement (ex. −14 = deux semaines avant).</p>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-sm" (click)="formOpen = false">Annuler</button>
              <button type="button" class="btn btn-sm btn-primary" [disabled]="saving" (click)="save()">{{ saving ? 'Enregistrement…' : 'Enregistrer' }}</button>
            </div>
          </div>
        }
      }
    </sp-state>
  `
})
export class SponsorPackagesComponent extends SponsorPageBase {
  packages: ApiSponsorshipPackage[] = [];
  deals: ApiSponsorshipDeal[] = [];
  formOpen = false;
  editId: string | null = null;
  form: PackageForm = blank();
  errors: Record<string, string> = {};
  formError = '';
  saving = false;
  readonly typeLabels = DELIVERABLE_TYPE_LABELS;
  readonly typeKeys = Object.keys(DELIVERABLE_TYPE_LABELS) as DeliverableType[];

  protected fetch(eventId: string): Observable<unknown> {
    return forkJoin({ packages: this.data.packages(eventId), deals: this.data.deals(eventId) }).pipe(
      tap(({ packages, deals }) => { this.packages = packages; this.deals = deals; })
    );
  }

  fmt(value: string): string { return money(value); }
  sold(packageId: string): number { return this.deals.filter(d => d.package === packageId && (d.status === 'signed' || d.status === 'paid')).length; }
  addBenefit(): void { this.form.benefits.push({ type: 'other', title: '', offset_days: 0 }); }
  removeBenefit(i: number): void { this.form.benefits.splice(i, 1); }

  openForm(p: ApiSponsorshipPackage | null): void {
    this.formOpen = true;
    this.editId = p?.id ?? null;
    this.errors = {};
    this.formError = '';
    this.form = p
      ? { name: p.name, tier_rank: p.tier_rank, price: p.price, slots_total: p.slots_total, exclusive_industry: p.exclusive_industry,
          visibility_weight: p.visibility_weight, description: p.description, active: p.active, benefits: p.benefits.map(b => ({ ...b })) }
      : blank();
  }

  save(): void {
    if (!this.event) return;
    this.errors = {};
    this.formError = '';
    if (!this.form.name.trim()) { this.errors['name'] = 'Le nom est obligatoire.'; return; }
    if (Number(this.form.price) < 0) { this.errors['price'] = 'Le prix doit être positif.'; return; }
    if (Number(this.form.slots_total) < 0) { this.errors['slots_total'] = 'Le nombre de places doit être positif.'; return; }
    const body = {
      ...this.form, event: this.event.id, price: String(this.form.price),
      visibility_weight: String(this.form.visibility_weight),
      benefits: this.form.benefits.filter(b => b.title.trim()).map(b => ({ ...b, offset_days: Number(b.offset_days) || 0 }))
    };
    this.saving = true;
    this.data.savePackage(body, this.editId ?? undefined).subscribe({
      next: () => { this.saving = false; this.formOpen = false; this.state.refresh(); },
      error: (e: ApiError) => { this.saving = false; this.errors = e.fields; this.formError = Object.keys(e.fields).length ? '' : e.message; }
    });
  }

  remove(p: ApiSponsorshipPackage): void {
    if (!confirm(`Supprimer le package « ${p.name} » ?`)) return;
    this.run(this.data.deletePackage(p.id));
  }
}
