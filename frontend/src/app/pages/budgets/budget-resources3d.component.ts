import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { BudgetItem } from './budget.service';

/**
 * Grille des ressources d'un événement avec leurs estimations.
 *
 * Affiche honnêtement la provenance du prix : `real_offer` (offre vérifiée)
 * est mise en avant, `ai_estimate` est signalée comme indicative. Aucun lien
 * ou fournisseur n'est affiché s'il n'a pas été fourni par le backend.
 */
@Component({
  selector: 'app-budget-resources3d',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="grid g3">
      <div class="card rcard" *ngFor="let r of resources" [class.unpriced]="!r.total">
        <div class="rhead">
          <span class="ricon">{{ icon(r.name, r.category) }}</span>
          <div class="rtitles">
            <h4>{{ r.name }}</h4>
            <span class="rqty">{{ r.quantity | number:'1.0-2' }} ×
              {{ (r.unit_price || 0) | number:'1.2-2' }} €</span>
          </div>
        </div>

        <p class="rdesc" *ngIf="r.description">{{ r.description }}</p>

        <div class="rtotal">
          <span class="lab">Coût total estimé</span>
          <b class="n">{{ (r.total || 0) | number:'1.2-2' }} €</b>
        </div>

        <span class="rsrc" *ngIf="r.price_source === 'real_offer'" title="Offre vérifiée">
          ✓ Offre réelle vérifiée
        </span>
        <span class="rsrc est" *ngIf="r.price_source !== 'real_offer' && r.unit_price">
          Estimation IA — indicative
        </span>
        <span class="rsrc none" *ngIf="!r.unit_price">
          Non chiffrée
        </span>

        <p class="muted tiny" *ngIf="r.price_range_min || r.price_range_max">
          Fourchette : {{ (r.price_range_min || 0) | number:'1.0-0' }} – {{ (r.price_range_max || 0) | number:'1.0-0' }} €
        </p>

        <div class="roffers" *ngIf="r.provider || r.product_url">
          <div class="roffer">
            <div>
              <h5 *ngIf="r.provider">{{ r.provider }}</h5>
              <span *ngIf="r.product_url" class="muted tiny">Offre fournie par la recherche</span>
            </div>
            <a *ngIf="r.product_url" [href]="r.product_url" target="_blank" rel="noopener"
              class="btn btn-sm">Voir l'offre</a>
          </div>
        </div>

        <p class="muted tiny" *ngIf="r.confidence != null">
          Confiance : {{ r.confidence | number:'1.0-0' }}%
        </p>
        <p class="muted tiny" *ngIf="!r.unit_price">
          Lancez l'analyse IA pour obtenir une estimation indicative.
        </p>
      </div>
    </div>
  `,
  styles: [`
    .rcard{display:flex;flex-direction:column;gap:12px;transition:transform .3s var(--ease),box-shadow .3s var(--ease)}
    .rcard:hover{transform:translateY(-3px);box-shadow:var(--sh-ai)}
    .rcard.unpriced{opacity:.75}
    .rhead{display:flex;align-items:center;gap:12px}
    .ricon{font-size:26px;line-height:1;filter:drop-shadow(0 4px 12px rgba(59,130,246,.4))}
    .rtitles{display:flex;flex-direction:column;min-width:0}
    .rtitles h4{font-size:16px}
    .rqty{color:var(--tx-2);font-size:13px}
    .rdesc{font-size:12.5px;color:var(--tx-2)}
    .rtotal{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:12px;
      background:var(--ai-soft);border:1px solid var(--line)}
    .rtotal .lab{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--tx-2)}
    .rtotal b{font-size:22px;font-family:"Space Grotesk",sans-serif;color:var(--blue)}
    .rsrc{align-self:flex-start;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;
      background:rgba(15,169,125,.14);color:var(--gain)}
    .rsrc.est{background:rgba(59,130,246,.14);color:var(--blue)}
    .rsrc.none{background:rgba(141,148,178,.16);color:var(--tx-2)}
    .roffers{display:flex;flex-direction:column;gap:8px}
    .roffer{display:flex;align-items:center;justify-content:space-between;gap:8px;
      padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--sub)}
    .roffer h5{font-size:13px}
    @media (prefers-reduced-motion: reduce){.rcard{transition:none}.rcard:hover{transform:none}}
  `]
})
export class BudgetResources3dComponent {
  @Input() resources: BudgetItem[] = [];

  icon(_name: string, _category: string): string {
    return '📦';
  }
}
