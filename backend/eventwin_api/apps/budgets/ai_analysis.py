"""
Analyse budgétaire assistée par un LLM local (Ollama).

Répartition des responsabilités :
  - le backend calcule, en ``Decimal``, le statut budgétaire et l'arithmétique
    fiable (total, reste, pourcentage) ;
  - ces résultats, l'événement et les **seules** ressources chiffrées sont
    envoyés au LLM ;
  - le LLM produit scénarios, changements et recommandations — le backend les
    **valide ensuite** : la seule économie acceptée est une réduction de
    quantité recalculée au prix unitaire déjà validé ; les montants annoncés
    par le modèle ne sont jamais repris tels quels ;
  - l'IA ne modifie jamais la base : elle renvoie des propositions.

Un seul appel IA par analyse budgétaire (cf. ``analyse_budget``), indépendant
du nombre de ressources.
"""

from decimal import Decimal

from django.conf import settings

from .ollama_client import generate_json
from .calculations import analysis_mode, build_figures, calculate_optimization, money, money_text

SYSTEM_PROMPT = (
    "Tu es un consultant expert en organisation d'événements. "
    "Tu réponds UNIQUEMENT en JSON valide, sans texte autour, sans commentaire. "
    "Tu parles français. Tu respectes strictement le schéma demandé. "
    "Tu ne calcules jamais les totaux toi-même : ils te sont fournis et tu les réutilises. "
    "Le statut et le mode transmis par l'application sont définitifs : tu ne dois "
    "jamais les contredire. Tu ne dois jamais inventer un prix, une économie, une "
    "offre, un fournisseur, une URL ou une disponibilité."
)

SCHEMA_HINT = """
Réponds avec un objet JSON contenant exactement ces clés :

{
  "summary": "synthèse en français",
  "main_recommendation": {
    "title": "titre court",
    "reason": "justification"
  },
  "scenarios": [
    {
      "name": "nom du scénario",
      "description": "principe du scénario",
      "changes": [
        {
          "expense_id": "identifiant exact d'un poste fourni",
          "strategy": "reduce_quantity|rental|alternative",
          "new_quantity": 0,
          "reason": "pourquoi ce changement"
        }
      ]
    }
  ],
  "recommendations": [
    {
      "title": "...",
      "kind": "improvement|free_improvement|optimization",
      "expense_id": "identifiant exact d'un poste fourni, ou omit",
      "estimated_cost": null,
      "reason": "...",
      "benefit": "..."
    }
  ]
}
""".strip()

OVER_BUDGET_INSTRUCTIONS = """
Le budget est DÉPASSÉ. Ton objectif : ramener le coût total sous le budget
maximal **sans supprimer aucune ressource** et **sans descendre un poste sous
sa quantité minimale** (donnée dans la liste). Commence par les postes
« essentiel=non » les plus coûteux.

La SEULE économie que tu peux proposer est **réelle** : réduire la quantité
d'un poste au-dessus de son minimum requis. Le prix unitaire est déjà connu et
vérifié par l'application : ne l'invente pas, ne le recalcule pas.

Pour chaque changement :
- "expense_id"  : l'identifiant exact du poste fourni dans la liste
- "strategy"    : "reduce_quantity" (ou "rental"/"alternative" **seulement**
  si la ligne fournit une offre vérifiée avec un prix "real_offer")
- "new_quantity": la nouvelle quantité, **entier**, strictement inférieure à
  la quantité actuelle et **jamais inférieure à la quantité minimale**
- "reason"      : pourquoi cette réduction, en une phrase
N'écris NI "new_cost", NI "saving" : l'application les recalcule avec le prix
unitaire réel.

Pour chaque scénario :
- "name", "description"
- "changes" : 1 à 3 changements parmi les postes fournis (jamais deux fois le
  même "expense_id")
- Ne mets NI "new_total" NI "saving" : l'application les recalcule.

"scenarios" est obligatoire et non vide : propose au moins un scénario qui
ramène le total **sous le budget maximal** si c'est possible ; sinon un
scénario d'économie partielle reste acceptable, mais dis-le dans
"description". N'invente jamais de prix, de fournisseur, d'URL ni de produit :
tu ne peux utiliser que les offres vérifiées réellement listées.

Tu peux **aussi** proposer des "recommendations" utiles (kind: "optimization",
"estimated_cost": null) : solutions de location, mutualisation, alternatives
qualitatives… Ne promets jamais qu'une recommandation respecte le budget si
son coût est inconnu.
""".strip()

