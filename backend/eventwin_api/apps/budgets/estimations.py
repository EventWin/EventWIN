"""Compréhension et estimation des ressources budgétaires.

Deux responsabilités distinctes :

1. **Compréhension** — le LLM dit s'il sait de quoi parle chaque ressource.
   S'il ne sait pas, la ressource est classée « ambiguë » et **exclue
   totalement** de l'analyse budgétaire — aucun prix, aucun fournisseur, aucun
   calcul. La pertinence d'une page web est également jugée par le modèle
   (``chosen_index`` dans une liste fermée) : il n'existe plus aucune liste de
   mots-clés locale, qui ratait les synonymes (« sono » vs « sonorisation »),
   les abréviations et les marques.
2. **Prix** — un montant n'est accepté que si le modèle l'a estimé **et** qu'aucune
   page réellement trouvée ne prouve le contraire. Le prix porte alors
   ``price_source = "ai_estimate"`` et reste explicitement étiqueté comme une
   estimation. Une page dont le tarif a réellement été relevé donne
   ``price_source = "real_offer"`` ; une page **prouvée non pertinente**
   (identité absente ou page non marchande) fait tomber le prix et le lien.

**Nombre d'appels IA constant** : toutes les ressources d'une analyse partent
dans un **seul** appel par lot (taille configurable), et non plus deux appels
série par ressource (jusqu'à 180 s chacun). Le coût et la durée ne croissent
donc plus linéairement avec le nombre de ressources.

Garde-fous d'honnêteté, appliqués par le code et jamais par le modèle :

  - le LLM ne fournit ni URL, ni nom de fournisseur : seules les URL rendues
    par le moteur de recherche peuvent apparaître, et elles sont revalidées
    contre la liste des candidats ;
  - le LLM ne fournit **pas** de total : la ligne vaut toujours
    ``quantité × prix unitaire``, calculé par l'application ;
  - une valeur invalide (NaN, Infinity, négatif, booléen, fourchette
    inversée, index hors borne) est écartée, jamais « corrigée » ;
  - une réponse sans clé ``understood`` met la ressource en
    ``analysis_failed`` — jamais « comprise par défaut » ;
  - une panne réseau ou une recherche sans résultat n'est **jamais** un motif
    d'ambiguïté.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from decimal import Decimal

from django.conf import settings

from . import websearch
from .numutils import clean_choice_index, decimal_or_none, parse_range, positive_decimal_or_none
from .ollama_client import generate_json
from .textutils import normalize_text
from .validation import INVALID_NAME_MESSAGE, local_signals

logger = logging.getLogger(__name__)

# États possibles d'une ressource après analyse.
STATUS_PRICED = 'priced'
STATUS_UNPRICED = 'understood_unpriced'
STATUS_AMBIGUOUS = 'ambiguous'
STATUS_FAILED = 'analysis_failed'

DEFAULT_UNPRICED_REASON = (
    "Ressource comprise, mais le modèle n'a proposé aucun montant : elle reste "
    "non chiffrée plutôt que de voir un prix inventé."
)

# Schéma de sortie imposé au modèle. `total_estimate` n'y figure plus : le
# total est calculé par l'application (quantité × prix unitaire).
SCHEMA_SPEC = """
Réponds strictement avec cet objet JSON (les valeurs ci-dessous montrent la
**forme** attendue avec un exemple chiffré : remplace-les par tes propres
estimations pour chaque ressource, ne recopie pas 12.5) :
{
  "results": [
    {
      "expense_id": "<id fourni>",
      "understood": true,
      "ambiguity_reason": "",
      "unpriced_reason": "",
      "unit_price_estimate": 12.5,
      "price_range_min": 8,
      "price_range_max": 20,
      "chosen_index": null,
      "match_note": ""
    }
  ]
}
"""


def _system_prompt() -> str:
    ai = getattr(settings, 'BUDGET_AI', {})
    model = ai.get('MODEL', '')
    return (
        "Tu es l'assistant budgétaire d'EventWIN. Tu analyses les ressources "
        "décrites par l'organisateur sans jamais remplacer leurs données par un "
        "exemple ou une hypothèse métier.\n\n"
        "Tu distingues deux choses, jamais confondues :\n"
        "- COMPRENDRE une ressource = savoir quel produit ou service elle désigne ;\n"
        "- CHIFFRER une ressource = lui attribuer un prix.\n"
        "On peut comprendre sans chiffrer (prix null, \"understood\": true). On ne "
        "peut pas chiffrer sans comprendre.\n\n"
        "RÈGLES ABSOLUES :\n"
        "- Tu réponds pour **CHAQUE** ressource fournie, sans exception : une "
        "entrée par \"expense_id\", en recopiant l'identifiant **exactement** tel "
        "qu'il t'est donné et dans le même ordre. Ne saute aucune ressource, même "
        "si tu hésites : tu réponds alors avec \"unit_price_estimate\": null et "
        "une raison précise. N'utilise jamais 0 pour représenter un prix inconnu.\n"
        "- Les prix que tu proposes sont des PRIX UNITAIRES en euros (€), hors "
        "quantité. Ne donne JAMAIS de total : il est calculé par l'application.\n"
        "- Tu peux fournir une estimation IA indicative lorsque la ressource est "
        "comprise et que son unité est suffisamment décrite. Cette estimation "
        "n'est jamais un prix fournisseur réel et doit rester marquée "
        "\"ai_estimate\" par l'application.\n"
        "- Le nom, la catégorie et la quantité peuvent suffire à comprendre une "
        "ressource et à produire une estimation indicative lorsque son unité est "
        "claire ; une description vide n'est donc pas, à elle seule, un motif "
        "pour refuser le chiffrage. Une description vide ne justifie jamais, à "
        "elle seule, un \"unit_price_estimate\" à null. Exploite ensuite la "
        "description et le contexte réellement fournis "
        "(participants, durée, achat ou location, lieu, date) pour affiner "
        "l'estimation ; ne complète jamais une donnée absente par une valeur "
        "inventée.\n"
        "- Les candidats web servent à fournir un lien réel et, si possible, un "
        "prix vérifié. L'absence de candidat ou une page sans tarif vérifiable "
        "n'interdit pas une estimation IA indicative, mais interdit de la "
        "présenter comme un prix fournisseur.\n"
        "- Si tu comprends la ressource mais que le montant unitaire dépend "
        "entièrement d'une information absente (durée, capacité, livraison, achat "
        "ou location non précisés), réponds \"understood\": true, "
        "unit_price_estimate à null et une \"unpriced_reason\" **propre à cette "
        "ressource** qui nomme précisément l'information manquante. N'écris pas la "
        "même phrase pour plusieurs ressources et ne recopie pas les "
        "\"local_signals\" : c'est un contexte technique, pas une raison.\n"
        "- Réserve \"understood\": false au nom ou à la description qui "
        "n'identifient rien. Un assemblage de lettres sans signification, un mot "
        "inventé ou une faute de frappe "
        "non reconnaissable ne désignent aucun produit ni service : ce n'est PAS "
        "compris. De même, un mot trop vague pour désigner une chose précise n'est "
        "pas compris. N'invente jamais un service plausible derrière un mot que tu "
        "ne reconnais pas. Donne alors une \"ambiguity_reason\" précise en "
        "français, sans prix ni lien.\n"
        "- Une fourchette honnête vaut mieux qu'un chiffre faux : utilise "
        "price_range_min et price_range_max lorsque tu hésites sur l'ordre de "
        "grandeur.\n"
        "- \"chosen_index\" est l'indice (entier, commençant à 0) du candidat web "
        "qui correspond **vraiment** à la ressource, ou null si aucun ne convient. "
        "Un article de presse, un forum, un dictionnaire, une encyclopédie, une "
        "page d'accueil ou une page de rubrique ne correspond **jamais** : choisis "
        "null plutôt qu'une page qui ne vend pas la ressource. N'invente jamais "
        "d'URL ni de fournisseur : ils ne peuvent venir que de cette liste.\n"
        "- Réponds en français, sans texte hors JSON."
    )


# ---------------------------------------------------------------------------
# Résultat validé
# ---------------------------------------------------------------------------

@dataclass
class ExpenseResult:
    """Sortie **validée** pour une ressource : jamais une valeur brute du LLM."""

    expense_id: str
    status: str = STATUS_FAILED
    reason: str = ''
    unit_price: Decimal | None = None
    price_range_min: Decimal | None = None
    price_range_max: Decimal | None = None
    chosen_index: int | None = None
    match_note: str = ''
    offer: dict | None = None
    price_source: str = ''
    price_explanation: str = ''
    warnings: list[str] = field(default_factory=list)

    @property
    def understood(self) -> bool:
        return self.status in (STATUS_PRICED, STATUS_UNPRICED)


# ---------------------------------------------------------------------------
# Construction du lot
# ---------------------------------------------------------------------------

def search_query_for(name: str, description: str = '', location: str = '') -> str:
    """Requête de recherche **déterministe** : nom + description + lieu.

    Aucun mot-clé métier ajouté : la requête reflète exactement ce que
    l'organisateur a saisi, plus le lieu de l'événement quand il est connu.
    """
    parts = [normalize_text(name), normalize_text(description)]
    query = ' '.join(part for part in parts if part)
    if location and location.strip():
        query = f"{query} {normalize_text(location)}".strip()
    return query


def build_expense_payload(item, signals: list[str] | None = None,
                          candidates: list[dict] | None = None) -> dict:
    """Série de la ressource, telle qu'elle est montrée au modèle."""
    shown = prompt_candidates(candidates)
    return {
        'expense_id': str(item.pk),
        'name': (item.name or '').strip(),
        'description': (item.description or '').strip(),
        'category': item.category or '',
        'quantity': str(item.quantity),
        'local_signals': list(signals or []),
        'web_candidates': [
            {
                'index': index,
                'title': candidate.get('title', ''),
                'url': candidate.get('url', ''),
                'domain': candidate.get('domain', ''),
                'listed_price': candidate.get('price'),
                'currency': candidate.get('currency', ''),
            }
            for index, candidate in enumerate(shown)
        ],
    }


