import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError, timer } from 'rxjs';
import { retry } from 'rxjs/operators';

export const INVALID_NAME_MESSAGE =
  "Le nom de cette ressource n'est pas suffisamment précis. " +
  'Veuillez le reformuler pour permettre une estimation correcte.';

export function validateResourceName(name: string): string | null {
  const raw = (name || '').trim();
  if (!raw) return INVALID_NAME_MESSAGE;
  const letters = raw.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}]/gu, '');
  if (!letters || new Set(letters.toLowerCase()).size === 1) {
    return INVALID_NAME_MESSAGE;
  }
  return null;
}

export function validateResourceInput(name: string, description: string): string | null {
  return validateResourceName(name);
}

/**
 * Accès à l'API Django pour le module Budget & Ressources.
 *
 * Les totaux sont calculés côté backend : le frontend ne fait que les
 * afficher. L'IA est appelée via Django, jamais directement sur Ollama.
 *
 * Toutes les ressources sont scopées par événement (UUID) — jamais de
 * mélange entre événements.
 */

const API = '/api';

/** Ressource / poste budgétaire renvoyé par Django. */
export interface BudgetItem {
  id: string;
  event: string;
  name: string;
  category: string;
  category_label: string;
  quantity: number;
  min_quantity: number | null;
  is_essential: boolean;
  description: string;
  /** Champs monétaires remplis par l'IA, en lecture seule côté client. */
  unit_price: number | null;
  total: number | null;
  price_source: '' | 'ai_estimate' | 'real_offer';
  provider: string;
  product_url: string;
  confidence: number | null;
  price_range_min: number | null;
  price_range_max: number | null;
  estimated_at: string | null;
  /** Exclue de l'analyse : aucun prix, aucun fournisseur, aucun calcul. */
  is_ambiguous: boolean;
  ambiguity_reason: string;
  /** Recommandation d'achat réelle (page trouvée sur le web). */
  offer_title: string;
  offer_domain: string;
  offer_note: string;
  /** Tarif réellement relevé ; `null` si le prix reste une estimation IA. */
  offer_price: number | null;
  offer_currency: string;
  offer_verified_at: string | null;
  offer_available: boolean | null;
  /**
   * Ressource comprise mais non chiffrée : l'IA a su de quoi il s'agissait,
   * mais n'a osé aucun montant. `total` vaut alors `null` (et non 0, qui se
   * lirait « gratuit ») et la ligne reste visible avec sa page fournisseur.
   */
  unpriced_reason: string;
  /**
   * État canonique renvoyé par le backend après analyse : `priced`,
   * `understood_unpriced`, `ambiguous`, `analysis_failed`, `search_unavailable`
   * ou `pending`. Permet de distinguer « comprise et chiffrée » de « comprise
   * mais non chiffrée » sans déduire l'état d'un prix absent.
   */
  analysis_status?: string;
  created_at: string;
}

/** Champs que l'organisateur peut saisir (aucun prix). */
export interface BudgetItemPayload {
  event: string;
  name: string;
  /** Optionnelle : le backend applique « autre » par défaut. */
  category?: string;
  quantity: number;
  description?: string;
}

/** Statistiques calculées côté backend. */
export interface BudgetSummary {
  event: {
    id: string;
    name: string;
    event_type: string;
    event_type_label: string;
    location: string;
    start_date: string | null;
    end_date: string | null;
    participants: number;
  };
  budget: number | null;
  total_expenses: number;
  verified_total?: number;
  estimated_total?: number;
  verified_count?: number;
  estimated_count?: number;
  total_confidence?: 'verified' | 'estimated' | 'partial';
  remaining_budget: number | null;
  over_budget: boolean;
  status: 'budget_missing' | 'over_budget' | 'on_budget' | 'under_budget';
  incomplete: boolean;
  overage: number | null;
  usage_rate: number | null;
  expenses_count: number;
  /** Ressources écartées de l'analyse (nom ou description incompris). */
  ambiguous_count: number;
  /** Ressources réellement chiffrées : seules à peser sur le total. */
  priced_count?: number;
}

/**
 * Ressource classée « ambiguë » : ni le nom ni la description n'ont permis de
 * savoir ce qu'il fallait chiffrer. Elle est **totalement exclue** de l'analyse
 * budgétaire — aucun prix, aucun fournisseur, aucun calcul — et seules ces
 * informations de contexte lui sont rattachées.
 */
export interface AmbiguousResource {
  id: string;
  name: string;
  quantity: number;
  category: string;
  category_label: string;
  description: string;
  /** Explication en français, affichée telle quelle à l'organisateur. */
  reason: string;
}