UNDER_BUDGET_INSTRUCTIONS = """
Le budget n'est PAS dépassé. Propose des améliorations adaptées aux données
de l'événement et aux ressources existantes. Une amélioration sans offre
fournisseur vérifiée doit avoir "estimated_cost": null et être explicitement
qualitative. Ne fabrique aucun prix, fournisseur, URL ou disponibilité.
Chaque recommandation doit avoir "kind": "improvement". Elle doit ajouter de
la valeur à l'événement ou améliorer l'expérience sans réduire une quantité,
supprimer une ressource, diminuer une prestation ou chercher une économie.
Si l'analyse est incomplète, les recommandations doivent rester qualitatives,
indiquer les informations manquantes et ne promettre aucun respect du budget.
La somme des "estimated_cost" des recommandations ne doit pas dépasser le
solde calculé par l'application. "scenarios" doit être un tableau vide [].
Essaie toujours de proposer au moins une amélioration qualitative (coût null)
fondée sur le contexte fourni (participants, type d'événement, contraintes).
Si tu ne peux réellement rien proposer d'utile, renvoie "recommendations": []
ET explique précisément dans "summary" quelle information manque pour
formuler une recommandation : ne reste jamais silencieux.
""".strip()

BALANCED_INSTRUCTIONS = """
Le budget est exactement consommé. Propose seulement des améliorations gratuites
ou à coût nul vérifiable. Toute dépense inconnue doit avoir "estimated_cost":
null et ne doit pas entrer dans le solde. Chaque recommandation doit avoir
"kind": "free_improvement" et ne doit pas réduire une ressource existante.
"scenarios" doit être un tableau vide.
""".strip()

BUDGET_MISSING_INSTRUCTIONS = (
    "Le budget est absent ou invalide. Ne propose aucune réduction, "
    "aucune dépense et aucune recommandation payante. Demande seulement "
    "à l'organisateur de renseigner un budget valide."
)

def _text(value, default='') -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return default


def _number(value):
    """Nombre issu du LLM, ou ``None`` si la valeur est inutilisable.

    Aucun défaut : un ``0`` substitué à une valeur illisible se lirait comme
    « gratuit », et un booléen se lirait comme un prix.
    """
    from .numutils import decimal_or_none

    number = decimal_or_none(value)
    return float(number) if number is not None else None


def _g(value) -> str:
    """Nombre lisible dans le prompt, sans zéro substitué (0 signifie 0)."""
    number = money(value)
    if number is None:
        return '0'
    return f'{number:g}'


def _expense_source(expense) -> dict:
    """Offre réellement rattachée au poste (jamais fabriquée ici)."""
    url = getattr(expense, 'product_url', '') or ''
    price_source = getattr(expense, 'price_source', '') or ''
    return {
        'url': url,
        'domain': getattr(expense, 'offer_domain', '') or '',
        'title': getattr(expense, 'offer_title', '') or '',
        'price_source': price_source,
        'price_verified': price_source == 'real_offer',
    }


def source_status(source: dict) -> str:
    """Statut affichable d'une source : jamais un lien non vérifié.

    - ``no_source``           : aucune page réelle n'est rattachée ;
    - ``verified``            : page réelle **avec** un tarif relevé ;
    - ``page_without_price``  : page réelle mais sans tarif relevé.
    """
    if not source.get('url'):
        return 'no_source'
    return 'verified' if source.get('price_verified') else 'page_without_price'


