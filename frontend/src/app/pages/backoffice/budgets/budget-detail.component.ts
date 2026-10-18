import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import {
  AiAnalysis,
  AiFigures,
  AiScenario,
  AmbiguousResource,
  BudgetItem,
  BudgetSummary,
  BudgetService,
  DuplicateGroup,
  INVALID_NAME_MESSAGE,
  UnpricedResource,
  validateResourceName
} from '../../budgets/budget.service';
import { BudgetAvatarHeadComponent } from '../../budgets/budget-avatar-head.component';

type Load = 'loading' | 'error' | 'ok';
type AiState = 'idle' | 'thinking' | 'ok' | 'unavailable';

/**
 * Ligne du formulaire de ressources (seuls nom, quantité et description).
 *
 * ``warn`` n'est **pas** un refus : la ligne est enregistrée telle quelle. Elle
 * signale simplement qu'elle sera probablement classée « ambiguë » et exclue de
 * l'analyse, avec la même raison, tant qu'elle n'est pas reformulée.
 */
interface ResourceRow {
  id?: string;
  name: string;
  quantity: number;
  description: string;
  warn?: string;
}

interface ConstraintAgg {
  value: string;
  count: number;
  isHard: boolean;
}

/** Nombre maximal de lignes dans l'éditeur de ressources. */
const MAX_ROWS = 20;

/**
 * Page « Budget de l'événement » — maquette « wallet IA ».
 *
 * Présentation : reprise de la maquette HTML fournie (même disposition sur un
 * seul écran, portefeuille 3D CSS avec rabat et pièces, avatar 3D « talking
 * head » de l'assistant, bulle de dialogue, résultats en trois colonnes,
 * toast), mais habillée avec les **variables de couleur, les polices et le
 * thème de l'application** (`--paper`, `--sub`, `--card`, `--line`, `--line-2`,
 * `--tx`, `--tx-2`, `--tx-3`, `--violet`, `--blue`, `--gain`, `--warn`,
 * `--risk`, `--ai`, Inter + Space Grotesk). Aucune variable de couleur nouvelle
 * n'est créée. L'avatar est rendu par `BudgetAvatarHeadComponent` (bibliothèque
 * TalkingHead, MIT) et retombe sur l'ancien avatar SVG si la 3D est
 * indisponible.
 *
 * Les classes CSS locales sont préfixées/renommées (`hdr`, `layout`, `wstage`,
 * `wamt`, `wchip`, `bempty`, `rcol`, `bout`, `ewarn`, `bacts`, `btoast`,
 * `mini`, `pos`, `mini`…) et les `@keyframes` sont préfixés `bw*` : les styles
 * de composant Angular ne sont pas totalement isolés (les `@keyframes` et les
 * classes de `styles.css` restent globales), on évite donc toute collision avec
 * le reste de l'application.
 *
 * Logique métier :
 *  - le budget maximal vient de la base (`Event.target_budget`), jamais saisi ;
 *  - l'organisateur ne saisit que nom, quantité et description — aucun prix ;
 *  - un seul bouton « ✨ Analyse IA » : validation, sauvegarde, compréhension,
 *    recherche web de fournisseurs, calcul du budget et recommandations, via
 *    l'appel IA existant (`POST /api/budget-items/analyze/`) ;
 *  - les totaux sont calculés par le backend, jamais par le front ;
 *  - **une ressource dont le nom ou la description n'a pas été comprise est
 *    classée « ambiguë » et totalement exclue de l'analyse** : aucun prix,
 *    aucun fournisseur, aucun calcul. Elle apparaît dans une 4ᵉ colonne avec
 *    la raison, pour que l'organisateur sache quoi reformuler ;
 *  - **un lien fournisseur n'apparaît que s'il provient d'une page
 *    réellement trouvée** par la recherche web (le LLM ne fait que choisir
 *    dans la liste des résultats, et l'application vérifie ce choix). À défaut,
 *    on affiche explicitement « aucune offre fiable trouvée » plutôt que
 *    d'inventer un lien ;
 *  - le prix reste une estimation IA sauf si un tarif a réellement été relevé
 *    sur la page — la mention l'indique toujours ;
 *  - si l'IA est indisponible, on l'affiche au lieu de simuler un résultat.
 */
