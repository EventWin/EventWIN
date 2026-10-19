import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { SponsorsDataService } from '../../../sponsors/sponsors-data.service';
import { SponsorsStateService } from '../../../sponsors/sponsors-state.service';
import {
  ApiError, ApiSponsor, ApiSponsorshipPackage, INDUSTRY_LABELS, Industry, RELATIONSHIP_LABELS, RelationshipStatus
} from '../../../sponsors/sponsors.models';

type Form = {
  name: string; industry: Industry; contact_name: string; contact_email: string;
  legal_name: string; website: string; logo_url: string; contact_phone: string; country: string;
  relationship_status: RelationshipStatus; notes: string;
};

const EMPTY: Form = {
  name: '', industry: 'other', contact_name: '', contact_email: '', legal_name: '', website: '', logo_url: '',
  contact_phone: '', country: '', relationship_status: 'prospect', notes: ''
};

/** Création rapide / édition d'un sponsor (panneau latéral). Gère les doublons (409). */
@Component({
  selector: 'sp-sponsor-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (visible) {
      <div class="sp-overlay" (click)="close()"></div>
      <aside class="sp-drawer" role="dialog" [attr.aria-label]="editing ? 'Modifier le sponsor' : 'Nouveau sponsor'">
        <div class="sp-drawer-head">
          <h3>{{ editing ? 'Modifier le sponsor' : 'Nouveau sponsor' }}</h3>
          <button type="button" class="btn btn-sm" (click)="close()" aria-label="Fermer">✕</button>
        </div>

        @if (error) { <div class="sp-error" role="alert"><span>{{ error }}</span></div> }

        @if (duplicates.length) {
          <div class="sp-dup" role="alert">
            <b>Un sponsor similaire existe déjà.</b>
            <ul>@for (d of duplicates; track d.id) { <li>{{ d.name }} ({{ industries[d.industry] }}) · {{ d.contact_email }}</li> }</ul>
            <div class="row-actions">
              <button type="button" class="btn btn-sm" (click)="useExisting(duplicates[0])">Utiliser l'existant</button>
              <button type="button" class="btn btn-sm btn-primary" (click)="submit(true)">Créer quand même</button>
            </div>
          </div>
        }

        <div class="field"><label for="sp-name">Nom *</label>
          <input id="sp-name" class="in" [(ngModel)]="form.name" />
          @if (errors['name']) { <div class="sp-field-error">{{ errors['name'] }}</div> }</div>
        <div class="sp-two">
          <div class="field"><label for="sp-industry">Secteur</label>
            <select id="sp-industry" class="in" [(ngModel)]="form.industry">
              @for (key of industryKeys; track key) { <option [value]="key">{{ industries[key] }}</option> }
            </select></div>
          <div class="field"><label for="sp-contact">Contact *</label>
            <input id="sp-contact" class="in" [(ngModel)]="form.contact_name" />
            @if (errors['contact_name']) { <div class="sp-field-error">{{ errors['contact_name'] }}</div> }</div>
        </div>
        <div class="field"><label for="sp-email">E-mail du contact *</label>
          <input id="sp-email" class="in" type="email" [(ngModel)]="form.contact_email" />
          @if (errors['contact_email']) { <div class="sp-field-error">{{ errors['contact_email'] }}</div> }</div>

        <button type="button" class="sp-link" (click)="showMore = !showMore">{{ showMore ? 'Moins de détails' : 'Plus de détails' }}</button>
        @if (showMore) {
          <div style="margin-top:14px">
            <div class="field"><label>Raison sociale</label><input class="in" [(ngModel)]="form.legal_name" /></div>
            <div class="sp-two">
              <div class="field"><label>Site web</label><input class="in" [(ngModel)]="form.website" placeholder="https://" />
                @if (errors['website']) { <div class="sp-field-error">{{ errors['website'] }}</div> }</div>
              <div class="field"><label>URL du logo</label><input class="in" [(ngModel)]="form.logo_url" placeholder="https://" />
                @if (errors['logo_url']) { <div class="sp-field-error">{{ errors['logo_url'] }}</div> }</div>
            </div>
            <div class="sp-two">
              <div class="field"><label>Téléphone</label><input class="in" [(ngModel)]="form.contact_phone" /></div>
              <div class="field"><label>Pays</label><input class="in" [(ngModel)]="form.country" /></div>
            </div>
            <div class="field"><label>Statut de la relation</label>
              <select class="in" [(ngModel)]="form.relationship_status">
                @for (key of relKeys; track key) { <option [value]="key">{{ relLabels[key] }}</option> }
              </select></div>
            <div class="field"><label>Notes</label><textarea class="in" rows="3" [(ngModel)]="form.notes"></textarea></div>
          </div>
        }

        @if (!editing && state.event) {
          <div class="field" style="margin-top:14px">
            <label><input type="checkbox" [(ngModel)]="addToPipeline" /> Ajouter directement au pipeline de « {{ state.event.name }} »</label>
          </div>
          @if (addToPipeline) {
            <div class="sp-two">
              <div class="field"><label>Package</label>
                <select class="in" [(ngModel)]="packageId" (ngModelChange)="onPackage($event)">
                  <option [ngValue]="null">Aucun</option>
                  @for (p of packages; track p.id) { <option [ngValue]="p.id">{{ p.name }} ({{ p.price }} €)</option> }
                </select></div>
              <div class="field"><label>Montant estimé (€)</label><input class="in" type="number" min="0" [(ngModel)]="amount" />
                @if (errors['cash_amount']) { <div class="sp-field-error">{{ errors['cash_amount'] }}</div> }</div>
            </div>
          }
        }

        <div class="form-actions">
          <button type="button" class="btn btn-sm" (click)="close()">Annuler</button>
          <button type="button" class="btn btn-sm btn-primary" [disabled]="saving" (click)="submit(false)">
            {{ saving ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Créer' }}
          </button>
        </div>
      </aside>
    }
  `
})
export class SponsorFormComponent implements OnInit, OnDestroy {
  protected readonly state = inject(SponsorsStateService);
  private readonly data = inject(SponsorsDataService);

  visible = false;
  editing: ApiSponsor | null = null;
  form: Form = { ...EMPTY };
  showMore = false;
  saving = false;
  error = '';
  errors: Record<string, string> = {};
  duplicates: ApiSponsor[] = [];
  addToPipeline = false;
  packageId: string | null = null;
  amount = '';
  packages: ApiSponsorshipPackage[] = [];

  readonly industries = INDUSTRY_LABELS;
  readonly industryKeys = Object.keys(INDUSTRY_LABELS) as Industry[];
  readonly relLabels = RELATIONSHIP_LABELS;
  readonly relKeys = Object.keys(RELATIONSHIP_LABELS) as RelationshipStatus[];
  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.state.sponsorForm$.subscribe(request => {
      this.visible = !!request;
      if (!request) return;
      this.editing = request.sponsor;
      this.form = request.sponsor ? { ...EMPTY, ...request.sponsor } : { ...EMPTY };
      this.showMore = !!request.sponsor;
      this.error = '';
      this.errors = {};
      this.duplicates = [];
      this.addToPipeline = false;
      this.packageId = null;
      this.amount = '';
      this.packages = [];
      if (!request.sponsor && this.state.event) {
        this.data.packages(this.state.event.id).subscribe({ next: list => (this.packages = list.filter(p => p.active)), error: () => {} });
      }
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  close(): void { this.state.closeSponsorForm(); }

  onPackage(id: string | null): void {
    const pkg = this.packages.find(p => p.id === id);
    if (pkg && !this.amount) this.amount = pkg.price;
  }

  private validate(): boolean {
    const errors: Record<string, string> = {};
    if (!this.form.name.trim()) errors['name'] = 'Le nom est obligatoire.';
    if (!this.form.contact_name.trim()) errors['contact_name'] = 'Le contact est obligatoire.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.form.contact_email.trim())) errors['contact_email'] = 'Adresse e-mail invalide.';
    for (const key of ['website', 'logo_url'] as const) {
      const value = this.form[key].trim();
      if (value && !/^https?:\/\/\S+\.\S+/.test(value)) errors[key] = 'URL invalide (commencez par https://).';
    }
    if (this.addToPipeline && this.amount && Number(this.amount) < 0) errors['cash_amount'] = 'Le montant doit être positif.';
    this.errors = errors;
    return Object.keys(errors).length === 0;
  }

  submit(force: boolean): void {
    this.error = '';
    if (!force) this.duplicates = [];
    if (!this.validate()) return;
    const body: Partial<ApiSponsor> = { ...this.form };
    this.saving = true;
    const done = () => { this.saving = false; this.state.refresh(); this.close(); };
    const fail = (e: ApiError) => {
      this.saving = false;
      if (e.status === 409 && e.duplicates.length) { this.duplicates = e.duplicates; return; }
      this.errors = e.fields;
      this.error = Object.keys(e.fields).length ? '' : e.message;
    };

    if (this.editing) {
      this.data.updateSponsor(this.editing.id, body).subscribe({ next: done, error: fail });
    } else if (this.addToPipeline && this.state.event) {
      const deal = { event: this.state.event.id, package: this.packageId, cash_amount: String(this.amount || 0) };
      this.data.quickCreate(body, deal, force).subscribe({ next: done, error: fail });
    } else {
      this.data.createSponsor(body, force).subscribe({ next: done, error: fail });
    }
  }

  useExisting(existing: ApiSponsor): void {
    if (this.addToPipeline && this.state.event) {
      this.saving = true;
      this.data.createDeal({
        event: this.state.event.id, sponsor: existing.id, package: this.packageId, cash_amount: String(this.amount || 0)
      }).subscribe({
        next: () => { this.saving = false; this.state.refresh(); this.close(); },
        error: (e: ApiError) => { this.saving = false; this.duplicates = []; this.error = e.message; }
      });
    } else {
      this.close();
    }
  }
}