/**
 * Ressource comprise mais non chiffrée — à ne **jamais** confondre avec une
 * ressource ambiguë : ici le nom et la description ont été parfaitement
 * compris. C'est l'IA qui n'a osé proposer aucun montant (cas typique d'un
 * service dont le tarif dépend d'une durée ou d'une capacité non précisées).
 *
 * Aucun prix n'est inventé : la ligne ne pèse sur aucun calcul, et la page
 * fournisseur réelle reste affichée pour que l'organisateur y trouve le
 * tarif pratiqué.
 */
export type UnpricedResource = AmbiguousResource;

/**
 * Recommandation d'achat réelle.
 *
 * `url`, `domain` et `title` proviennent d'une page **réellement trouvée** par
 * la recherche web : ils ne sont jamais fabriqués par le LLM, qui ne fait que
 * choisir dans la liste des résultats (et l'application vérifie ce choix).
 *
 * `price` n'est renseigné que si un moteur a réellement relevé le tarif sur la
 * page. Sinon il vaut `null` et le prix affiché reste une estimation IA.
 */
export interface Offer {
  title: string;
  url: string;
  domain: string;
  provider: string;
  price: number | null;
  currency: string;
  match_note: string;
}

/** État de la recherche web menée pendant l'analyse (transparence). */
export interface WebSearchInfo {
  provider: string;
  provider_label: string;
  keyless: boolean;
  searched: number;
  found: number;
  note: string;
}

/** Stratégie d'économie : toujours calculée et sourcée par le backend. */
export type AiChangeStrategy = 'alternative' | 'rental' | 'reduce_quantity';

/** Statut de la source d'une proposition (jamais un lien non vérifié). */
export type AiSourceStatus =
  | 'verified'
  | 'page_without_price'
  | 'search_failed'
  | 'no_source'
  | 'none';

export interface AiChange {
  expense_id: string;
  expense: string;
  old_cost: number;
  new_cost: number;
  saving: number;
  reason: string;
  strategy?: AiChangeStrategy;
  old_quantity?: number | null;
  new_quantity?: number | null;
  /** Prix unitaire utilisé : relevé sur la page réelle ou déjà vérifié. */
  unit_price?: number | null;
  product?: string;
  /** Précaution d'unité (pièce, lot, durée) à vérifier avant commande. */
  note?: string;
  source_url?: string;
  source_domain?: string;
  source_title?: string;
  source_status?: AiSourceStatus;
  price_verified?: boolean;
  /** Case à cocher côté UI — indique si l'organisateur accepte ce changement. */
  _accept?: boolean;
}

export interface AiScenario {
  name: string;
  description: string;
  new_total: number;
  saving: number;
  changes: AiChange[];
  is_consistent: boolean;
  inconsistencies: string[];
  changes_saving: number;
  expected_new_total: number;
  /** Le scénario ramène-t-il réellement le coût sous le budget maximal ? */
  budget_respected?: boolean;
  remaining_after?: number;
  overage_after?: number;
  cost_reliability?: string;
}

export interface AiRecommendation {
  title: string;
  kind: 'improvement' | 'free_improvement' | 'optimization';
  /**
   * Coût **ajouté** de la suggestion. Toujours `null` lorsque le coût ne peut
   * pas être étiqueté honnêtement (budget déjà dépassé, analyse incomplète).
   */
  estimated_cost: number | null;
  /**
   * Origine du coût : `ai_estimate` = estimation de l'IA, jamais un tarif
   * relevé ; `real_offer` = adossé à un prix réellement vérifié.
   */
  cost_source?: 'ai_estimate' | 'real_offer' | null;
  reason: string;
  benefit: string;
  balance_after?: number | null;
  quantity?: number | null;
  unit_price?: number | null;
  price_verified?: boolean;
  /** Lien direct vérifié ; vide quand aucune source fiable n'existe. */
  url?: string;
  domain?: string;
  source_title?: string;
  source_status?: AiSourceStatus;
  /** Explication affichable : « aucune source fiable », unité à vérifier… */
  source_note?: string;
}

/**
 * Chiffres distincts de l'analyse, tous calculés par le backend :
 * coût final = coût initial − économies + améliorations.
 */
export interface AiFigures {
  budget_max: number | null;
  initial_cost: number;
  initial_remaining: number | null;
  initial_overage: number | null;
  savings: number;
  improvements_cost: number;
  final_cost: number;
  final_remaining: number | null;
  final_overage: number | null;
  respects_budget: boolean | null;
}

/**
 * Groupe de lignes strictement identiques (nom, description, quantité,
 * catégorie). Signalé par le backend, jamais fusionné automatiquement : c'est
 * à l'organisateur de décider s'il s'agit du même besoin ou de deux besoins
 * distincts.
 */
export interface DuplicateGroup {
  name: string;
  description: string;
  quantity: string;
  category: string;
  count: number;
  item_ids: string[];
}