def _expense_line(expense) -> str:
    """Une ligne de la liste des postes chiffrés, avec sa source réelle."""
    source = _expense_source(expense)
    price_note = {
        'real_offer': 'prix relevé et vérifié sur la page',
        'ai_estimate': 'prix estimé par l’IA',
    }.get(source['price_source'], 'prix inconnu')
    line = (
        f"- id={expense.id} | nom={expense.name} | quantité={_g(expense.quantity)} "
        f"| quantité minimale={_g(getattr(expense, 'min_quantity', None))} "
        f"| essentiel={'oui' if getattr(expense, 'is_essential', False) else 'non'} "
        f"| prix unitaire={_g(expense.unit_price)} EUR ({price_note}) "
        f"| total={_g(expense.total)} EUR"
    )
    if source['url']:
        line += f" | offre vérifiée={source['url']}"
        if source['title']:
            line += f" (« {source['title']} »)"
    else:
        line += " | offre vérifiée=aucune"
    return line


def budget_state(total: Decimal, budget: Decimal | None) -> str:
    """États budgétaires **distincts**, sans aucun seuil arbitraire.

    - ``budget_missing`` : budget absent, nul ou négatif ;
    - ``over_budget``     : total strictement supérieur ;
    - ``exactly_met``     : total strictement égal ;
    - ``within_budget``   : total strictement inférieur.

    Le seuil « 10 % » qui existait autrefois (à l'origine de l'étiquette
    « balanced ») a disparu : la comparaison est exacte, en ``Decimal``.
    """
    if budget is None or budget <= 0:
        return 'budget_missing'
    total = money(total) or Decimal('0.00')
    budget = money(budget)
    if total > budget:
        return 'over_budget'
    if total == budget:
        return 'exactly_met'
    return 'within_budget'


# Clé de compatibilité consommée par le front existant.
_STATUS_COMPAT = {
    'over_budget': 'over_budget',
    'exactly_met': 'on_budget',
    'within_budget': 'under_budget',
    'budget_missing': 'budget_missing',
}


def _computed_summary(status, total, budget, remaining, incomplete):
    if status == 'budget_missing':
        return "Budget absent ou invalide : aucun solde ni recommandation payante ne peut être calculé."
    if incomplete:
        if status == 'over_budget':
            return (
                f"Le total connu de {money_text(total)} dépasse déjà le budget de "
                f"{money_text(budget)} ; l'analyse reste incomplète."
            )
        return (
            f"Le total connu est de {money_text(total)}. Des coûts restent "
            f"inconnus : le solde maximal est de {money_text(remaining)}."
        )
    if status == 'over_budget':
        return (
            f"Le total de {money_text(total)} dépasse le budget de "
            f"{money_text(budget)}."
        )
    if status == 'exactly_met':
        return f"Le total de {money_text(total)} correspond exactement au budget."
    return (
        f"Le total de {money_text(total)} est inférieur au budget de "
        f"{money_text(budget)} ; le solde est de {money_text(remaining)}."
    )