def prompt_candidates(candidates: list[dict] | None) -> list[dict]:
    """Candidats réellement montrés au modèle, en nombre borné.

    La validation résout ``chosen_index`` dans **cette même liste** : la borne
    est appliquée une seule fois, là où la liste est construite, pour qu'un
    indice reste toujours valide des deux côtés. Un prompt court est aussi ce
    qui permet au modèle de répondre pour *toutes* les ressources.
    """
    limit = max(1, int(
        getattr(settings, 'BUDGET_SEARCH', {}).get('MAX_PROMPT_CANDIDATES', 3)
    ))
    return list(candidates or [])[:limit]


def build_batch_prompt(event_context: dict, expenses: list[dict]) -> str:
    """Prompt d'un **lot** : toutes les ressources dans un seul appel."""
    budget = event_context.get('budget')
    try:
        budget_line = (
            f"{Decimal(str(budget)).quantize(Decimal('0.01'))} €"
            if budget is not None else "non défini"
        )
    except Exception:  # noqa: BLE001 — un budget illisible n'est pas un budget
        budget_line = "non défini"

    lines = [
        "Événement : "
        f"{event_context.get('name', '')} "
        f"(type : {event_context.get('event_type', '')})",
        f"Lieu : {event_context.get('location', '') or 'non précisé'}",
        f"Participants attendus : {event_context.get('participants') or 'non précisé'}",
        f"Budget maximal : {budget_line}",
        "",
        "Ressources à analyser :",
    ]

    for position, expense in enumerate(expenses, start=1):
        lines.append(f"{position}. {json.dumps(expense, ensure_ascii=False)}")

    lines += [
        "",
        f"Réponds avec **exactement {len(expenses)} entrée(s)** dans \"results\" : "
        "une entrée par ressource ci-dessus, dans le même ordre, en recopiant son "
        "\"expense_id\" à l'identique. N'omets aucune ressource. Pour un bien "
        "courant (chaise, table, nappe, sono…), donne TOUJOURS un "
        "\"unit_price_estimate\" en euros (prix de location ou d'achat typique) "
        "et une fourchette, même sans description et même sans candidat web. "
        "Réserve null (jamais 0) au seul cas d'un service dont le tarif dépend "
        "entièrement d'une information absente ; ajoute alors une "
        "\"unpriced_reason\" propre à cette ressource.",
        "",
        SCHEMA_SPEC,
    ]
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Validation stricte de la réponse
# ---------------------------------------------------------------------------