export interface AiAnalysis {
  analysis_mode: 'optimization' | 'improvement' | 'free_improvement' | 'none';
  /**
   * `budget_missing` : aucun budget exploitable n'est défini pour l'événement.
   */
  status: 'budget_missing' | 'under_budget' | 'on_budget' | 'over_budget';
  incomplete: boolean;
  summary: string;
  main_recommendation?: {
    title: string;
    reason: string;
    new_total: number;
    saving: number;
  };
  scenarios: AiScenario[];
  recommendations: AiRecommendation[];
  recommendations_notice?: string;
  /** Chiffres distincts (budget max, coût initial, reste, économies, final). */
  figures?: AiFigures;
  /** Améliorations vérifiées écartées car elles dépasseraient le solde. */
  recommendations_skipped?: number;
  /** Ressources exclues de l'analyse, avec la raison. */
  ambiguous: AmbiguousResource[];
  /**
   * Ressources comprises mais non chiffrées (l'IA n'a osé aucun montant).
   * Elles ne sont **pas** ambiguës : elles gardent leur page fournisseur,
   * mais elles pèsent pour zéro — le total affiché est donc une
   * sous-estimation, et l'interface le signale.
   */
  unpriced?: UnpricedResource[];
  computed: {
    budget: number | null;
    total_expenses: number;
    remaining_budget: number | null;
    over_budget: boolean;
    status: 'budget_missing' | 'under_budget' | 'on_budget' | 'over_budget';
    incomplete: boolean;
    usage_rate: number | null;
    recommendations_total: number;
    remaining_after_recommendations?: number | null;
    optimization?: {
      estimated_savings: number;
      total_after_optimization: number;
      remaining_after_optimization: number | null;
      overage_after_optimization: number | null;
      feasible: boolean;
    };
    ambiguous_count: number;
    unpriced_count?: number;
    /** Ressources réellement chiffrées : seules à peser sur le total. */
    priced_count?: number;
    /** Budget maximal, coût initial, reste/dépassement, économies, améliorations, coût final. */
    figures?: AiFigures;
    model: string;
  };
  expenses_count: number;
  /** État chiffré des ressources après analyse. */
  items: BudgetItem[];
  /** Ressources dont l'estimation a échoué (IA indisponible, etc.). */
  estimate_errors: { resource: string; error: string }[];
  /**
   * Lignes d'identité strictement identique (nom, description, quantité,
   * catégorie). Signalées, jamais fusionnées : l'analyse ne crée ni ne
   * supprime aucune ligne.
   */
  duplicates?: DuplicateGroup[];
  /** Transparence sur la recherche web réellement menée. */
  web_search?: WebSearchInfo;
}

/** Réponse dégradée renvoyée par le backend quand Ollama est éteint. */
export interface AiUnavailable {
  status: 'unavailable';
  error: string;
}

/** Événement tel qu'utilisé par la page liste (scopé à l'organisation). */
export interface BudgetEvent {
  id: string;
  organization: string;
  organization_name?: string;
  name: string;
  event_type: string;
  event_type_label?: string;
  location: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  target_budget: string;
  participant_target: number;
  participant_expected: number;
}

@Injectable({ providedIn: 'root' })
export class BudgetService {
  private readonly http = inject(HttpClient);

  /** Liste des ressources d'un événement (strictement isolé). */
  listItems(eventId: string): Observable<BudgetItem[]> {
    return this.http.get<BudgetItem[]>(`${API}/budget-items/`, { params: { event: eventId } });
  }

  createItem(payload: BudgetItemPayload): Observable<BudgetItem> {
    return this.http.post<BudgetItem>(`${API}/budget-items/`, payload);
  }

  /** Seule la quantité / description / nom est modifiable : pas de prix. */
  updateItem(id: string, eventId: string, payload: Partial<BudgetItemPayload>): Observable<BudgetItem> {
    return this.http.patch<BudgetItem>(`${API}/budget-items/${id}/`, payload, { params: { event: eventId } });
  }

  deleteItem(id: string, eventId: string): Observable<void> {
    return this.http.delete<void>(`${API}/budget-items/${id}/`, { params: { event: eventId } });
  }

  /** Totaux et statistiques, calculés par Django. */
  getSummary(eventId: string): Observable<BudgetSummary> {
    return this.http.get<BudgetSummary>(`${API}/budget-items/summary/`, {
      params: { event: eventId }
    });
  }

  /** Demande une analyse au LLM local, via Django. */
  analyze(eventId: string): Observable<AiAnalysis> {
    return this.http.post<AiAnalysis>(`${API}/budget-items/analyze/`, { event: eventId }).pipe(
      retry({
        count: 1,
        delay: (error) => error.status === 0 || error.status >= 500
          ? timer(1000)
          : throwError(() => error)
      })
    );
  }

  /** Demande une estimation automatique pour une ressource. */
  estimateResource(payload: Partial<BudgetItemPayload> & { id?: string }): Observable<any> {
    return this.http.post<any>(`${API}/budget-items/estimate/`, payload);
  }
}