def build_prompt(event: dict, expenses: list, total: Decimal, budget: Decimal) -> str:
    """Assemble le prompt avec des chiffres déjà calculés par l'application."""
    state = budget_state(total, budget)
    over_budget = state == 'over_budget'
    remaining = None if state == 'budget_missing' else (money(budget) - money(total))

    budget_block = {
        'over_budget': OVER_BUDGET_INSTRUCTIONS,
        'exactly_met': BALANCED_INSTRUCTIONS,
        'within_budget': UNDER_BUDGET_INSTRUCTIONS,
        'budget_missing': BUDGET_MISSING_INSTRUCTIONS,
    }[state]

    # Le poste le plus coûteux est souvent la meilleure cible : on le désigne
    # explicitement, les petits modèles mélangent les noms de postes.
    ranked = sorted(expenses, key=lambda expense: money(expense.total) or Decimal('0'), reverse=True)
    top_spend = ranked[0].name if ranked else '(aucun)'

    expenses_block = '\n'.join(_expense_line(expense) for expense in expenses) or '(aucune dépense enregistrée)'

    target_note = (
        f'Chaque scénario doit utiliser uniquement les expense_id fournis et '
        f'ramener le total sous le budget si cela est possible. '
        f'Le total de départ est {float(total):g} EUR.'
        if over_budget
        else (
            f'Le solde calculé est {float(remaining):g} EUR. '
            'Dans ce mode, ne réduis jamais une quantité ou une ressource existante.'
            if remaining is not None else
            'Aucun solde n’est calculable : le budget est inconnu.'
        )
    )
    remaining_label = (
        f'{float(remaining):g} EUR' if remaining is not None else 'inconnu'
    )

    # Données d'événement : jamais de valeur remplacée par défaut. Une donnée
    # absente est annoncée comme telle, pour que le modèle ne l'invente pas.
    participants = event.get('participants')
    participants_label = (
        str(int(participants)) if isinstance(participants, (int, float)) and participants > 0
        else 'non précisé'
    )
    objective = _text(event.get('objective')) or 'non précisé'
    location = _text(event.get('location')) or 'non précisé'

    budget_label = f'{float(budget):g} EUR' if state != 'budget_missing' else 'non défini'
    return f"""
ÉVÉNEMENT
- id : {event['id']}
- nom : {event['name']}
- type : {event['type']}
- objectif : {objective}
- lieu : {location}
- participants : {participants_label}

BUDGET (calculé par l'application, ne le recalcule pas)
- budget total : {budget_label}
- total des dépenses : {float(total):g} EUR
- budget restant : {remaining_label}
- statut : {state}
- mode obligatoire : {"optimization" if over_budget else "improvement" if state == "within_budget" else "free_improvement" if state == "exactly_met" else "none"}
- poste le plus coûteux (information descriptive uniquement) : "{top_spend}"

DÉPENSES ENREGISTRÉES (les seules ressources comprises ET chiffrées)
{expenses_block}

EXCLUSION : d'autres ressources existent pour cet événement mais n'ont PAS été
comprises ou n'ont pas été chiffrées par l'IA : elles ont été écartées avec une
raison, et aucun prix ni fournisseur ne leur a été attribué. NE LES MENTIONNE
PAS, ne leur propose aucun changement, et ne les inclus dans aucun calcul.

CONTRAINTE : "{budget_block}"
RAPPEL : {target_note}

RÈGLES DE COHÉRENCE FINALES
- Si le mode est "improvement", ajoute de la valeur à partir du contexte fourni ;
  ne remplace pas une amélioration par une réduction de coût.
- Si le mode est "free_improvement", ne propose aucune dépense payante.
- Si le mode est "optimization", propose des scénarios d'économie **réels**
  (réduction de quantité au-dessus du minimum) portant sur les postes chiffrés
  transmis, **et** des recommandations qualitatives utiles si tu en as.
- Rattache une recommandation à un poste réel en renseignant son "expense_id" :
  l'application y joindra le lien vérifié de ce poste si elle en a un.
- N'invente jamais un prix, un fournisseur, un produit, une URL ou une
  disponibilité : un lien ne peut venir que des offres vérifiées listées.
- Une recommandation non justifiable par le type, la description, les quantités
  ou le contexte de l'événement doit être omise plutôt que générée.

{SCHEMA_HINT}
""".strip()


def _match_expense(expense_id, expenses: list):
    """Association **uniquement** par identifiant exact.

    Aucune comparaison de sous-chaîne ni de nom : deux ressources distinctes
    peuvent légitimement porter le même libellé, et une ressource ambiguë ne
    doit jamais être reconnue « à moitié ».
    """
    if expense_id in (None, ''):
        return None
    wanted = str(expense_id)
    matches = [expense for expense in expenses if str(expense.id) == wanted]
    return matches[0] if matches else None


def _gap(cost, budget) -> tuple[float | None, float | None]:
    """Reste (positif) et dépassement (positif) d'un coût face au budget."""
    budget_amount = money(budget)
    if budget_amount is None or budget_amount <= 0:
        return None, None
    remaining = money(budget_amount - (money(cost) or Decimal('0.00')))
    if remaining is None:
        return None, None
    return float(remaining), float(max(-remaining, Decimal('0.00')))