@Component({
  selector: 'app-budget-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, BudgetAvatarHeadComponent],
  template: `
    <!-- ================= Chargement / erreur ================= -->
    <div class="panel msg" *ngIf="load === 'loading'">Chargement du budget…</div>
    <div class="panel msg" *ngIf="load === 'error'">
      <strong>{{ loadError || 'Impossible de charger le budget.' }}</strong>
      <small *ngIf="eventId">Identifiant événement : {{ eventId }}</small>
      <button class="ghost" type="button" routerLink="/app/budgets">Retour aux budgets</button>
    </div>

    <ng-container *ngIf="load === 'ok' && summary">
      <!-- ================= Barre supérieure ================= -->
      <div class="hdr">
        <div class="brand"><i></i>Budget de l’événement</div>

        <input class="ro ev" [value]="summary.event.name" readonly
          aria-label="Nom de l’événement" [title]="summary.event.name">
        <input class="ro bud n" [value]="budgetLabel" readonly
          aria-label="Budget maximal" title="Budget maximal issu de la fiche événement">

        <span class="meta">
          {{ summary.event.event_type_label }}
          <ng-container *ngIf="summary.event.location">· {{ summary.event.location }}</ng-container>
          · {{ summary.event.participants }} participants
        </span>

        <div class="fill"></div>

        <span class="st"
          [class.ok]="aiState === 'ok' && !over"
          [class.ko]="(aiState === 'ok' && over) || aiState === 'unavailable'"
          [class.wait]="aiState === 'thinking'">
          {{ aiState === 'thinking' ? 'Analyse…'
             : aiState === 'unavailable' ? 'IA indisponible'
             : aiState === 'ok' ? (over ? 'Dépassement' : 'Budget respecté')
             : 'En attente d’analyse' }}
        </span>
        <button class="ghost" type="button" routerLink="/app/budgets">← Tous les budgets</button>
      </div>

      <!-- ================= Zone principale ================= -->
      <div class="layout">
        <!-- Avatar (talking head 3D Ready Player Me) -->
        <div class="panel avatar" [class.busy]="busy">
          <div class="bubble">{{ assistantLine }}</div>
          <app-budget-avatar-head [mood]="avatarMood"></app-budget-avatar-head>
        </div>

        <!-- Portefeuille 3D -->
        <div class="panel wstage" (mousemove)="onTilt($event)" (mouseleave)="resetTilt()">
          <div class="wallet" [class.go]="busy" [style.transform]="tilt">
            <div class="body">
              <div class="lbl">Budget de l’événement</div>
              <div class="wamt n">{{ budgetLabel }}</div>
              <div>
                <div class="wname" [title]="summary.event.name">{{ summary.event.name }}</div>
                <div class="chips">
                  <span class="wchip" *ngFor="let c of walletChips">{{ c }}</span>
                </div>
              </div>
            </div>
            <div class="flap"></div>
          </div>
          <div class="coins" *ngIf="busy" aria-hidden="true">
            <i *ngFor="let c of coinsArr" [style.--x]="c.x" [style.animation-delay]="c.d"></i>
          </div>
        </div>

        <!-- Ressources -->
        <div class="panel res">
          <h3>Ressources de l’événement</h3>
          <div class="rl">
            <div class="row" *ngFor="let r of rows; let i = index" [class.warn]="r.warn">
              <input class="nm" [class.warn]="r.warn" [(ngModel)]="r.name"
                (ngModelChange)="onNameChange(r)"
                placeholder="Ressource (ex : sono)" aria-label="Nom de la ressource">
              <input class="q" type="number" min="1" step="1" [(ngModel)]="r.quantity"
                placeholder="Qté" aria-label="Quantité">
              <input class="d" [(ngModel)]="r.description"
                placeholder="Description (facultatif)" aria-label="Description">
              <button class="del" type="button" title="Supprimer la ligne"
                aria-label="Supprimer la ligne" (click)="removeRow(i)">✕</button>
              <p class="rerr" *ngIf="r.warn">{{ r.warn }}</p>
            </div>
          </div>

          <div class="cons" *ngIf="constraints.length">
            <span class="lbl">Contraintes</span>
            <span class="cc" *ngFor="let c of constraints" [class.hard]="c.isHard">
              {{ c.value }} · {{ c.count }}
            </span>
          </div>
        </div>
      </div>

      <!-- ================= Bouton unique ================= -->
      <div class="btnrow">
        <button class="go" type="button" (click)="runAnalysis()"
          [disabled]="busy || (!activeRows.length && !hasPendingDelete)">
          <span class="spin" *ngIf="busy" aria-hidden="true"></span>
          {{ busy ? 'Analyse en cours…' : '✨ Analyse IA' }}
        </button>
      </div>

      <!-- ================= Résultats ================= -->
      <div class="panel bout" *ngIf="aiState !== 'idle'">
        <div class="bempty" *ngIf="aiState === 'thinking'">⏳ L’IA analyse ton événement…</div>

        <div class="bempty" *ngIf="aiState === 'unavailable'">
          <span>
            ⚠️ {{ aiError }}<br>
            <small class="mut">Vos ressources sont enregistrées. Aucun résultat n’est simulé —
              relancez l’analyse dès que l’assistant est disponible.</small>
          </span>
        </div>

        <ng-container *ngIf="aiState === 'ok' && analysis">
          <!-- Colonne 1 : ressources comprises & prix estimés -->
          <div class="rcol">
            <h3>Ressources &amp; prix estimés</h3>

            <p class="mini mut" *ngIf="!understoodItems.length">
              Aucune ressource n’a pu être comprise : elles sont toutes détaillées
              dans « Ressources ambiguës ».
            </p>

            <div class="it" *ngFor="let it of understoodItems">
              <div><b>{{ it.name }}</b> <small>× {{ it.quantity }}</small></div>

              <!-- Cas « comprise mais non chiffrée » : on affiche un tiret et
                   surtout jamais 0 €, qui se lirait « gratuit ». -->
              <div class="p">
                <ng-container *ngIf="it.total != null; else nonChiffre">
                  {{ it.total | number:'1.2-2' }} €
                </ng-container>
                <ng-template #nonChiffre>—</ng-template>
              </div>
              <div>
                <small *ngIf="it.unpriced_reason" class="npr">
                  Non chiffrée par l’IA
                </small>
                <small *ngIf="it.total != null">
                  {{ (it.unit_price || 0) | number:'1.2-2' }} € / unité ·
                  {{ it.price_source === 'real_offer' ? 'prix relevé et validé sur le site'
                     : it.price_source === 'ai_estimate' ? 'estimation IA'
                     : it.product_url ? 'lien direct vérifié, prix indisponible' : 'prix indisponible' }}
                </small>
              </div>

              <p class="mini nprz" *ngIf="it.unpriced_reason">
                {{ it.unpriced_reason }}
              </p>

              <!-- Recommandation d'achat : page réellement trouvée sur le web. -->
              <div class="lnk" *ngIf="it.product_url">
                <a class="offr" [href]="it.product_url" target="_blank" rel="noopener noreferrer"
                  [title]="it.offer_title || it.product_url">
                  🛒 {{ it.offer_domain || it.provider || 'Voir la page produit' }}
                </a>
                <small *ngIf="it.offer_title">{{ it.offer_title }}</small>
                <small *ngIf="it.offer_price != null">
                  Prix relevé : {{ it.offer_price | number:'1.2-2' }} {{ it.offer_currency || 'devise inconnue' }}
                </small>
                <small *ngIf="it.offer_verified_at">
                  Vérifié le {{ it.offer_verified_at | date:'dd/MM/yyyy HH:mm' }}
                </small>
                <small *ngIf="it.offer_available === true">Disponibilité indiquée sur la page</small>
                <small *ngIf="it.offer_available === false">Disponibilité non confirmée</small>
                <small *ngIf="it.offer_note">{{ it.offer_note }}</small>
              </div>

              <div class="lnk" *ngIf="!it.product_url">
                <p class="nooffr">Aucun lien direct vers un produit pertinent trouvé —
                  aucun lien n’est affiché plutôt que d’en inventer un.</p>
              </div>
            </div>

            <p class="mini mut" *ngIf="analysis.estimate_errors?.length" style="margin-top:.6rem;">
              <b>Erreurs d’estimation</b><br>
              <span *ngFor="let e of analysis.estimate_errors; last as l">{{ e.resource }} : {{ e.error }}<span *ngIf="!l"> · </span></span>
            </p>

            <div class="uwarn" *ngIf="unpriced.length">
              <b>Compris, mais non chiffrés</b>
              <p class="mini">Aucun montant n’a été inventé. Les lignes ci-dessous ne pèsent pas dans le total —
                consultez la page du fournisseur pour le tarif.</p>
              <div class="urow" *ngFor="let it of unpriced">
                <span><b>{{ it.name }}</b> <small>× {{ it.quantity }}</small></span>
                <span class="mut">{{ it.reason }}</span>
              </div>
            </div>

            <!-- Doublons d'identité évidente : signalés, jamais fusionnés. -->
            <div class="uwarn" *ngIf="duplicates.length">
              <b>Lignes identiques détectées</b>
              <p class="mini">Même nom, même description, même quantité et même catégorie.
                L’analyse ne les fusionne pas : si c’est un doublon de saisie, corrigez ou
                supprimez-en une dans « Ressources de l’événement », puis relancez l’analyse.</p>
              <div class="urow" *ngFor="let d of duplicates">
                <span><b>{{ d.name }}</b> <small>× {{ d.quantity }}</small></span>
                <span class="mut">{{ d.count }} lignes identiques</span>
              </div>
            </div>

          </div>

          <!-- Colonne 2 : budget total -->
          <div class="rcol">
            <h3>Budget total estimé</h3>
            <div class="tot n" *ngIf="pricedCount > 0">{{ displayTotal | number:'1.2-2' }} €</div>
            <div class="tot none" *ngIf="pricedCount === 0">Aucun poste chiffré</div>
            <p class="mini mut" *ngIf="pricedCount === 0">
              Aucune ressource n'a encore reçu de prix : le total n'est pas
              « 0 € », il est inconnu tant que l'analyse IA n'a rien chiffré.
            </p>
            <span class="badge" *ngIf="budgetAvailable" [class.ko]="over" [class.ok]="!over">
              {{ budgetStatusText }}
            </span>
            <span class="badge" *ngIf="!budgetAvailable">Budget non défini</span>
            <p class="sum" *ngIf="analysis.summary">{{ analysis.summary }}</p>

            <div class="kv"><span>Budget maximal</span><b class="n">{{ budgetLabel }}</b></div>
            <div class="kv"><span>Ressources comprises</span><b class="n">{{ understoodItems.length }}</b></div>
            <div class="kv" *ngIf="unpriced.length"><span>Compris, non chiffrés</span><b class="n">{{ unpriced.length }}</b></div>
            <div class="kv" *ngIf="ambiguous.length">
              <span>Ressources écartées (incomprises)</span>
              <b class="n">{{ ambiguous.length }}</b>
            </div>

            <p class="sinfo" *ngIf="analysis.web_search">
              Recherche web : {{ analysis.web_search.provider_label }}<ng-container
                *ngIf="analysis.web_search.keyless"> (sans clé)</ng-container>
              · {{ analysis.web_search.found }} page(s) retenue(s) sur
              {{ analysis.web_search.searched }} ressource(s) cherchée(s).
              <br>{{ analysis.web_search.note }}
            </p>

            <!-- Chiffres distincts, tous recalculés par le backend -->
            <div class="figs" *ngIf="figures && pricedCount > 0">
              <div class="kv"><span>Budget maximal</span>
                <b class="n">{{ figures.budget_max == null ? 'Non défini'
                  : (figures.budget_max | number:'1.2-2') + ' €' }}</b></div>
              <div class="kv"><span>Coût estimé initial</span>
                <b class="n">{{ figures.initial_cost | number:'1.2-2' }} €</b></div>
              <div class="kv" *ngIf="figures.initial_remaining != null">
                <span>{{ figures.initial_remaining >= 0 ? 'Reste initial' : 'Dépassement initial' }}</span>
                <b class="n">{{ abs(figures.initial_remaining) | number:'1.2-2' }} €</b></div>
              <div class="kv" *ngIf="figures.savings > 0"><span>Économies possibles</span>
                <b class="n pos">−{{ figures.savings | number:'1.2-2' }} €</b></div>
              <div class="kv" *ngIf="figures.improvements_cost > 0"><span>Coût des améliorations</span>
                <b class="n">+{{ figures.improvements_cost | number:'1.2-2' }} €</b></div>
              <div class="kv"><span>Coût final</span>
                <b class="n">{{ figures.final_cost | number:'1.2-2' }} €</b></div>
              <div class="kv" *ngIf="figures.final_remaining != null">
                <span>{{ figures.final_remaining >= 0 ? 'Reste final' : 'Dépassement final' }}</span>
                <b class="n">{{ abs(figures.final_remaining) | number:'1.2-2' }} €</b></div>
            </div>

            <div class="rec" *ngIf="analysis.main_recommendation?.title && analysis.analysis_mode === 'optimization'">
              <b>{{ analysis.main_recommendation?.title }}</b>
              <p class="mini mut">{{ analysis.main_recommendation?.reason }}</p>
              <p class="mini"><span class="mut">Économie estimée</span>
                <b class="pos n">{{ (analysis.main_recommendation?.saving || 0) | number:'1.2-2' }} €</b></p>
            </div>
          </div>

          <!-- Colonne 3 : conseils -->
          <div class="rcol">
            <h3>{{ analysis.analysis_mode === 'optimization' ? 'Optimisation du budget' : 'Améliorations de l’événement' }}</h3>

            <!-- Budget respecté : améliorations -->
            <ul class="adv" *ngIf="analysis.analysis_mode === 'improvement' || analysis.analysis_mode === 'free_improvement'">
              <li *ngFor="let r of analysis.recommendations">
                <b>{{ r.title }}</b> — {{ r.reason }}
                <span class="mut"> {{ r.benefit }}
                  <ng-container *ngIf="r.estimated_cost != null; else qualitativeRecommendation">
                    (+{{ r.estimated_cost | number:'1.2-2' }} € · {{ costSourceLabel(r.cost_source) }} · {{ recommendationImpact(r.estimated_cost) }})
                  </ng-container>
                  <ng-template #qualitativeRecommendation>(coût non chiffré)</ng-template>
                </span>
                <small class="mut" *ngIf="r.balance_after != null">Solde après ajout : {{ r.balance_after | number:'1.2-2' }} €</small>
                <small class="mut" *ngIf="r.url">
                  <ng-container *ngIf="r.source_status === 'verified'">Source vérifiée : </ng-container>
                  <ng-container *ngIf="r.source_status !== 'verified'">Page réelle trouvée (prix non vérifié) : </ng-container>
                  <a [href]="r.url" target="_blank" rel="noopener noreferrer">{{ r.domain || r.source_title || r.url }}</a>
                </small>
                <small class="mut" *ngIf="!r.url">Aucun lien fournisseur vérifié pour cette suggestion.</small>
              </li>
            </ul>
            <p class="mini mut" *ngIf="(analysis.analysis_mode === 'improvement' || analysis.analysis_mode === 'free_improvement') && !analysis.recommendations?.length">Aucune amélioration proposée.</p>
            <p class="mini mut" *ngIf="analysis.recommendations_notice">{{ analysis.recommendations_notice }}</p>

            <!-- Budget dépassé : alternatives moins coûteuses -->
            <ul class="adv" *ngIf="analysis.analysis_mode === 'optimization'">
              <li *ngFor="let s of analysis.scenarios">
                <b>{{ s.name }}</b> — {{ s.description }}
                <span class="mut">Nouveau total {{ s.new_total | number:'1.2-2' }} € ·
                  économie {{ s.saving | number:'1.2-2' }} € · {{ scenarioImpact(s) }}</span>
                <ul class="chg" *ngIf="s.changes?.length">
                  <li *ngFor="let ch of s.changes">
                    {{ ch.expense }} :
                    <ng-container *ngIf="ch.old_quantity != null && ch.new_quantity != null">
                      {{ ch.old_quantity }} → {{ ch.new_quantity }} unité(s) ·
                    </ng-container>
                    {{ ch.old_cost | number:'1.2-2' }} → {{ ch.new_cost | number:'1.2-2' }} €
                    <span class="pos">(−{{ ch.saving | number:'1.2-2' }} €)</span>
                    <small class="mut">{{ ch.reason }}</small>
                    <small class="mut" *ngIf="ch.source_url">
                      <ng-container *ngIf="ch.source_status === 'verified'">
                        Source vérifiée :
                        <a [href]="ch.source_url" target="_blank" rel="noopener noreferrer">{{ ch.source_domain || ch.source_url }}</a>
                        <span *ngIf="ch.price_verified"> · tarif relevé</span>
                      </ng-container>
                      <ng-container *ngIf="ch.source_status !== 'verified'">
                        Page réelle trouvée (prix non vérifié) :
                        <a [href]="ch.source_url" target="_blank" rel="noopener noreferrer">{{ ch.source_domain || ch.source_url }}</a>
                      </ng-container>
                    </small>
                    <small class="mut" *ngIf="!ch.source_url">
                      Aucun lien fournisseur vérifié pour ce poste : l’économie vient
                      uniquement de la baisse de quantité.
                    </small>
                  </li>
                </ul>
                <button class="ghost sm" type="button" (click)="askApply(s)">Préparer cette alternative</button>
                <div class="confirm" *ngIf="pending === s">
                  <p class="mini">Reporter ces quantités dans vos ressources ? Rien n’est enregistré
                    tant que vous ne relancez pas l’analyse.</p>
                  <div class="bacts">
                    <button class="ghost sm" type="button" (click)="pending = null">Annuler</button>
                    <button class="go sm" type="button" (click)="applyScenario(s)">Reporter</button>
                  </div>
                </div>
              </li>
            </ul>
            <p class="mini mut" *ngIf="analysis.analysis_mode === 'optimization' && !analysis.scenarios?.length">Aucune alternative chiffrée proposée.</p>
            <p class="mini mut" *ngIf="analysis.analysis_mode === 'optimization' && analysis.computed.optimization">
              Économie recalculée : {{ analysis.computed.optimization.estimated_savings | number:'1.2-2' }} € ·
              dépassement restant :
              {{ analysis.computed.optimization.overage_after_optimization || 0 | number:'1.2-2' }} €
              <span *ngIf="!analysis.computed.optimization.feasible"> — aucune solution fiable ne suffit.</span>
            </p>

            <p class="mini mut draft" *ngIf="draftNotice">{{ draftNotice }}</p>
          </div>

          <!-- Colonne 4 : ressources écartées de l'analyse -->
          <div class="rcol">
            <h3>Ressources ambiguës</h3>

            <p class="ambnone" *ngIf="!ambiguous.length">
              {{ emptyAmbiguousText }}
            </p>

            <div class="amb" *ngIf="ambiguous.length">
              <p class="mini mut">
                Ces lignes sont <b>exclues de l’analyse budgétaire</b> : aucun prix,
                aucun fournisseur et aucun calcul ne leur sont attribués. Elles ne
                pèsent donc pas sur le total.
              </p>

              <div class="ambrow" *ngFor="let a of ambiguous">
                <div class="top">
                  <b>{{ a.name }}</b>
                  <span class="qty n">× {{ a.quantity }}</span>
                </div>
                <p>{{ a.reason }}</p>
                <p class="fix">Reformulez ce nom dans « Ressources de l’événement »,
                  puis relancez « Analyse IA » pour l’inclure.</p>
              </div>
            </div>
          </div>
        </ng-container>
      </div>
    </ng-container>

    <!-- ================= Toast ================= -->
    <div class="btoast" *ngIf="toastMsg">
      <span>{{ toastMsg }}</span>
      <button type="button" (click)="dismissToast()" aria-label="Fermer">✕</button>
    </div>
  `,
  styles: [`
    /* =========================================================
       Habillage : maquette « wallet IA » + variables de l'app.
       Aucune variable de couleur nouvelle n'est créée : on
       réutilise --paper --sub --card --line --line-2 --tx
       --tx-2 --tx-3 --violet --blue --gain --warn --risk --ai.
       Classes préfixées et @keyframes bw* : isolation garantie
       vis-à-vis des styles globaux de l'application.
       ========================================================= */
    :host{
      display:flex;flex-direction:column;gap:10px;
      flex:1;min-width:0;min-height:0;overflow:auto;color:var(--tx);
    }
    .fill{flex:1}
    .mut{color:var(--tx-2)}
    .mini{font-size:12px}
    .pos{color:var(--gain)}
    .n{font-family:"Space Grotesk",sans-serif;font-variant-numeric:tabular-nums}
    .panel{background:var(--card);border:1px solid var(--line);border-radius:16px}
    .msg{padding:18px;text-align:center;color:var(--tx-2);display:flex;gap:12px;
      align-items:center;justify-content:center;flex-wrap:wrap}

    /* ---------- Barre supérieure ---------- */
    .hdr{display:flex;gap:10px;align-items:center;flex-wrap:wrap;flex:0 0 auto}
    .brand{display:flex;align-items:center;gap:10px;font-family:"Space Grotesk",sans-serif;
      font-weight:600;font-size:17px;letter-spacing:-.025em;margin-right:6px;white-space:nowrap}
    .brand i{width:30px;height:30px;border-radius:9px;background:var(--ai);
      box-shadow:var(--sh-ai);flex:none}
    .hdr input{background:var(--card);border:1px solid var(--line-2);color:var(--tx);
      border-radius:10px;padding:9px 11px;font:inherit;font-size:14px;outline:none;min-width:0}
    .hdr input.ro{background:var(--sub);color:var(--tx-2);cursor:default}
    .hdr input.ro.ev{flex:1 1 260px}
    .hdr input.ro.bud{flex:0 0 150px;font-size:16px;font-weight:600;color:var(--tx);text-align:center}
    .meta{font-size:12.5px;color:var(--tx-3);white-space:nowrap}
    .st{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;
      font-size:12px;font-weight:600;background:var(--sub);color:var(--tx-2);flex:none}
    .st.ok{background:rgba(15,169,125,.12);color:var(--gain)}
    .st.ko{background:rgba(232,69,95,.12);color:var(--risk)}
    .st.wait{background:var(--ai-soft);color:var(--violet)}
    .ghost{border:1px solid var(--line-2);background:var(--card);color:var(--tx-2);
      border-radius:11px;padding:8px 14px;font-size:13px;cursor:pointer;flex:none;
      transition:background .2s,color .2s}
    .ghost:hover{background:var(--sub);color:var(--tx)}
    .ghost.sm{padding:6px 11px;font-size:12px;margin-top:6px}

    /* ---------- Zone principale ---------- */
    .layout{display:grid;grid-template-columns:clamp(300px,27vw,440px) 1fr clamp(320px,26vw,380px);gap:14px;
      height:clamp(320px,48vh,540px);min-height:300px;flex:0 0 auto}

    /* Avatar (talking head 3D) */
    .avatar{display:flex;flex-direction:column;align-items:stretch;gap:6px;
      padding:8px;position:relative;overflow:hidden}
    .bubble{position:relative;flex:0 0 auto;max-height:5.5em;overflow:auto;
      background:var(--card);color:var(--tx);
      border:1px solid var(--line);border-radius:12px;padding:8px 10px;font-size:12px;line-height:1.3}
    .bubble:after{content:"";position:absolute;bottom:-7px;left:50%;margin-left:-7px;
      border:7px solid transparent;border-top-color:var(--card);border-bottom:0}

    /* Portefeuille 3D */
    .wstage{display:flex;align-items:center;justify-content:center;perspective:900px;
      position:relative;overflow:hidden}
    .wstage:before{content:"";position:absolute;bottom:14%;width:60%;height:26px;
      background:radial-gradient(ellipse,rgba(15,169,125,.28),transparent 70%);filter:blur(6px)}
    .wallet{width:min(360px,82%);aspect-ratio:1.7;position:relative;transform-style:preserve-3d;
      transition:transform .15s;animation:bwIdle 6s ease-in-out infinite}
    @keyframes bwIdle{50%{translate:0 -8px}}
    .body,.flap{position:absolute;inset:0;border-radius:18px}
    .body{background:var(--ai);padding:16px 18px;display:flex;flex-direction:column;
      justify-content:space-between;transform:translateZ(0);
      box-shadow:0 30px 50px -22px rgba(22,26,46,.5),inset 0 0 0 1px rgba(255,255,255,.2)}
    .body:before{content:"";position:absolute;right:-8px;top:42%;width:62px;height:46px;
      border-radius:12px;background:var(--tx);border:1px solid rgba(255,255,255,.25);transform:translateZ(8px)}
    .body:after{content:"";position:absolute;right:10px;top:calc(42% + 17px);width:12px;height:12px;
      border-radius:50%;background:var(--gain);box-shadow:0 0 12px var(--gain)}
    .lbl{font-size:11px;letter-spacing:2px;color:rgba(255,255,255,.72);text-transform:uppercase}
    .wamt{font-size:clamp(26px,4.2vw,44px);font-weight:600;color:#fff;transform:translateZ(30px);
      text-shadow:0 4px 14px rgba(0,0,0,.28)}
    .wname{font-size:13px;color:rgba(255,255,255,.85);white-space:nowrap;overflow:hidden;
      text-overflow:ellipsis;max-width:70%}
    .chips{display:flex;gap:5px;flex-wrap:wrap;transform:translateZ(18px);max-width:78%}
    .wchip{font-size:11px;background:rgba(255,255,255,.18);border-radius:20px;padding:2px 8px;color:#fff}
    .flap{height:34%;bottom:auto;transform-origin:top;transform:translateZ(14px);
      border-radius:18px 18px 0 0;clip-path:polygon(0 0,100% 0,100% 55%,50% 100%,0 55%);
      background:linear-gradient(180deg,color-mix(in srgb,var(--violet) 78%,var(--tx)),
        color-mix(in srgb,var(--blue) 70%,var(--tx)));
      box-shadow:0 6px 14px rgba(22,26,46,.28)}
    .wallet.go{animation:bwSpin 1.6s ease-in-out}
    .wallet.go .flap{animation:bwFlap 1.6s ease-in-out}
    @keyframes bwSpin{0%{transform:rotateY(0)}45%{transform:rotateY(360deg) scale(1.08)}100%{transform:rotateY(360deg)}}
    @keyframes bwFlap{30%,70%{transform:translateZ(14px) rotateX(170deg)}}

    /* Pièces */
    .coins{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3}
    .coins i{position:absolute;width:26px;height:26px;border-radius:50%;left:50%;bottom:30%;
      background:radial-gradient(circle at 30% 30,var(--warn),#B87700);
      border:2px solid #B87700;opacity:0;animation:bwCoin 1.4s ease-out forwards}
    @keyframes bwCoin{0%{opacity:1;transform:translate(0,0)}
      100%{opacity:0;transform:translate(var(--x),-170px) rotate(540deg)}}

    /* Ressources */
    .res{padding:10px;display:flex;flex-direction:column;gap:6px;min-height:0}
    .res h3,.bout h3{margin:0;font-family:"Space Grotesk",sans-serif;font-size:12px;
      letter-spacing:1.5px;text-transform:uppercase;color:var(--tx-2);font-weight:600}
    .rl{display:flex;flex-direction:column;gap:6px;overflow:auto;min-height:0;flex:1}
    .row{position:relative;display:grid;grid-template-columns:1.2fr 62px 1.6fr;gap:6px}
    .row input{padding:7px 9px;font:inherit;font-size:13px;outline:none;min-width:0;
      background:var(--card);border:1px solid var(--line-2);color:var(--tx);border-radius:10px;
      transition:border-color .2s,box-shadow .2s}
    .row input:focus{border-color:var(--violet);box-shadow:0 0 0 3px rgba(124,92,255,.12)}
    .row input.warn{border-color:var(--warn);box-shadow:0 0 0 3px rgba(224,148,11,.14)}
    .row input.q{text-align:center}
    .row input.d{padding-right:30px}
    /* Avertissement, plus refus : la ligne est enregistrée, mais elle sera
       classée « ambiguë » et exclue du calcul tant qu'elle n'est pas reformulée. */
    .rerr{grid-column:1 / -1;color:var(--warn);font-size:12px;margin:0}
    .del{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:20px;height:20px;
      border-radius:6px;border:1px solid var(--line-2);background:var(--card);color:var(--risk);
      display:grid;place-items:center;font-size:11px;line-height:1;opacity:.45;cursor:pointer;
      transition:opacity .2s,background .2s}
    .row:hover .del,.row:focus-within .del{opacity:1}
    .del:hover{background:rgba(232,69,95,.1)}
    .cons{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:6px;
      border-top:1px solid var(--line);max-height:44px;overflow:hidden}
    .cons .lbl{font-size:10.5px;letter-spacing:2px;text-transform:uppercase;color:var(--tx-3)}
    .cc{font-size:11px;padding:3px 9px;border-radius:20px;background:var(--sub);color:var(--tx-2)}
    .cc.hard{background:rgba(232,69,95,.12);color:var(--risk)}

    /* ---------- Bouton unique ---------- */
    .btnrow{display:flex;justify-content:center;flex:0 0 auto}
    .go{border:0;cursor:pointer;color:#fff;font-weight:600;font-size:15px;padding:12px 34px;
      border-radius:999px;background:var(--ai);box-shadow:var(--sh-ai);transition:transform .15s;
      display:inline-flex;align-items:center;gap:10px}
    .go:hover:not(:disabled){transform:translateY(-2px) scale(1.03)}
    .go:disabled{opacity:.6;cursor:wait}
    .go.sm{padding:7px 16px;font-size:12.5px;box-shadow:none}
    .spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.5);
      border-top-color:#fff;animation:bwSp .7s linear infinite}
    @keyframes bwSp{to{transform:rotate(360deg)}}

    /* ---------- Résultats ---------- */
    .bout{flex:1;min-height:0;padding:12px;display:grid;
      grid-template-columns:1.4fr .9fr .9fr .9fr;gap:14px;overflow:hidden}
    .bout .bempty{grid-column:1 / -1;display:flex;align-items:center;justify-content:center;
      color:var(--tx-2);text-align:center;padding:18px}
    .rcol{min-height:0;overflow:auto;font-size:13px;line-height:1.45}
    .it{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:6px 0;
      border-bottom:1px solid var(--line)}
    .it:last-of-type{border-bottom:0}
    .it b{font-weight:600}
    .it .p{color:var(--gain);font-family:"Space Grotesk",sans-serif;font-weight:600;text-align:right}
    /* Recommandation d'achat : lien réel, jamais inventé. */
    .it .lnk{grid-column:1 / -1;display:flex;flex-direction:column;gap:2px;padding-top:3px}
    .offr{display:inline-flex;align-items:center;gap:6px;color:var(--violet);font-size:12px;
      font-weight:600;text-decoration:none;word-break:break-all}
    .offr:hover{text-decoration:underline}
    .nooffr{color:var(--tx-3);font-size:12px;font-style:italic;margin:0}
    .it small{color:var(--tx-2)}
    .tot{font-size:30px;font-weight:600;margin:4px 0}
    .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-weight:600;font-size:12px}
    .badge.ok{background:rgba(15,169,125,.12);color:var(--gain)}
    .badge.ko{background:rgba(232,69,95,.12);color:var(--risk)}
    .sum{margin:10px 0 0}
    .kv{display:flex;justify-content:space-between;gap:10px;padding:6px 0;
      border-bottom:1px solid var(--line);font-size:12.5px;color:var(--tx-2)}
    .kv b{color:var(--tx);font-weight:600}
    .rec{margin-top:10px;padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--sub)}
    .rec b{font-weight:600}
    .adv{margin:6px 0 0;padding-left:18px}
    .adv>li{margin-bottom:10px}
    .adv>li:last-child{margin-bottom:0}
    .chg{margin:5px 0 0;padding-left:16px;font-size:12.5px}
    .chg>li{margin-bottom:4px}
    .chg small{display:block;color:var(--tx-2)}
    .chg a,.adv a{color:var(--blue);text-decoration:underline}
    .confirm{margin-top:6px;padding:10px;border:1px solid var(--warn);border-radius:10px;
      background:rgba(224,148,11,.1)}
    .bacts{display:flex;gap:8px;margin-top:8px}
    .ewarn{margin-top:10px;padding:10px;border:1px solid var(--warn);border-radius:10px;
      background:rgba(224,148,11,.1);font-size:12.5px}
    .draft{margin-top:8px}

    /* ---------- Transparence recherche web ---------- */
    .sinfo{margin-top:10px;padding:8px 10px;border:1px dashed var(--line-2);border-radius:10px;
      color:var(--tx-3);font-size:11.5px;line-height:1.4}

    /* ---------- Ressources ambiguës ---------- */
    .amb{display:flex;flex-direction:column;gap:8px;margin-top:8px}
    .ambrow{padding:8px 10px;border:1px dashed var(--warn);border-radius:10px;
      background:rgba(224,148,11,.07)}
    .ambrow .top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
    .ambrow b{font-weight:600;word-break:break-word}
    .ambrow .qty{color:var(--tx-2);font-size:12px;white-space:nowrap}
    .ambrow p{margin:4px 0 0;color:var(--tx-2);font-size:12px;line-height:1.4}
    .ambrow .fix{margin-top:5px;color:var(--tx-3);font-size:11.5px}
    .ambnone{color:var(--tx-2);font-size:12.5px;margin:6px 0 0}

    /* ---------- Toast ---------- */
    .btoast{position:fixed;left:50%;top:72px;transform:translate(-50%,-140%);z-index:200;
      display:flex;align-items:center;gap:14px;background:var(--card);color:var(--risk);
      border-left:5px solid var(--risk);border-radius:12px;padding:12px 18px;font-weight:600;
      font-size:14px;box-shadow:var(--sh);max-width:92vw;
      animation:bwTin .35s var(--ease) forwards}
    @keyframes bwTin{to{transform:translate(-50%,0)}}
    .btoast button{border:0;background:none;color:var(--risk);cursor:pointer;font-size:15px}

    /* ---------- Responsive ---------- */
    @media (max-width:860px){
      .layout{grid-template-columns:1fr;height:auto}
      .avatar{display:none}
      .wstage{min-height:200px}
      .bout{grid-template-columns:1fr;overflow:visible}
      .rcol{overflow:visible}
      .hdr input.ro.ev{flex:1 1 100%}
    }
  `]
})
export class BudgetDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(BudgetService);
  private readonly http = inject(HttpClient);

  eventId = '';
  private analyzeOnLoad = false;
  load: Load = 'loading';
  loadError = '';
  summary: BudgetSummary | null = null;
  constraints: ConstraintAgg[] = [];

  rows: ResourceRow[] = [];
  private removedIds: string[] = [];
  private initialItemIds = new Set<string>();

  aiState: AiState = 'idle';
  aiError = '';
  analysis: AiAnalysis | null = null;
  pending: AiScenario | null = null;
  draftNotice = '';
  validationBanner = '';
  saveError = '';

  /** Inclinaison du portefeuille qui suit la souris (purement visuel). */
  tilt = '';

  /** Pièces volantes pendant l'analyse (purement visuel). */
  readonly coinsArr = Array.from({ length: 14 }, () => ({
    x: `${Math.round(Math.random() * 240 - 120)}px`,
    d: `${(Math.random() * 0.6).toFixed(2)}s`
  }));

  ngOnInit(): void {
    this.eventId = this.route.snapshot.paramMap.get('eventId') || '';
    this.analyzeOnLoad = this.route.snapshot.queryParamMap.get('analyze') === 'true';
    this.refresh();
  }

  // ---- Indicateurs dérivés ------------------------------------------------

  get budget(): number {
    return Number(this.summary?.budget) || 0;
  }

  get budgetAvailable(): boolean {
    const status = this.aiState === 'ok'
      ? this.analysis?.status
      : this.summary?.status;
    return status !== 'budget_missing' && this.budget > 0;
  }

  get budgetLabel(): string {
    return this.budgetAvailable ? this.eur(this.budget) : 'Non défini';
  }

  /**
   * Écriture unique des montants de la page : deux décimales, séparateur
   * français. Une seule convention évite qu'un arrondi affiché (« 13 € »)
   * contredise le total exact (« 12,50 € »).
   */
  private eur(value: number | null | undefined): string {
    return `${Number(value || 0).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} €`;
  }

  get budgetStatusText(): string {
    if (!this.budgetAvailable) return 'Budget non défini';
    if (!this.pricedCount) return 'Aucun poste chiffré';
    if (this.over) return `Dépassement certain de ${this.eur(this.absRemaining)}`;
    if (this.analysis?.incomplete) {
      return `Total partiel · reste maximal ${this.eur(this.absRemaining)}`;
    }
    if (this.remaining === 0) return 'Budget exactement consommé';
    return `Dans le budget · reste ${this.eur(this.absRemaining)}`;
  }

  get displayTotal(): number {
    const analyse = this.analysis?.computed?.total_expenses;
    if (this.aiState === 'ok' && analyse != null) return Number(analyse);
    return Number(this.summary?.total_expenses) || 0;
  }

  get pricedCount(): number {
    return Number(
      this.analysis?.computed?.priced_count ??
      this.analysis?.priced_count ??
      this.summary?.priced_count ??
      (this.aiState === 'ok' && this.analysis ? (this.understoodItems.filter(i => !!i.total).length) : 0)
    ) || 0;
  }

  /**
   * Chiffres distincts calculés par le backend : budget maximal, coût estimé
   * initial, reste/dépassement, économies possibles, coût des améliorations et
   * coût final. `null` tant qu'aucune analyse n'a été reçue.
   */
  get figures(): AiFigures | null {
    return this.analysis?.figures || this.analysis?.computed?.figures || null;
  }

  get remaining(): number {
    const value = this.aiState === 'ok'
      ? this.analysis?.computed?.remaining_budget
      : this.summary?.remaining_budget;
    return value == null ? 0 : Number(value);
  }

  get over(): boolean {
    const status = this.aiState === 'ok'
      ? this.analysis?.status
      : this.summary?.status;
    return status === 'over_budget';
  }

  get absRemaining(): number {
    return Math.abs(this.remaining);
  }

  get busy(): boolean {
    return this.aiState === 'thinking';
  }

  /**
   * Ressources comprises : chiffrées **ou** comprises mais non chiffrées.
   * Seules les ressources ambiguës en sont absentes. Les non chiffrées
   * apparaissent quand même ici, car leur page fournisseur réelle reste utile.
   */
  get understoodItems(): BudgetItem[] {
    return (this.analysis?.items || []).filter((item) => !item.is_ambiguous);
  }

  /** Ressources comprises que l'IA n'a pas osées chiffrer. */
  get unpriced(): UnpricedResource[] {
    return this.analysis?.unpriced || [];
  }

  /** Ressources écartées de l'analyse, avec la raison à afficher. */
  get ambiguous(): AmbiguousResource[] {
    return this.analysis?.ambiguous || [];
  }

  /** Lignes strictement identiques signalées par le backend (jamais fusionnées). */
  get duplicates(): DuplicateGroup[] {
    return this.analysis?.duplicates || [];
  }

  /**
   * Message affiché quand aucune ressource n'est ambiguë. Il ne doit **jamais**
   * affirmer que tout est chiffré tant que des ressources restent non chiffrées
   * ou en échec : être « comprise » et être « chiffrée » sont deux états
   * indépendants.
   */
  get emptyAmbiguousText(): string {
    const items = this.analysis?.items || [];
    const failed = items.filter(
      (item) => item.analysis_status === 'analysis_failed'
        || item.analysis_status === 'search_unavailable'
    ).length;
    const unpricedCount = this.unpriced.length;
    if (!failed && !unpricedCount) {
      return 'Aucune : toutes les ressources ont été comprises et chiffrées.';
    }
    const parts: string[] = [];
    if (unpricedCount) {
      parts.push(`${unpricedCount} ressource${unpricedCount > 1 ? 's' : ''} `
        + `comprise${unpricedCount > 1 ? 's' : ''} mais non chiffrée${unpricedCount > 1 ? 's' : ''}`);
    }
    if (failed) {
      parts.push(`${failed} ressource${failed > 1 ? 's' : ''} en échec d'analyse`);
    }
    return `Aucune ressource ambiguë, mais ${parts.join(' et ')} : `
      + 'la compréhension et la tarification sont deux états distincts.';
  }

  /** Suppressions staged à persister au prochain traitement. */
  get hasPendingDelete(): boolean {
    return this.removedIds.length > 0;
  }

  /** Message d'erreur affiché en toast (validation ou échec d'enregistrement). */
  get toastMsg(): string {
    return this.validationBanner || this.saveError;
  }

  dismissToast(): void {
    this.validationBanner = '';
    this.saveError = '';
  }

  /** Noms des ressources affichés dans le portefeuille (maquette). */
  get walletChips(): string[] {
    const names = this.rows.map((r) => (r.name || '').trim()).filter(Boolean);
    const head = names.slice(0, 4);
    return names.length > 4 ? [...head, `+${names.length - 4}`] : head;
  }

  /** Lignes réellement saisies (ignore les lignes totalement vides). */
  get activeRows(): ResourceRow[] {
    return this.rows.filter(
      (r) => !!r.id || !!(r.name && r.name.trim()) || !!(r.description && r.description.trim())
    );
  }

  get assistantLine(): string {
    switch (this.aiState) {
      case 'thinking':
        return 'Je réfléchis à tes prix… 🧮';
      case 'unavailable':
        return 'Assistant indisponible — aucun résultat simulé.';
      case 'ok':
        if (this.analysis?.status === 'budget_missing') {
          return 'Le budget de cet événement n’est pas défini.';
        }
        if (this.analysis?.incomplete) {
          return 'Le total est incomplet : certaines ressources restent à préciser ou à chiffrer.';
        }
        if (this.ambiguous.length) {
          const plural = this.ambiguous.length > 1 ? 's' : '';
          return `${this.ambiguous.length} ressource${plural} non comprise${plural}`
            + ' — reformule leur nom pour que je puisse les chiffrer.';
        }
        return this.over
          ? 'On va optimiser ça ensemble ! Voir les alternatives.'
          : 'Super, tu es dans le budget ! Voir les améliorations.';
      default:
        return 'Bonjour ! Vérifie tes ressources puis lance l’analyse.';
    }
  }

  /** Humeur de l'avatar 3D, alignée sur l'état de l'analyse (purement visuel). */
  get avatarMood(): string {
    switch (this.aiState) {
      case 'ok':
        return this.over || this.analysis?.status === 'budget_missing' ? 'sad' : 'happy';
      case 'unavailable':
        return 'sad';
      default:
        return 'neutral';
    }
  }

  // ---- Interactions visuelles --------------------------------------------

  /** Tilt du portefeuille qui suit la souris (désactivé pendant l'analyse). */
  onTilt(event: MouseEvent): void {
    if (this.busy) {
      this.tilt = '';
      return;
    }
    if (typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const el = event.currentTarget as HTMLElement | null;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const x = (event.clientX - b.left) / b.width - 0.5;
    const y = (event.clientY - b.top) / b.height - 0.5;
    this.tilt = `rotateY(${(x * 38).toFixed(1)}deg) rotateX(${(-y * 28).toFixed(1)}deg)`;
  }

  resetTilt(): void {
    this.tilt = '';
  }

  // ---- Chargement ---------------------------------------------------------

  refresh(): void {
    if (!this.eventId) {
      this.loadError = 'Identifiant événement manquant dans l’URL.';
      this.load = 'error';
      return;
    }
    this.load = 'loading';
    this.loadError = '';
    let summaryError: HttpErrorResponse | null = null;
    let itemsError: HttpErrorResponse | null = null;
    forkJoin({
      summary: this.api.getSummary(this.eventId).pipe(
        catchError((error: HttpErrorResponse) => {
          summaryError = error;
          return of(null);
        })
      ),
      items: this.api.listItems(this.eventId).pipe(
        catchError((error: HttpErrorResponse) => {
          itemsError = error;
          return of([] as BudgetItem[]);
        })
      )
    }).subscribe({
      next: ({ summary, items }) => {
        if (!summary) {
          this.loadError = this.describeLoadError(summaryError, 'le résumé du budget');
          this.load = 'error';
          return;
        }
        if (itemsError) {
          this.loadError = this.describeLoadError(itemsError, 'les ressources du budget');
          this.load = 'error';
          return;
        }
        this.summary = summary;
        this.rows = items.map((it) => ({
          id: it.id,
          name: it.name,
          quantity: Number(it.quantity) || 1,
          description: it.description || ''
        }));
        this.initialItemIds = new Set(items.map((it) => it.id));
        this.removedIds = [];
        this.ensureTrailingRow();
        this.load = 'ok';
        this.loadConstraints();
        if (this.analyzeOnLoad && this.activeRows.length) {
          this.analyzeOnLoad = false;
          this.runAnalysis();
        }
      },
      error: () => {
        this.loadError = 'Impossible de charger les données du budget.';
        this.load = 'error';
      }
    });
  }

  private describeLoadError(error: HttpErrorResponse | null, resource: string): string {
    if (!error) return `Impossible de charger ${resource}.`;
    if (error.status === 0) {
      return 'Le serveur backend est inaccessible. Vérifiez que Django est démarré.';
    }
    if (error.status === 403) {
      return 'Vous n’avez pas accès à cet événement.';
    }
    if (error.status === 404) {
      return 'Cet événement est introuvable ou l’identifiant est invalide.';
    }
    return `Impossible de charger ${resource} (erreur ${error.status}).`;
  }

  // ---- Édition des lignes -------------------------------------------------

  addRow(): void {
    if (this.rows.length >= MAX_ROWS) return;
    this.rows.push({ name: '', quantity: 1, description: '' });
    this.validationBanner = '';
  }

  /** Maquette : une ligne vide reste toujours disponible en fin de liste. */
  private ensureTrailingRow(): void {
    const last = this.rows[this.rows.length - 1];
    const hasContent = !!last
      && (!!(last.name && last.name.trim()) || !!(last.description && last.description.trim()));
    if (!last || hasContent) this.addRow();
  }

  onNameChange(row: ResourceRow): void {
    this.clearRowWarn(row);
    this.ensureTrailingRow();
  }

  removeRow(index: number): void {
    const [row] = this.rows.splice(index, 1);
    if (row?.id) this.removedIds.push(row.id);
    this.validationBanner = '';
    this.ensureTrailingRow();
  }

  clearRowWarn(row: ResourceRow): void {
    row.warn = '';
    if (this.rows.every((r) => !r.warn)) this.validationBanner = '';
  }

  // ---- Action unique ------------------------------------------------------

  runAnalysis(): void {
    if (this.busy) return;

    const rows = this.activeRows;
    this.saveError = '';
    this.validationBanner = '';
    this.draftNotice = '';

    if (!rows.length) {
      if (this.hasPendingDelete) {
        // Rien à analyser : on persiste uniquement les suppressions staged.
        this.persist(rows).subscribe({
          next: () => {
            this.removedIds = [];
            this.refresh();
          },
          error: () => {
            this.saveError = 'Impossible d’enregistrer les suppressions.';
          }
        });
      } else {
        this.saveError = 'Ajoutez au moins une ressource avant de lancer l’analyse.';
        this.aiState = 'idle';
      }
      return;
    }

    // 1) Avertissement sur les noms vagues — ce n'est **plus** un refus : la
    //    ligne est enregistrée, puis l'IA la classe « ambiguë » avec la même
    //    raison et l'exclut du calcul. C'est en la voyant dans le tableau
    //    « Ressources ambiguës » que l'organisateur décide de reformuler.
    for (const row of rows) {
      row.warn = validateResourceName(row.name) || '';
    }

    // 2) Sauvegarde en base, puis 3) compréhension + recherche web + analyse.
    this.aiState = 'thinking';
    this.analysis = null;
    this.tilt = '';

    this.persist(rows)
      .pipe(switchMap(() => this.api.analyze(this.eventId)))
      .subscribe({
        next: (res: any) => this.onAnalysis(res),
        error: (err) => this.onAnalysisError(err)
      });
  }

  private persist(rows: ResourceRow[]): Observable<unknown> {
    const calls: Observable<unknown>[] = [];

    for (const id of this.removedIds) {
      if (this.initialItemIds.has(id)) calls.push(this.api.deleteItem(id, this.eventId));
    }

    for (const row of rows) {
      const payload = {
        event: this.eventId,
        name: row.name.trim(),
        quantity: Number(row.quantity) > 0 ? Number(row.quantity) : 1,
        description: (row.description || '').trim()
      };
      if (row.id) {
        calls.push(this.api.updateItem(row.id, this.eventId, {
          name: payload.name,
          quantity: payload.quantity,
          description: payload.description
        }));
      } else {
        calls.push(this.api.createItem(payload));
      }
    }

    return calls.length ? forkJoin(calls) : of([]);
  }

  private onAnalysis(res: any): void {
    if (res && res.status === 'unavailable') {
      this.aiError = res.error || 'IA indisponible.';
      this.aiState = 'unavailable';
      return;
    }
    this.analysis = res as AiAnalysis;
    this.aiState = 'ok';
    this.removedIds = [];
    this.pending = null;

    // On resynchronise les lignes sur l'état réellement enregistré.
    if (this.analysis?.items?.length) {
      this.rows = this.analysis.items.map((it) => ({
        id: it.id,
        name: it.name,
        quantity: Number(it.quantity) || 1,
        description: it.description || ''
      }));
      this.initialItemIds = new Set(this.analysis.items.map((it) => it.id));
    }
    this.ensureTrailingRow();
    this.refreshSummaryOnly();
  }

  private onAnalysisError(err: any): void {
    const status = err?.status;
    const backendMessage = this.extractErrorMessage(err);
    if (status === 400 && err?.error?.error === 'validation' && Array.isArray(err.error.invalid)) {
      this.aiState = 'idle';
      this.validationBanner = INVALID_NAME_MESSAGE;
      const invalidById = new Map<string, string>(
        err.error.invalid.map((x: any) => [String(x.id), String(x.message)])
      );
      const invalidByName = new Map<string, string>(
        err.error.invalid.map((x: any) => [this.norm(String(x.name)), String(x.message)])
      );
      for (const row of this.rows) {
        const byId = row.id ? invalidById.get(row.id) : undefined;
        const byName = invalidByName.get(this.norm(row.name));
        row.warn = byId || byName || row.warn;
      }
      return;
    }
    if (status === 503) {
      this.aiError = backendMessage || 'IA indisponible.';
      this.aiState = 'unavailable';
      return;
    }
    if (status === 400) {
      this.aiState = 'idle';
      this.saveError = backendMessage || 'Requête invalide.';
      return;
    }
    // Erreur non imputable à l'IA (réseau, serveur) : on ne la présente pas
    // comme une indisponibilité de l'assistant, pour rester honnête.
    this.aiState = 'idle';
    this.saveError = status === 0
      ? 'Le serveur backend est injoignable. Vérifiez qu’il tourne (port 8000).'
      : backendMessage || `Erreur lors de l’analyse (HTTP ${status}).`;
  }

  private extractErrorMessage(error: any): string {
    const payload = error?.error;
    if (typeof payload === 'string' && payload.trim()) {
      return payload.trim().slice(0, 500);
    }
    if (payload && typeof payload === 'object') {
      const message = payload.error || payload.detail || payload.message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim().slice(0, 500);
      }
    }
    return '';
  }

  private refreshSummaryOnly(): void {
    this.api.getSummary(this.eventId).subscribe({
      next: (s) => (this.summary = s),
      error: () => {}
    });
  }

  // ---- Scénarios (alternatives) ------------------------------------------

  scenarioImpact(scenario: AiScenario): string {
    const total = Number(scenario.new_total) || 0;
    if (this.budget <= 0) return '';
    const delta = this.budget - total;
    return delta >= 0
      ? `revient dans le budget (marge ${Math.round(delta)} €)`
      : `reste au-dessus de ${Math.round(-delta)} €`;
  }

  recommendationImpact(cost: number): string {
    const after = this.remaining - (Number(cost) || 0);
    return after >= 0
      ? `reste ${Math.round(after)} € après`
      : `dépasserait de ${Math.round(-after)} €`;
  }

  /** Libellé honnête de l'origine d'un coût de suggestion. */
  costSourceLabel(source: 'ai_estimate' | 'real_offer' | null | undefined): string {
    if (source === 'real_offer') return 'tarif fournisseur relevé';
    if (source === 'ai_estimate') return 'estimation IA';
    return 'coût non vérifié';
  }

  /** Valeur absolue, pour afficher un « reste » ou un « dépassement » positif. */
  abs(value: number | null | undefined): number {
    return Math.abs(Number(value) || 0);
  }

  askApply(scenario: AiScenario): void {
    this.pending = scenario;
  }

  /** Reporte les quantités d'une alternative dans les lignes (UI uniquement). */
  applyScenario(scenario: AiScenario): void {
    // Seules les ressources comprises et chiffrées sont concernées : l'IA ne
    // propose jamais de changement sur une ressource ambiguë ou non chiffrée.
    const items = this.understoodItems.filter((item) => item.total != null);
    for (const change of scenario.changes || []) {
      const item = items.find((it) => String(it.id) === String(change.expense_id));
      const row = item ? this.rows.find((r) => r.id === String(item.id)) : undefined;
      if (!row || !item || !item.unit_price) continue;
      // La quantité recalculée par le backend prime ; à défaut on retombe sur
      // la division du nouveau coût par le prix unitaire déjà validé.
      const newQty = change.new_quantity != null
        ? Math.max(1, Math.round(Number(change.new_quantity)))
        : Math.max(1, Math.round(Number(change.new_cost) / Number(item.unit_price)));
      row.quantity = newQty;
    }
    this.pending = null;
    this.draftNotice =
      'Quantités reportées dans vos ressources. Relancez « Analyse IA » pour recalculer le budget.';
  }

  // ---- Contraintes alimentaires (agrégat, sans données nominatives) -------

  private loadConstraints(): void {
    forkJoin({
      links: this.http.get<any[]>(`/api/event-participants/?event=${this.eventId}`).pipe(catchError(() => of([]))),
      people: this.http.get<any[]>('/api/participants/').pipe(catchError(() => of([])))
    }).subscribe({
      next: ({ links, people }) => {
        const ids = new Set((links || []).map((l) => l.participant));
        const agg = new Map<string, ConstraintAgg>();
        (people || []).forEach((p) => {
          if (!ids.has(p.id)) return;
          (p.constraints || []).forEach((c: any) => {
            const key = String(c.value || '').toLowerCase();
            if (!key) return;
            const cur = agg.get(key) || { value: c.value, count: 0, isHard: false };
            cur.count += 1;
            cur.isHard = cur.isHard || !!c.is_hard;
            agg.set(key, cur);
          });
        });
        this.constraints = Array.from(agg.values()).sort((a, b) => b.count - a.count);
      },
      error: () => {}
    });
  }

  private norm(value: string): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