def _as_bool(value) -> bool | None:
    """Vrai/faux strict : aucun défaut, aucune coercion d'une chaîne."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ('true', 'vrai', 'oui', '1'):
            return True
        if lowered in ('false', 'faux', 'non', '0'):
            return False
    return None


def _candidate_at(candidates: list[dict], index: int | None) -> dict | None:
    if index is None:
        return None
    if index < 0 or index >= len(candidates):
        return None
    return candidates[index]


def _validate_offer(candidate: dict | None, query: str,
                    identity: str = '') -> tuple[dict | None, str, str]:
    """Revalide l'URL du candidat retenu, **quelle que soit son origine**.

    Rend ``(offre|None, note, verdict)`` où ``verdict`` vaut ``verified``,
    ``rejected`` ou ``unreachable``. Un verdict ``rejected`` signifie que la
    page désignée par l'IA est **prouvée** inexploitable (accueil, rubrique,
    article de presse, page sans rapport) : l'appelant doit alors rejeter
    aussi le prix, qui s'appuyait sur cette page.
    """
    if not candidate:
        return None, '', ''

    url = websearch.clean_url(candidate.get('url', ''))
    if not url:
        return None, "Lien écarté : adresse invalide ou domaine non marchand.", 'rejected'

    # La page vérifiée n'est **jamais** supposée : quand la validation ne rend
    # pas un dictionnaire (contrat historique), la page est traitée comme non
    # atteinte. Le lien trouvé par la recherche reste alors conservé, marqué
    # non vérifié, et ne produira jamais de tarif « relu sur la page ».
    verdict_payload = websearch.validate_direct_offer(url, query, identity)
    if not isinstance(verdict_payload, dict):
        verdict_payload = {'verdict': 'unreachable', 'reason': ''}

    verdict = str(verdict_payload.get('verdict') or '').strip()
    if not verdict:
        # Contrat historique (mocks, appels externes) : un dictionnaire sans
        # verdict est jugé sur son indicateur ``verified``.
        verdict = 'verified' if verdict_payload.get('verified') else 'unreachable'
    if verdict == 'rejected':
        return None, (
            "Page écartée : "
            + (str(verdict_payload.get('reason') or '').strip()
               or "elle n'est pas une fiche produit pertinente")
            + '.'
        ), 'rejected'

    if verdict == 'verified':
        validated = verdict_payload
        unverified_note = ''
    else:
        validated = {}
        unverified_note = (
            "Page non vérifiée (inaccessible au moment de l'analyse) : "
            "le lien provient de la recherche web, sans confirmation du contenu."
        )
    final_url = websearch.clean_url(validated.get('url', '') or url)
    if not final_url:
        return None, "Lien écarté : page inaccessible ou non exploitable.", verdict

    currency = str(validated.get('currency') or candidate.get('currency') or '').upper()
    real_price = decimal_or_none(validated.get('price'))

    offer = {
        'url': final_url,
        'domain': websearch.domain_of(final_url),
        'title': str(validated.get('title') or candidate.get('title') or '').strip(),
        'price': real_price,
        'currency': currency,
        'verified': bool(validated.get('verified')),
        'price_verified': bool(validated.get('price_verified')) and real_price is not None,
        'available': validated.get('available'),
    }
    note = unverified_note
    if not note and not offer['price_verified']:
        note = (
            "Page produit réelle, mais aucun tarif n'a pu y être relevé : "
            "le prix affiché reste une estimation IA."
        )
    return offer, note, verdict


def _validate_one(raw: dict, expense: dict, candidates: list[dict], query: str) -> ExpenseResult:
    """Valide la sortie du LLM pour **une** ressource. Jamais de valeur par défaut."""
    expense_id = expense['expense_id']
    result = ExpenseResult(expense_id=expense_id, status=STATUS_FAILED)

    if not isinstance(raw, dict):
        result.reason = "Réponse de l'IA inexploitable pour cette ressource."
        return result

    understood = _as_bool(raw.get('understood'))
    if understood is None:
        result.status = STATUS_FAILED
        result.reason = (
            "L'IA n'a pas indiqué si cette ressource était comprise : "
            "analyse non concluante."
        )
        return result

    if not understood:
        result.status = STATUS_AMBIGUOUS
        result.reason = str(raw.get('ambiguity_reason') or '').strip() or INVALID_NAME_MESSAGE
        return result

    # --- Compris : prix unitaires, jamais de total -------------------------
    unit_price = positive_decimal_or_none(raw.get('unit_price_estimate'))
    low, high = parse_range(raw.get('price_range_min'), raw.get('price_range_max'))

    # Filet de sécurité : le modèle fournit parfois une **fourchette** honnête
    # sans oser le prix unitaire. Le milieu de la fourchette devient alors un
    # prix indicatif (étiqueté `ai_estimate`), plutôt qu'une ligne perdue qui
    # ramènerait le budget à 0 €. Aucune donnée inventée : les bornes viennent
    # du modèle.
    if unit_price is None and low is not None and high is not None and high > 0:
        unit_price = ((low + high) / 2).quantize(Decimal('0.01'))
        result.warnings.append(
            "Prix unitaire déduit du milieu de la fourchette IA (aucun prix "
            "unitaire fourni) : estimation indicative."
        )

    if unit_price is None:
        # Ni prix unitaire ni fourchette exploitable : la ressource reste non
        # chiffrée, jamais remplacée par zéro.
        result.status = STATUS_UNPRICED
        result.reason = str(raw.get('unpriced_reason') or '').strip() or DEFAULT_UNPRICED_REASON
        return result

    result.status = STATUS_PRICED
    result.unit_price = unit_price
    result.price_range_min = low
    result.price_range_max = high

    # --- Offre : index dans une liste fermée, puis revalidation ------------
    index = clean_choice_index(raw.get('chosen_index'), len(candidates))
    result.chosen_index = index
    candidate_indices = []
    if index is not None:
        candidate_indices.append(index)
    candidate_indices.extend(
        candidate_index for candidate_index in range(len(candidates))
        if candidate_index not in candidate_indices
    )
    selected_offer = None
    selected_note = ''
    selected_verdict = ''
    saw_rejected = False
    candidate_verdicts = []
    for candidate_index in candidate_indices:
        candidate = _candidate_at(candidates, candidate_index)
        offer, note, verdict = _validate_offer(
            candidate, query, str(expense.get('name') or ''),
        )
        if note:
            result.warnings.append(note)
        if verdict == 'rejected':
            saw_rejected = True
        candidate_verdicts.append(verdict)
        if verdict == 'verified':
            selected_offer = offer
            selected_note = note
            selected_verdict = verdict
            result.chosen_index = candidate_index
            break

    if selected_verdict == 'verified':
        # Seule une page vérifiée peut apparaître comme lien fournisseur.
        result.offer = selected_offer
        result.match_note = str(raw.get('match_note') or '').strip()
        if selected_offer is not None and selected_offer.get('price_verified'):
            result.unit_price = selected_offer['price']
            result.price_source = 'real_offer'
        else:
            result.price_source = 'ai_estimate'
    else:
        if saw_rejected and candidate_verdicts and all(
            verdict == 'rejected' for verdict in candidate_verdicts
        ) and len(candidate_verdicts) == len(candidates):
            result.status = STATUS_UNPRICED
            result.unit_price = None
            result.price_range_min = None
            result.price_range_max = None
            result.price_source = ''
            result.reason = (
                "Aucun tarif fournisseur vérifiable n'est disponible : aucune "
                "fiche fournisseur pertinente n'a été vérifiée pour cette ressource."
            )
            return result
        # Aucune fiche choisie (ou indice hors bornes) : le prix de l'IA reste
        # une estimation, sans lien.
        result.offer = None
        result.price_source = 'ai_estimate'
        if raw.get('chosen_index') is not None:
            result.warnings.append("Le lien choisi par l'IA n'existe pas parmi les résultats vérifiés.")
    return result


def validate_batch_response(payload, expenses: list[dict],
                            candidates_by_id: dict[str, list[dict]],
                            queries_by_id: dict[str, str]) -> dict[str, ExpenseResult]:
    """Valide une réponse de lot : une entrée par ``expense_id`` attendu.

    Les ``expense_id`` inconnus sont ignorés. Une ressource absente de la
    réponse passe en ``analysis_failed`` — jamais « comprise par défaut ».
    """
    results: dict[str, ExpenseResult] = {}
    raw_items = payload.get('results') if isinstance(payload, dict) else None
    if not isinstance(raw_items, list):
        raw_items = []

    known = {expense['expense_id']: expense for expense in expenses}
    seen: set[str] = set()

    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        expense_id = str(raw.get('expense_id') or '').strip()
        expense = known.get(expense_id)
        if expense is None or expense_id in seen:
            continue  # identifiant inconnu ou répété : ignoré
        seen.add(expense_id)
        results[expense_id] = _validate_one(
            raw, expense, candidates_by_id.get(expense_id, []),
            queries_by_id.get(expense_id, ''),
        )

    for expense in expenses:
        expense_id = expense['expense_id']
        if expense_id not in results:
            results[expense_id] = ExpenseResult(
                expense_id=expense_id,
                status=STATUS_FAILED,
                reason="L'IA n'a pas répondu pour cette ressource.",
            )
    return results


def analyse_expenses(event_context: dict, expenses: list[dict],
                     candidates_by_id: dict[str, list[dict]] | None = None,
                     queries_by_id: dict[str, str] | None = None,
                     timeout: float | None = None) -> dict[str, ExpenseResult]:
    """**Un seul appel IA** pour tout le lot, puis validation stricte."""
    candidates_by_id = candidates_by_id or {}
    queries_by_id = queries_by_id or {}

    if not expenses:
        return {}

    payload = generate_json(
        build_batch_prompt(event_context, expenses),
        _system_prompt(),
        timeout=timeout,
    )
    return validate_batch_response(payload, expenses, candidates_by_id, queries_by_id)


def local_signals_for(item) -> list[str]:
    """Signaux déterministes transmis au modèle (aucun n'est un rejet)."""
    return local_signals(item.name, item.description)


__all__ = [
    'ExpenseResult',
    'STATUS_AMBIGUOUS',
    'STATUS_FAILED',
    'STATUS_PRICED',
    'STATUS_UNPRICED',
    'analyse_expenses',
    'build_batch_prompt',
    'build_expense_payload',
    'local_signals_for',
    'search_query_for',
    'validate_batch_response',
]