def _scenario_changes(raw_scenario: dict, expenses: list) -> list[dict]:
    """Valide les changements d'un scénario et **recalcule** les économies.

    Les seules économies acceptées sont **réelles** : une réduction de la
    quantité d'un poste, valorisée au prix unitaire **déjà validé** par
    l'application. Le modèle propose une quantité, jamais un prix : il ne peut
    donc pas faire entrer un montant inventé dans une économie.

    Un changement est accepté si :
      - le poste existe dans la liste des ressources chiffrées ;
      - son prix unitaire est connu et strictement positif ;
      - ``new_quantity`` est un entier strictement inférieur à la quantité
        actuelle et jamais inférieur au plancher (``min_quantity`` ou 1) ;
      - l'économie recalculée est strictement positive.
    """
    changes: list[dict] = []
    used_ids: set[str] = set()

    raw_changes = raw_scenario.get('changes')
    for change in raw_changes if isinstance(raw_changes, list) else []:
        if not isinstance(change, dict):
            continue

        expense = _match_expense(change.get('expense_id'), expenses)
        # Poste inconnu de la liste (ressource ambiguë, id inventé…) : écarté.
        if expense is None:
            continue
        if str(expense.id) in used_ids:
            continue
        used_ids.add(str(expense.id))

        unit_price = money(expense.unit_price)
        quantity = money(expense.quantity)
        if unit_price is None or unit_price <= 0 or quantity is None or quantity <= 0:
            continue

        old_cost = money(expense.total) or money(unit_price * quantity)
        if old_cost is None or old_cost <= 0:
            continue

        floor = money(getattr(expense, 'min_quantity', None)) or Decimal('0.00')
        if floor < 0:
            floor = Decimal('0.00')
        # Un poste ne descend jamais à zéro : plancher à 1 en l'absence de
        # minimum explicite.
        floor = max(floor, Decimal('1.00'))

        new_quantity = _number(change.get('new_quantity'))
        if new_quantity is None:
            # Repli : un ``new_cost`` strictement inférieur, multiple **exact**
            # du prix unitaire, décrit une réduction de quantité réelle.
            new_cost_hint = money(_number(change.get('new_cost')))
            if new_cost_hint is None or new_cost_hint <= 0:
                continue
            exact, remainder = divmod(new_cost_hint, unit_price)
            if remainder != 0:
                continue
            new_quantity = float(exact)

        new_quantity_decimal = money(new_quantity)
        if new_quantity_decimal is None:
            continue
        integral = new_quantity_decimal.to_integral_value()
        if new_quantity_decimal != integral:
            continue
        new_quantity_decimal = integral
        if new_quantity_decimal < floor or new_quantity_decimal >= quantity:
            continue

        new_cost = money(unit_price * new_quantity_decimal)
        saving = money(old_cost - new_cost) if new_cost is not None else None
        if new_cost is None or saving is None or saving <= 0:
            continue

        source = _expense_source(expense)
        changes.append({
            'expense_id': str(expense.id),
            'expense': expense.name,
            # Seule une réduction de quantité produit une économie réelle : les
            # pistes de location ou d'alternative restent qualitatives et ne
            # sont jamais présentées comme un coût chiffré.
            'strategy': 'reduce_quantity',
            'old_quantity': float(quantity),
            'new_quantity': float(new_quantity_decimal),
            'unit_price': float(unit_price),
            'old_cost': float(old_cost),
            'new_cost': float(new_cost),
            'saving': float(saving),
            'reason': _text(change.get('reason')),
            'source_url': source['url'],
            'source_domain': source['domain'],
            'source_title': source['title'],
            'source_status': source_status(source),
            'price_verified': source['price_verified'],
        })

    return changes


