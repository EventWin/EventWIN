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

/** Réponse de ``/api/sponsorship-net-budget/`` (module Sponsors). */
interface SponsorFunding {
  currency: string;
  planned_cost: number;
  confirmed_sponsorship: number;
  weighted_sponsorship: number;
  best_case_sponsorship: number;
  net_pessimistic: number;
  net_weighted: number;
}

/** Besoins des participants inscrits, regroupés par type de contrainte. */
interface ConstraintGroup {
  type: string;
  people: number;
  hard: boolean;
  values: { value: string; count: number; hard: boolean }[];
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
 * `--risk`, `--ai`, Plus Jakarta Sans + Fraunces). Aucune variable de couleur nouvelle
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
    <div class="card state-card" *ngIf="load === 'loading'">
      <div class="skeleton" style="height:22px;width:40%"></div>
      <div class="skeleton" style="height:260px"></div>
    </div>
    <div class="card state-card err" *ngIf="load === 'error'">
      <h3>{{ loadError || 'Impossible de charger le budget.' }}</h3>
      <small *ngIf="eventId" class="mut">Identifiant événement : {{ eventId }}</small>
      <a class="btn btn-sm" routerLink="/app/budgets">Retour aux budgets</a>
    </div>

    <ng-container *ngIf="load === 'ok' && summary">
      <!-- ================= En-tête ================= -->
      <header class="bhead">
        <div class="bhead-main">
          <a class="back" routerLink="/app/budgets">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
            Tous les budgets
          </a>
          <h1 class="title" [title]="summary.event.name">{{ summary.event.name }}</h1>
          <div class="meta">
            <span>{{ summary.event.event_type_label }}</span>
            <span *ngIf="summary.event.location">{{ summary.event.location }}</span>
            <span>{{ summary.event.participants }} participants attendus</span>
          </div>
        </div>
        <div class="bhead-side">
          <span class="st"
            [class.ok]="aiState === 'ok' && !over"
            [class.ko]="(aiState === 'ok' && over) || aiState === 'unavailable'"
            [class.wait]="aiState === 'thinking'">
            <i></i>
            {{ aiState === 'thinking' ? 'Analyse en cours'
               : aiState === 'unavailable' ? 'IA indisponible'
               : aiState === 'ok' ? (over ? 'Dépassement' : 'Budget respecté')
               : 'En attente d’analyse' }}
          </span>
          <button class="btn btn-ai" type="button" (click)="runAnalysis()"
            [disabled]="busy || (!activeRows.length && !hasPendingDelete)">
            <span class="spin" *ngIf="busy" aria-hidden="true"></span>
            <svg *ngIf="!busy" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z"/></svg>
            {{ busy ? 'Analyse en cours…' : 'Lancer l’analyse IA' }}
          </button>
        </div>
      </header>

      <!-- ================= Zone principale ================= -->
      <div class="layout">
        <!-- Assistant 3D (TalkingHead) -->
        <section class="card avatar" [class.busy]="busy" aria-label="Assistant budget">
          <div class="card-top">
            <h3>Assistant budget</h3>
            <span class="presence" [class.on]="busy">{{ busy ? 'réfléchit…' : 'en ligne' }}</span>
          </div>
          <div class="avatar-stage">
            <app-budget-avatar-head [mood]="avatarMood"></app-budget-avatar-head>
          </div>
          <div class="bubble" role="status" aria-live="polite">{{ assistantLine }}</div>
        </section>

        <!-- Portefeuille 3D -->
        <section class="card wcard" aria-label="Budget de l’événement">
          <div class="card-top">
            <h3>Budget de l’événement</h3>
            <span class="hint">issu de la fiche événement</span>
          </div>
          <div class="wstage" (mousemove)="onTilt($event)" (mouseleave)="resetTilt()">
            <div class="wallet" [class.go]="busy" [style.transform]="tilt">
              <div class="body">
                <div class="lbl">Budget maximal</div>
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
          <div class="wkpis">
            <div>
              <span>Coût estimé</span>
              <b class="n">{{ aiState !== 'thinking' && pricedCount > 0 ? ((displayTotal | number:'1.0-0') + ' €') : '—' }}</b>
            </div>
            <div>
              <span>{{ remainingValue != null && remainingValue < 0 ? 'Dépassement' : 'Reste' }}</span>
              <b class="n" [class.neg]="remainingValue != null && remainingValue < 0">{{ remainingLabel }}</b>
            </div>
            <div>
              <span>Postes saisis</span>
              <b class="n">{{ activeRows.length }}</b>
            </div>
          </div>
        </section>

        <!-- Ressources -->
        <section class="card res" aria-label="Ressources de l’événement">
          <div class="card-top">
            <h3>Ressources</h3>
            <span class="hint">nom, quantité, description — l’IA chiffre</span>
          </div>
          <div class="rhead" aria-hidden="true"><span>Ressource</span><span>Qté</span><span>Description</span><span></span></div>
          <div class="rl">
            <div class="row" *ngFor="let r of rows; let i = index" [class.warn]="r.warn">
              <input class="in nm" [class.warn]="r.warn" [(ngModel)]="r.name"
                (ngModelChange)="onNameChange(r)"
                placeholder="ex. Sonorisation" aria-label="Nom de la ressource" [title]="r.name || ''">
              <input class="in q" type="number" min="1" step="1" [(ngModel)]="r.quantity"
                placeholder="1" aria-label="Quantité">
              <input class="in d" [(ngModel)]="r.description"
                placeholder="Facultatif" aria-label="Description" [title]="r.description || ''">
              <button class="del" type="button" title="Supprimer la ligne"
                aria-label="Supprimer la ligne" (click)="removeRow(i)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
              <p class="rerr" *ngIf="r.warn">{{ r.warn }}</p>
            </div>
          </div>
        </section>
      </div>

      <!-- ================= Financement sponsors ================= -->
      <section class="card funding" *ngIf="sponsoring as sp" aria-label="Financement sponsors">
        <div class="card-top">
          <h3>Financement sponsors</h3>
          <span class="hint">le sponsoring réduit le coût restant à financer</span>
          <a class="link fund-link" routerLink="/app/sponsors/pipeline">Gérer les sponsors →</a>
        </div>
        <div class="fund-grid">
          <div><span>Confirmé</span><b class="n pos">{{ sp.confirmed_sponsorship | number:'1.0-0' }} €</b><small>deals signés ou payés</small></div>
          <div><span>Pipeline pondéré</span><b class="n">{{ sp.weighted_sponsorship | number:'1.0-0' }} €</b><small>montant × probabilité</small></div>
          <div><span>Coût estimé</span><b class="n">{{ sp.planned_cost | number:'1.0-0' }} €</b><small>ressources chiffrées</small></div>
          <div class="net">
            <span>{{ sp.net_pessimistic < 0 ? 'Excédent après sponsoring' : 'Coût net à financer' }}</span>
            <b class="n" [class.pos]="sp.net_pessimistic <= 0">{{ abs(sp.net_pessimistic) | number:'1.0-0' }} €</b>
            <small>coût estimé − sponsoring confirmé</small>
          </div>
        </div>
        <div class="fund-bar" *ngIf="sp.planned_cost > 0" [title]="sponsorCoverage + ' % du coût couvert par le sponsoring confirmé'">
          <i [style.width.%]="sponsorCoverage"></i>
        </div>
        <p class="mut mini" *ngIf="sp.planned_cost > 0">{{ sponsorCoverage }} % du coût estimé couvert par le sponsoring confirmé.</p>
        <p class="mut mini" *ngIf="!sp.planned_cost">Lancez l’analyse IA pour chiffrer les ressources : le coût net sera calculé automatiquement.</p>
      </section>

      <!-- ================= Besoins des participants ================= -->
      <section class="card needs" aria-label="Besoins des participants inscrits">
        <div class="card-top">
          <h3>Besoins des participants inscrits</h3>
          <span class="hint">{{ registeredCount }} inscrit(s) · à prévoir dans les ressources</span>
        </div>
        <div class="needs-grid" *ngIf="constraints.length; else noNeeds">
          <article class="need" *ngFor="let g of constraints" [class.hard]="g.hard">
            <div class="need-head">
              <b>{{ g.type }}</b>
              <span class="tag" *ngIf="g.hard">Impératif</span>
            </div>
            <small class="count n">{{ g.people }} participant{{ g.people > 1 ? 's' : '' }} concerné{{ g.people > 1 ? 's' : '' }}</small>
            <ul>
              <li *ngFor="let v of g.values" [class.soft]="!v.hard" [title]="v.hard ? 'Contrainte stricte' : 'Contrainte souple'">
                <i aria-hidden="true"></i>
                <span>{{ v.value }}</span>
                <small *ngIf="v.count > 1" class="n">× {{ v.count }}</small>
              </li>
            </ul>
          </article>
        </div>
        <ng-template #noNeeds>
          <p class="mut mini">{{ registeredCount ? 'Aucune contrainte déclarée par les participants inscrits.' : 'Aucun participant inscrit pour l’instant.' }}</p>
        </ng-template>
      </section>

      <!-- ================= Résultats ================= -->
      <section class="card bout" *ngIf="aiState !== 'idle'" aria-label="Résultats de l’analyse">
        <div class="bempty" *ngIf="aiState === 'thinking'"><span class="spin dark"></span> L’IA analyse votre événement : compréhension, recherche de fournisseurs, calcul…</div>

        <div class="bempty" *ngIf="aiState === 'unavailable'">
          <span>
            <b>{{ aiError }}</b><br>
            <small class="mut">Vos ressources sont enregistrées. Aucun résultat n’est simulé —
              relancez l’analyse dès que l’assistant est disponible.</small>
          </span>
        </div>

        <ng-container *ngIf="aiState === 'ok' && analysis">
          <!-- Colonne 1 : ressources comprises & prix estimés -->
          <div class="rcol c-res">
            <h3>Ressources &amp; prix estimés</h3>

            <p class="mini mut" *ngIf="!understoodItems.length">
              Aucune ressource n’a pu être comprise : elles sont toutes détaillées
              dans « Ressources ambiguës ».
            </p>

            <div class="it" *ngFor="let it of understoodItems">
              <div><b>{{ it.name }}</b> <small>× {{ it.quantity | number:'1.0-2' }}</small></div>

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
                  {{ it.offer_domain || it.provider || 'Voir la page produit' }} ↗
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
                <span><b>{{ it.name }}</b> <small>× {{ it.quantity | number:'1.0-2' }}</small></span>
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
                <span><b>{{ d.name }}</b> <small>× {{ d.quantity | number:'1.0-2' }}</small></span>
                <span class="mut">{{ d.count }} lignes identiques</span>
              </div>
            </div>

          </div>

          <!-- Colonne 2 : budget total -->
          <div class="rcol c-tot">
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

            <div class="kv" *ngIf="!(figures && pricedCount > 0)"><span>Budget maximal</span><b class="n">{{ budgetLabel }}</b></div>
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
          <div class="rcol c-adv">
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
          <div class="rcol c-amb">
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
                  <span class="qty n">× {{ a.quantity | number:'1.0-2' }}</span>
                </div>
                <p>{{ a.reason }}</p>
                <p class="fix">Reformulez ce nom dans « Ressources de l’événement »,
                  puis relancez « Analyse IA » pour l’inclure.</p>
              </div>
            </div>
          </div>
        </ng-container>
      </section>
    </ng-container>

    <!-- ================= Toast ================= -->
    <div class="btoast" *ngIf="toastMsg">
      <span>{{ toastMsg }}</span>
      <button type="button" (click)="dismissToast()" aria-label="Fermer">✕</button>
    </div>
  `,
  styles: [`
    /* Page « Budget de l'événement » — alignée sur le système visuel de
       l'application (cartes, jetons de couleur, typographies globales).
       Classes locales et @keyframes préfixés bw* : pas de collision avec
       les styles globaux. */
    :host{display:block;color:var(--tx)}
    .mut{color:var(--tx-2)}
    .mini{font-size:12px}
    .pos{color:var(--gain)}
    .n{font-variant-numeric:tabular-nums}
    .card{padding:18px 20px}
    .state-card{display:grid;gap:14px}
    .state-card.err{justify-items:start}
    .card-top{display:flex;align-items:baseline;gap:10px;margin-bottom:12px;flex-wrap:wrap}
    .card-top h3{font-size:14.5px;font-weight:700}
    .hint{font-size:12px;color:var(--tx-3)}

    /* ---------- En-tête ---------- */
    .bhead{display:flex;align-items:flex-end;gap:20px;flex-wrap:wrap;margin-bottom:20px}
    .bhead-main{min-width:0;flex:1 1 420px}
    .back{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:600;color:var(--tx-3);margin-bottom:8px}
    .back:hover{color:var(--violet)}
    .back svg{width:14px;height:14px}
    .bhead .title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .meta{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:8px;font-size:13px;color:var(--tx-2)}
    .meta span+span{position:relative}
    .meta span+span::before{content:"";position:absolute;left:-9px;top:50%;width:3px;height:3px;border-radius:50%;background:var(--tx-3)}
    .bhead-side{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .st{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:20px;
      font-size:12.5px;font-weight:600;background:var(--sub);color:var(--tx-2);white-space:nowrap}
    .st i{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.7}
    .st.ok{background:rgba(18,147,110,.11);color:var(--gain)}
    .st.ko{background:rgba(217,63,90,.11);color:var(--risk)}
    .st.wait{background:var(--accent-soft);color:var(--violet)}
    .st.wait i{animation:bwBlink 1s infinite}
    @keyframes bwBlink{50%{opacity:.15}}
    .spin{width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.45);
      border-top-color:#fff;animation:bwSp .7s linear infinite;flex:none}
    .spin.dark{border-color:var(--line-2);border-top-color:var(--violet)}
    @keyframes bwSp{to{transform:rotate(360deg)}}

    /* ---------- Zone principale ---------- */
    .layout{display:grid;grid-template-columns:minmax(260px,.95fr) minmax(300px,1.1fr) minmax(340px,1.2fr);
      gap:16px;align-items:stretch}
    .layout>.card{display:flex;flex-direction:column;min-width:0;height:460px}

    /* Assistant 3D */
    .avatar{position:relative;overflow:hidden;padding-bottom:16px;
      background:linear-gradient(180deg,var(--card) 0%,var(--card) 55%,var(--sub) 100%)}
    .presence{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--gain)}
    .presence::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
    .presence.on{color:var(--violet)}
    .presence.on::before{animation:bwBlink 1s infinite}
    .avatar-stage{position:relative;flex:1 1 auto;min-height:0;display:flex;margin:0 -20px}
    .bubble{position:relative;margin-top:-8px;background:var(--card);color:var(--tx);
      border:1px solid var(--line);border-radius:14px;padding:10px 13px;font-size:13px;line-height:1.45;
      box-shadow:var(--sh);max-height:6.2em;overflow:auto}
    .bubble::before{content:"";position:absolute;top:-7px;left:50%;width:12px;height:12px;margin-left:-6px;
      background:var(--card);border-left:1px solid var(--line);border-top:1px solid var(--line);transform:rotate(45deg)}
    .avatar.busy .bubble{border-color:color-mix(in srgb,var(--violet) 45%,var(--line))}

    /* Portefeuille 3D */
    .wcard{overflow:hidden}
    .wstage{position:relative;flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;perspective:900px}
    .wstage::before{content:"";position:absolute;bottom:10%;width:62%;height:26px;
      background:radial-gradient(ellipse,rgba(91,79,224,.22),transparent 70%);filter:blur(6px)}
    .wallet{width:min(330px,88%);aspect-ratio:1.62;position:relative;transform-style:preserve-3d;
      transition:transform .15s;animation:bwIdle 6s ease-in-out infinite}
    @keyframes bwIdle{50%{translate:0 -7px}}
    .body,.flap{position:absolute;inset:0;border-radius:18px}
    .body{background:var(--ai);padding:16px 18px;display:flex;flex-direction:column;overflow:hidden;
      justify-content:space-between;transform:translateZ(0);
      box-shadow:0 30px 50px -24px rgba(21,23,31,.55),inset 0 0 0 1px rgba(255,255,255,.2)}
    /* Fermoir : à l'intérieur de la carte (il débordait du bord droit). */
    .body::before{content:"";position:absolute;right:14px;top:58%;width:48px;height:36px;
      border-radius:10px;background:rgba(21,23,31,.82);border:1px solid rgba(255,255,255,.22)}
    .body::after{content:"";position:absolute;right:26px;top:calc(58% + 12px);width:11px;height:11px;
      border-radius:50%;background:#3dd3a0;box-shadow:0 0 10px #3dd3a0}
    .lbl{font-size:10.5px;letter-spacing:.14em;color:rgba(255,255,255,.75);text-transform:uppercase;font-weight:700}
    .wamt{font-size:clamp(22px,2.2vw,32px);font-weight:700;color:#fff;letter-spacing:-.02em;white-space:nowrap;
      text-shadow:0 4px 14px rgba(0,0,0,.25)}
    .wname{font-size:12.5px;color:rgba(255,255,255,.88);white-space:nowrap;overflow:hidden;
      text-overflow:ellipsis;max-width:72%;font-weight:600}
    .chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;max-width:80%;max-height:44px;overflow:hidden}
    .wchip{font-size:10.5px;background:rgba(255,255,255,.2);border-radius:20px;padding:2px 8px;color:#fff;
      max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .flap{height:34%;bottom:auto;transform-origin:top;transform:translateZ(14px);
      border-radius:18px 18px 0 0;clip-path:polygon(0 0,100% 0,100% 55%,50% 100%,0 55%);
      background:linear-gradient(180deg,rgba(21,23,31,.38),rgba(21,23,31,.14));
      box-shadow:0 6px 14px rgba(21,23,31,.25)}
    .wallet.go{animation:bwSpin 1.6s ease-in-out}
    .wallet.go .flap{animation:bwFlap 1.6s ease-in-out}
    @keyframes bwSpin{0%{transform:rotateY(0)}45%{transform:rotateY(360deg) scale(1.06)}100%{transform:rotateY(360deg)}}
    @keyframes bwFlap{30%,70%{transform:translateZ(14px) rotateX(170deg)}}
    .coins{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3}
    .coins i{position:absolute;width:24px;height:24px;border-radius:50%;left:50%;bottom:30%;
      background:radial-gradient(circle at 30% 30%,#f2c14e,#b87700);
      border:2px solid #b87700;opacity:0;animation:bwCoin 1.4s ease-out forwards}
    @keyframes bwCoin{0%{opacity:1;transform:translate(0,0)}
      100%{opacity:0;transform:translate(var(--x),-170px) rotate(540deg)}}
    .wkpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding-top:12px;border-top:1px solid var(--line)}
    .wkpis div{display:grid;gap:2px;min-width:0}
    .wkpis span{font-size:11.5px;color:var(--tx-3);font-weight:600}
    .wkpis b{font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .wkpis b.neg{color:var(--risk)}

    /* Ressources */
    .rhead,.row{display:grid;grid-template-columns:minmax(0,1.6fr) 58px minmax(0,1.2fr) 30px;gap:6px;align-items:center}
    .rhead{padding:0 2px 6px;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tx-3)}
    .rl{display:flex;flex-direction:column;gap:6px;overflow:auto;min-height:0;flex:1;padding:2px 2px 4px;margin:0 -2px}
    .row .in{padding:8px 10px;font-size:13px;border-radius:10px}
    .row .in.warn{border-color:var(--warn);box-shadow:0 0 0 3px rgba(199,130,10,.14)}
    .row .in.q{text-align:center;padding:8px 4px}
    .rerr{grid-column:1 / -1;color:var(--warn);font-size:12px;margin:0 2px}
    .del{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:var(--tx-3);
      transition:background .2s,color .2s}
    .del svg{width:14px;height:14px}
    .del:hover{background:rgba(217,63,90,.1);color:var(--risk)}

    /* ---------- Financement sponsors ---------- */
    .funding{margin-top:16px}
    .fund-link{margin-left:auto;font-size:12.5px}
    .fund-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
    .fund-grid div{display:grid;gap:2px;padding:12px 14px;border-radius:12px;background:var(--sub)}
    .fund-grid div.net{background:var(--accent-soft)}
    .fund-grid span{font-size:11.5px;font-weight:600;color:var(--tx-3)}
    .fund-grid b{font-size:19px;font-weight:700}
    .fund-grid small{font-size:11px;color:var(--tx-3)}
    .fund-bar{height:8px;border-radius:8px;background:var(--sub);overflow:hidden;margin:14px 0 6px}
    .fund-bar i{display:block;height:100%;border-radius:8px;background:var(--gain);transition:width .6s var(--ease)}

    /* ---------- Besoins des participants ---------- */
    .needs{margin-top:16px}
    .needs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
    .need{padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--sub)}
    .need.hard{border-color:rgba(217,63,90,.28);background:rgba(217,63,90,.05)}
    .need-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .need-head b{font-size:13.5px}
    .tag{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:6px;
      background:rgba(217,63,90,.12);color:var(--risk)}
    .count{display:block;margin:2px 0 8px;font-size:12px;font-weight:600;color:var(--tx-3)}
    .need ul{list-style:none;display:grid;gap:4px}
    .need li{display:grid;grid-template-columns:8px 1fr auto;gap:8px;align-items:baseline;font-size:12.5px;color:var(--tx-2);line-height:1.45}
    .need li i{width:6px;height:6px;border-radius:50%;background:var(--risk);transform:translateY(-1px)}
    .need li.soft i{background:var(--tx-3)}
    .need li span{overflow-wrap:anywhere}
    .need li small{flex:none;font-weight:700;color:var(--tx)}

    /* ---------- Résultats ---------- */
    .bout{margin-top:16px;display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);
      grid-template-areas:"res tot" "adv adv" "amb amb";gap:22px 28px}
    .c-res{grid-area:res}.c-tot{grid-area:tot}.c-adv{grid-area:adv}.c-amb{grid-area:amb}
    .bout h3{font-size:14px;font-weight:700;margin-bottom:10px}
    .bout .bempty{grid-column:1 / -1;display:flex;align-items:center;justify-content:center;gap:10px;
      color:var(--tx-2);text-align:center;padding:22px}
    .rcol{min-width:0;font-size:13px;line-height:1.5}
    .c-tot{border-left:1px solid var(--line);padding-left:28px}
    .c-adv,.c-amb{border-top:1px solid var(--line);padding-top:20px}
    .c-adv .adv{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
    .c-adv .adv>li{margin:0;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--sub)}
    .c-adv .adv>li>b{display:block;margin-bottom:4px}
    .c-adv>p{margin-top:12px}
    .it small,.urow small{margin-left:4px}
    .c-amb .amb{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
    .it{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:9px 0;border-bottom:1px solid var(--line)}
    .it:last-of-type{border-bottom:0}
    .it b{font-weight:600}
    .it .p{color:var(--tx);font-weight:700;text-align:right}
    .it .lnk{grid-column:1 / -1;display:flex;flex-direction:column;gap:2px;padding-top:3px}
    .offr{display:inline-flex;align-items:center;gap:6px;color:var(--violet);font-size:12px;font-weight:600;word-break:break-all}
    .offr:hover{text-decoration:underline}
    .nooffr{color:var(--tx-3);font-size:12px;font-style:italic;margin:0}
    .npr{color:var(--warn);font-weight:600}
    .nprz{grid-column:1 / -1;color:var(--tx-2);margin:2px 0 0}
    .it small{color:var(--tx-2)}
    .uwarn{margin-top:12px;padding:12px;border-radius:12px;background:rgba(199,130,10,.08);border:1px solid rgba(199,130,10,.25)}
    .uwarn .mini{margin:4px 0 6px;color:var(--tx-2)}
    .urow{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:4px 0}
    .tot{font-size:30px;font-weight:700;letter-spacing:-.02em;margin:2px 0 6px}
    .tot.none{font-size:18px;color:var(--tx-2)}
    .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-weight:600;font-size:12px;background:var(--sub);color:var(--tx-2)}
    .badge.ok{background:rgba(18,147,110,.11);color:var(--gain)}
    .badge.ko{background:rgba(217,63,90,.11);color:var(--risk)}
    .sum{margin:10px 0 4px;color:var(--tx-2)}
    .kv{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--tx-2)}
    .kv b{color:var(--tx);font-weight:700}
    .figs{margin-top:12px}
    .rec{margin-top:12px;padding:12px;border-radius:12px;background:var(--accent-soft)}
    .rec b{font-weight:700}
    .adv{margin:4px 0 0;padding-left:18px}
    .adv>li{margin-bottom:12px}
    .adv>li:last-child{margin-bottom:0}
    .adv small{display:block;margin-top:2px}
    .chg{margin:6px 0 0;padding-left:16px;font-size:12.5px}
    .chg>li{margin-bottom:5px}
    .chg small{display:block;color:var(--tx-2)}
    .chg a,.adv a{color:var(--violet);text-decoration:underline}
    .ghost{border:1px solid var(--line-2);background:var(--card);color:var(--tx-2);border-radius:10px;
      padding:6px 12px;font-size:12px;font-weight:600;margin-top:8px;transition:background .2s,color .2s}
    .ghost:hover{background:var(--sub);color:var(--tx)}
    .go{border:0;color:#fff;font-weight:600;font-size:12.5px;padding:7px 14px;border-radius:10px;background:var(--ai)}
    .confirm{margin-top:8px;padding:10px 12px;border:1px solid rgba(199,130,10,.35);border-radius:10px;background:rgba(199,130,10,.08)}
    .bacts{display:flex;gap:8px;margin-top:8px}
    .bacts .ghost{margin-top:0}
    .draft{margin-top:10px}
    .sinfo{margin-top:12px;padding:9px 11px;border:1px dashed var(--line-2);border-radius:10px;
      color:var(--tx-3);font-size:11.5px;line-height:1.45}
    .amb{display:flex;flex-direction:column;gap:8px;margin-top:6px}
    .ambrow{padding:10px 12px;border:1px dashed rgba(199,130,10,.5);border-radius:10px;background:rgba(199,130,10,.06)}
    .ambrow .top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
    .ambrow b{font-weight:600;word-break:break-word}
    .ambrow .qty{color:var(--tx-2);font-size:12px;white-space:nowrap}
    .ambrow p{margin:4px 0 0;color:var(--tx-2);font-size:12px;line-height:1.45}
    .ambrow .fix{margin-top:5px;color:var(--tx-3);font-size:11.5px}
    .ambnone{color:var(--tx-2);font-size:12.5px;margin:2px 0 0}

    /* ---------- Toast ---------- */
    .btoast{position:fixed;left:50%;top:72px;transform:translate(-50%,-140%);z-index:200;
      display:flex;align-items:center;gap:14px;background:var(--card);color:var(--risk);
      border:1px solid rgba(217,63,90,.3);border-left:4px solid var(--risk);border-radius:12px;padding:12px 16px;
      font-weight:600;font-size:13.5px;box-shadow:var(--sh-lg);max-width:92vw;animation:bwTin .35s var(--ease) forwards}
    @keyframes bwTin{to{transform:translate(-50%,0)}}
    .btoast button{border:0;background:none;color:var(--risk);cursor:pointer;font-size:15px}

    /* ---------- Responsive ---------- */
    @media (max-width:1240px){
      .layout{grid-template-columns:1fr 1fr}
      .layout>.res{grid-column:1 / -1;height:auto;max-height:420px}
      .bout{grid-template-columns:1fr;grid-template-areas:"res" "tot" "adv" "amb"}
      .c-tot{border-left:0;padding-left:0;border-top:1px solid var(--line);padding-top:20px}
    }
    @media (max-width:1000px){.fund-grid{grid-template-columns:1fr 1fr}}
    @media (max-width:760px){
      .layout{grid-template-columns:1fr}
      .layout>.card{height:auto}
      .avatar-stage{height:300px;flex:none}
      .wstage{min-height:220px}
      .c-adv .adv,.c-amb .amb{grid-template-columns:1fr}
      .bhead .title{white-space:normal}
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
  constraints: ConstraintGroup[] = [];
  registeredCount = 0;
  /** Financement sponsors (module Sponsors) : réduit le coût restant à la charge de l'organisation. */
  sponsoring: SponsorFunding | null = null;

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

  /**
   * Reste (négatif = dépassement) : celui de la dernière analyse, sinon celui
   * enregistré côté serveur. ``null`` tant que rien n'est chiffré.
   */
  get remainingValue(): number | null {
    if (this.aiState === 'thinking' || this.pricedCount === 0 || !this.budgetAvailable) return null;
    const fromAnalysis = this.aiState === 'ok'
      ? this.figures?.initial_remaining ?? this.analysis?.computed?.remaining_budget
      : null;
    const value = fromAnalysis ?? this.summary?.remaining_budget;
    return value == null ? null : Number(value);
  }

  get remainingLabel(): string {
    const remaining = this.remainingValue;
    return remaining == null ? '—' : `${Math.round(Math.abs(remaining)).toLocaleString('fr-FR')} €`;
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
        this.loadSponsoring();
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
    this.loadSponsoring();
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

  // ---- Financement sponsors ------------------------------------------------

  /** Coût net = coût estimé (même calcul que cette page) − sponsoring confirmé. */
  private loadSponsoring(): void {
    this.http.get<SponsorFunding>(`/api/sponsorship-net-budget/?event=${this.eventId}`)
      .pipe(catchError(() => of(null)))
      .subscribe((data) => (this.sponsoring = data));
  }

  get sponsorCoverage(): number {
    const s = this.sponsoring;
    if (!s || !s.planned_cost) return 0;
    return Math.min(100, Math.round((s.confirmed_sponsorship / s.planned_cost) * 100));
  }

  // ---- Contraintes alimentaires (agrégat, sans données nominatives) -------

  private loadConstraints(): void {
    forkJoin({
      links: this.http.get<any[]>(`/api/event-participants/?event=${this.eventId}`).pipe(catchError(() => of([]))),
      people: this.http.get<any[]>('/api/participants/').pipe(catchError(() => of([])))
    }).subscribe({
      next: ({ links, people }) => {
        const ids = new Set((links || []).map((l) => l.participant));
        this.registeredCount = ids.size;
        const groups = new Map<string, { type: string; people: Set<string>; hard: boolean;
          values: Map<string, { value: string; count: number; hard: boolean }> }>();
        (people || []).forEach((p) => {
          if (!ids.has(p.id)) return;
          (p.constraints || []).forEach((c: any) => {
            const value = String(c.value || '').trim();
            if (!value) return;
            const type = String(c.type || 'Autre').trim() || 'Autre';
            const group = groups.get(type.toLowerCase())
              || { type, people: new Set<string>(), hard: false, values: new Map() };
            group.people.add(p.id);
            group.hard = group.hard || !!c.is_hard;
            const entry = group.values.get(value.toLowerCase()) || { value, count: 0, hard: false };
            entry.count += 1;
            entry.hard = entry.hard || !!c.is_hard;
            group.values.set(value.toLowerCase(), entry);
            groups.set(type.toLowerCase(), group);
          });
        });
        this.constraints = Array.from(groups.values())
          .map((g) => ({
            type: g.type,
            people: g.people.size,
            hard: g.hard,
            values: Array.from(g.values.values()).sort((a, b) => b.count - a.count),
          }))
          .sort((a, b) => Number(b.hard) - Number(a.hard) || b.people - a.people);
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