def _normalise_scenarios(raw_scenarios, expenses: list, total, budget=None) -> tuple[list, list]:
    """Ne conserve que les scénarios **cohérents** ; le reste est rejeté.

    Retourne ``(scenarios_valides, motifs_de_rejet)``. Un scénario rejeté n'est
    jamais présenté comme valide : il est compté et expliqué à l'utilisateur.
    Tous les montants sont recalculés ici, jamais repris du modèle.
    """
    scenarios: list[dict] = []
    rejected: list[str] = []

    for raw in raw_scenarios if isinstance(raw_scenarios, list) else []:
        if not isinstance(raw, dict):
            continue

        name = _text(raw.get('name'), 'Scénario')
        changes = _scenario_changes(raw, expenses)
        if not changes:
            rejected.append(f"{name} (aucune réduction de quantité réellement applicable)")
            continue

        saving = money(sum(Decimal(str(change['saving'])) for change in changes))
        new_total = money(money(total) - saving) if saving is not None else None

        if saving is None or saving <= 0 or new_total is None or new_total < 0:
            rejected.append(f"{name} (calcul incohérent)")
            continue

        state = budget_state(new_total, budget)
        remaining_after, overage_after = _gap(new_total, budget)
        scenarios.append({
            'name': name,
            'description': _text(raw.get('description')),
            # Tous les montants ci-dessous sont **recalculés** par le backend.
            'new_total': float(new_total),
            'saving': float(saving),
            'changes': changes,
            # Un scénario retenu est toujours cohérent ; les champs restent
            # pour ne pas casser le contrat JSON du front.
            'changes_saving': float(saving),
            'expected_new_total': float(new_total),
            'is_consistent': True,
            'inconsistencies': [],
            # Le scénario ramène-t-il réellement le coût sous le budget ?
            'budget_respected': state in ('within_budget', 'exactly_met'),
            'remaining_after': remaining_after,
            'overage_after': overage_after,
            'cost_reliability': (
                'Économies calculées par l’application à partir des prix '
                'unitaires déjà validés : seule la quantité change.'
            ),
        })

    return scenarios, rejected


def _normalise_recommendations(raw_recommendations, status, budget, total, expenses=None) -> tuple[list, float]:
    """Filtre les recommandations et recalcule leur somme côté backend.

    Règles :
      - le ``kind`` doit correspondre au mode budgétaire ;
      - titre et justification obligatoires ; les doublons de titre sont
        fusionnés (le premier gagne) ;
      - en dépassement, une recommandation payante serait contradictoire : le
        coût est forcé à ``None`` (piste qualitative) ;
      - sinon un coût **estimé par l'IA** est accepté mais **étiqueté**
        ``cost_source="ai_estimate"`` et jamais présenté comme un prix vérifié ;
        le cumul des suggestions ne dépasse jamais le solde restant ;
      - lorsqu'une recommandation référence un poste chiffré, le lien réel de
        ce poste (s'il existe) lui est rattaché, sans jamais le fabriquer.
    """
    expenses = list(expenses or [])
    recommendations: list[dict] = []
    has_budget = status in ('within_budget', 'exactly_met')
    remaining = (money(budget) - money(total)) if has_budget else None
    expected_kind = {
        'within_budget': 'improvement',
        'exactly_met': 'free_improvement',
        'over_budget': 'optimization',
    }.get(status)
    seen_titles: set[str] = set()
    running_total = Decimal('0.00')

    if expected_kind is None:
        return recommendations, 0.0

    for raw in raw_recommendations if isinstance(raw_recommendations, list) else []:
        if not isinstance(raw, dict):
            continue
        if raw.get('kind') != expected_kind:
            continue

        title = _text(raw.get('title'))
        reason = _text(raw.get('reason'))
        if not title or not reason:
            continue
        key = title.strip().casefold()
        if key in seen_titles:
            continue

        if status == 'over_budget':
            cost = None
        else:
            cost = money(_number(raw.get('estimated_cost')))
            if cost is not None and cost < 0:
                cost = None
            if cost is not None and remaining is not None and running_total + cost > remaining:
                # Le cumul des suggestions dépasserait le solde restant.
                continue

        seen_titles.add(key)
        if cost is not None:
            running_total += cost

        recommendation = {
            'title': title,
            'kind': raw.get('kind'),
            'estimated_cost': float(cost) if cost is not None else None,
            # Un coût de recommandation est toujours une estimation de l'IA :
            # il n'est jamais présenté comme un tarif relevé sur une page.
            'cost_source': 'ai_estimate' if cost is not None else None,
            'reason': reason,
            'benefit': _text(raw.get('benefit')),
            'balance_after': (
                float(remaining - running_total)
                if cost is not None and remaining is not None else None
            ),
        }

        expense = _match_expense(raw.get('expense_id'), expenses)
        if expense is not None:
            source = _expense_source(expense)
            recommendation.update({
                'expense_id': str(expense.id),
                'expense': expense.name,
                'url': source['url'],
                'domain': source['domain'],
                'source_title': source['title'],
                'source_status': source_status(source),
                'price_verified': source['price_verified'],
            })

        recommendations.append(recommendation)

    return recommendations, float(money(running_total) or Decimal('0.00'))


def analyse_budget(
    event: dict,
    expenses: list,
    ambiguous: list | None = None,
    incomplete: bool = False,
    unpriced: list | None = None,
    timeout: float | None = None,
) -> dict:
    """
    **Un seul appel LLM**, puis validation stricte de la réponse.

    ``expenses`` ne contient que les ressources comprises **et** chiffrées :
    les ressources ambiguës (``ambiguous``) et comprises mais non chiffrées
    (``unpriced``) sont totalement exclues — elles n'apparaissent ni dans les
    totaux, ni dans les scénarios, ni dans les recommandations.

    Aucun total n'est calculé par l'IA : tous les montants viennent de l'app.
    """
    ambiguous = list(ambiguous or [])
    unpriced = list(unpriced or [])
    budget_value = event.get('budget')
    budget = Decimal(str(budget_value)) if budget_value is not None else Decimal('0')
    if budget < 0:
        budget = Decimal('0')

    total = sum(
        (money(expense.total) or Decimal('0') for expense in expenses),
        Decimal('0'),
    ).quantize(Decimal('0.01'))
    state = budget_state(total, budget)
    status = _STATUS_COMPAT[state]
    remaining = None if state == 'budget_missing' else (money(budget) - total)

    raw = generate_json(
        build_prompt(event, expenses, total, budget), SYSTEM_PROMPT, timeout=timeout
    )

    # Les scénarios, leurs changements et leurs justifications viennent de
    # l'IA ; les montants sont intégralement recalculés ci-dessous.
    scenarios, rejected_scenarios = (
        _normalise_scenarios(raw.get('scenarios'), expenses, total, budget)
        if state == 'over_budget' else ([], [])
    )
    recommendations, recommendations_total = _normalise_recommendations(
        raw.get('recommendations'), state, budget, total, expenses
    )
    raw_recommendations = raw.get('recommendations')
    raw_recommendations = raw_recommendations if isinstance(raw_recommendations, list) else []
    recommendations_skipped = max(len(raw_recommendations) - len(recommendations), 0)

    recommendation_notice = ''
    if incomplete and state in ('within_budget', 'exactly_met'):
        recommendations = [
            recommendation for recommendation in recommendations
            if recommendation.get('estimated_cost') is None
        ]
        recommendations_total = 0
        recommendation_notice = (
            'Analyse incomplète : les suggestions affichées sont qualitatives. '
            'Complétez les ressources non chiffrées ou ambiguës avant toute '
            'recommandation financière.'
        )
    if not recommendations and state in ('within_budget', 'exactly_met'):
        missing = []
        if unpriced:
            missing.append(f"{len(unpriced)} ressource(s) comprise(s) mais non chiffrée(s)")
        if ambiguous:
            missing.append(f"{len(ambiguous)} ressource(s) ambiguë(s)")
        detail = (
            ' Données manquantes : ' + ', '.join(missing) + '.'
            if missing else ''
        )
        recommendation_notice = recommendation_notice or (
            "Le modèle n'a proposé aucune amélioration exploitable pour cet "
            "événement." + detail + ' Complétez les ressources concernées puis '
            'relancez l’analyse.'
        )
    if rejected_scenarios:
        recommendation_notice = (recommendation_notice + ' ' if recommendation_notice else '') + (
            f"{len(rejected_scenarios)} scénario(s) écarté(s) : aucune réduction de "
            "quantité réellement applicable ne permettait l’économie annoncée. "
            "Ils ne sont pas affichés."
        )

    main = raw.get('main_recommendation') if isinstance(raw.get('main_recommendation'), dict) else {}

    best_saving = max((scenario['saving'] for scenario in scenarios), default=0.0)
    optimization = calculate_optimization(total, budget, Decimal(str(best_saving))) if state == 'over_budget' else {
        'estimated_savings': Decimal('0.00'),
        'total_after_optimization': money(total),
        'remaining_after_optimization': (money(budget) - total) if state != 'budget_missing' else None,
        'overage_after_optimization': (
            max(total - money(budget), Decimal('0.00')) if state != 'budget_missing' else None
        ),
        'feasible': False,
    }
    optimization = {
        key: (float(value) if isinstance(value, Decimal) else value)
        for key, value in optimization.items()
    }

    # Chiffres distincts : budget maximal, coût initial, reste/dépassement,
    # économies, coût des améliorations, coût final. Calculés par l'application.
    figures = build_figures(
        budget,
        total,
        savings=Decimal(str(best_saving)) if state == 'over_budget' else None,
        improvements=(
            Decimal(str(recommendations_total))
            if state in ('within_budget', 'exactly_met') else None
        ),
    )
    main_reason = _text(main.get('reason'))

    return {
        'analysis_mode': analysis_mode(status),
        'status': status,
        # État canonique (nouveaux noms), le champ `status` reste pour le front.
        'budget_state': state,
        'summary': _computed_summary(
            state, float(total), float(money(budget)),
            float(remaining) if remaining is not None else 0.0,
            incomplete,
        ),
        'main_recommendation': {
            # Titre seulement si le modèle a réellement argumenté : jamais une
            # recommandation principale vide présentée comme valable.
            'title': _text(main.get('title')) if main_reason else '',
            'reason': main_reason,
            'new_total': round(float(total) - best_saving, 2) if state == 'over_budget' else 0,
            'saving': best_saving if state == 'over_budget' else 0,
        },
        'scenarios': scenarios,
        'scenarios_rejected': len(rejected_scenarios),
        'recommendations': recommendations,
        'recommendations_notice': recommendation_notice,
        'figures': figures,
        # Ressources écartées de l'analyse, avec la raison affichée à
        # l'utilisateur. Aucun prix ni fournisseur n'est rattaché à ces lignes.
        'ambiguous': ambiguous,
        'unpriced': unpriced,
        # Calculé par l'application, jamais demandé au LLM.
        'computed': {
            'budget': float(money(budget)) if budget > 0 else None,
            'total_expenses': float(money(total)),
            'remaining_budget': float(money(remaining)) if remaining is not None else None,
            'over_budget': state == 'over_budget',
            'status': status,
            'budget_state': state,
            'incomplete': incomplete,
            'usage_rate': round(float(total / money(budget)) * 100, 2) if budget > 0 else None,
            'recommendations_total': recommendations_total,
            'remaining_after_recommendations': (
                float(money(money(budget) - total - Decimal(str(recommendations_total))))
                if budget > 0 else None
            ),
            'optimization': optimization,
            'figures': figures,
            'ambiguous_count': len(ambiguous),
            'unpriced_count': len(unpriced),
            'scenarios_rejected': len(rejected_scenarios),
            'recommendations_skipped': recommendations_skipped,
            # Nom réel du modèle utilisé, pour que l'affichage soit exact.
            'model': getattr(settings, 'BUDGET_AI', {}).get(
                'MODEL', getattr(settings, 'GEMINI_MODEL', 'gemini')
            ),
        },
        'expenses_count': len(expenses),
    }
