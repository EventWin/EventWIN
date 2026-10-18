"""Calculs budgétaires déterministes.

Ce module est la seule source de vérité pour les totaux et les statuts. Les
valeurs absentes restent absentes : une ligne non chiffrée ne vaut pas zéro.
"""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

MONEY = Decimal("0.01")


def money(value):
    if value is None:
        return None
    try:
        value = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not value.is_finite():
        return None
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def money_text(value) -> str:
    """Montant en français (« 12,50 € »), sans ambiguïté d'arrondi.

    Source unique d'écriture des montants : le même libellé part dans les
    messages du backend et dans les valeurs numériques consommées par le front,
    pour qu'un « 13 € » arrondi ne côtoie jamais un « 12.50 EUR » brut.
    """
    quantized = money(value)
    if quantized is None:
        quantized = Decimal("0.00")
    sign = '-' if quantized < 0 else ''
    whole, _, cents = f'{abs(quantized):.2f}'.partition('.')
    grouped = f'{int(whole):,}'.replace(',', ' ')
    return f'{sign}{grouped},{cents} €'


def item_total(item):
    """Return the validated line total from unit price and quantity.

    ``total`` is kept as a persisted/read-only compatibility field, but it is
    not the source of arithmetic truth when the inputs needed to recalculate
    the line are available.
    """
    unit_price = money(getattr(item, "unit_price", None))
    quantity = money(getattr(item, "quantity", None))
    if unit_price is not None and quantity is not None and unit_price >= 0 and quantity > 0:
        return money(unit_price * quantity)
    return money(getattr(item, "total", None))


def analysis_status_of(item):
    """État canonique d'une ressource, avec repli sur l'ancien modèle de champs.

    L'ancien code déduisait l'état de ``is_ambiguous`` + ``total``. Les objets
    historiques ou les doubles de test sans ``analysis_status`` continuent donc
    de fonctionner, mais la source de vérité est le champ explicite.
    """
    status = getattr(item, "analysis_status", "") or ""
    if status:
        return status
    if getattr(item, "is_ambiguous", False):
        return "ambiguous"
    return "priced" if item_total(item) is not None else "understood_unpriced"


# États pour lesquels la ressource est **exclue** des totaux : aucun prix.
EXCLUDED_STATUSES = ("ambiguous", "analysis_failed", "search_unavailable")


def calculate_budget(event, items, estimate_errors=0):
    """Totaux : seules les ressources **chiffrées** sont comptées, une fois chacune."""
    items = list(items)
    budget = money(getattr(event, "target_budget", None))
    statuses = [analysis_status_of(item) for item in items]

    priced_items = [
        (item, item_total(item))
        for item, status in zip(items, statuses)
        if status == "priced"
    ]
    priced_items = [(item, value) for item, value in priced_items if value is not None]
    priced = [value for _, value in priced_items]
    total = sum(priced, Decimal("0")).quantize(MONEY, rounding=ROUND_HALF_UP)
    verified_total = sum(
        (
            value for item, value in priced_items
            if getattr(item, "price_source", "") == "real_offer"
        ),
        Decimal("0"),
    ).quantize(MONEY, rounding=ROUND_HALF_UP)
    estimated_total = (total - verified_total).quantize(MONEY, rounding=ROUND_HALF_UP)
    ambiguous_count = statuses.count("ambiguous")
    unpriced_count = statuses.count("understood_unpriced")
    excluded_count = sum(1 for status in statuses if status in EXCLUDED_STATUSES)
    pending_count = statuses.count("pending")
    incomplete = bool(
        ambiguous_count or unpriced_count or estimate_errors or excluded_count or pending_count
    )
    # Un prix **estimé** reste un coût connu (approximatif) : il n'est pas
    # « manquant ». L'incertitude est portée séparément par ``total_confidence``
    # (``estimated``/``partial``), pas par ``incomplete``.
    estimated_count = sum(
        1 for item, _ in priced_items
        if getattr(item, "price_source", "") != "real_offer"
    )

    if budget is None or budget <= 0:
        status = "budget_missing"
        remaining = None
        overage = None
        usage_rate = None
    else:
        remaining = (budget - total).quantize(MONEY, rounding=ROUND_HALF_UP)
        overage = max(-remaining, Decimal("0")).quantize(MONEY)
        usage_rate = (total / budget * Decimal("100")).quantize(
            MONEY, rounding=ROUND_HALF_UP
        )
        status = "over_budget" if total > budget else (
            "on_budget" if total == budget else "under_budget"
        )

    return {
        "budget": budget,
        "total": total,
        "verified_total": verified_total,
        "estimated_total": estimated_total,
        "verified_count": len(priced_items) - estimated_count,
        "estimated_count": estimated_count,
        "total_confidence": "verified" if not estimated_count and not incomplete else (
            "estimated" if not (ambiguous_count or unpriced_count or excluded_count or pending_count)
            else "partial"
        ),
        "remaining": remaining,
        "overage": overage,
        "usage_rate": usage_rate,
        "status": status,
        "incomplete": incomplete,
        "priced_count": len(priced),
        "unpriced_count": unpriced_count,
        "ambiguous_count": ambiguous_count,
        "excluded_count": excluded_count,
        "pending_count": pending_count,
        "estimate_error_count": estimate_errors,
    }


def analysis_mode(status):
    """Return the only recommendation mode allowed for a budget status."""
    return {
        "over_budget": "optimization",
        "under_budget": "improvement",
        "on_budget": "free_improvement",
        "budget_missing": "none",
    }.get(status, "none")


def calculate_optimization(total, budget, savings):
    """Recalculate optimization results without trusting model arithmetic."""
    total = money(total) or Decimal("0.00")
    budget = money(budget)
    savings = max(money(savings) or Decimal("0.00"), Decimal("0.00"))
    optimized_total = max(total - savings, Decimal("0.00")).quantize(MONEY)
    remaining = None if budget is None or budget <= 0 else (budget - optimized_total).quantize(MONEY)
    return {
        "estimated_savings": savings,
        "total_after_optimization": optimized_total,
        "remaining_after_optimization": remaining,
        "overage_after_optimization": (
            max(-remaining, Decimal("0.00")).quantize(MONEY)
            if remaining is not None else None
        ),
        "feasible": remaining is not None and remaining >= 0,
    }


def build_figures(budget, total, savings=None, improvements=None):
    """Chiffres **distincts** de l'analyse, tous calculés en ``Decimal``.

    Budget maximal, coût initial, reste/dépassement, économies, coût des
    améliorations et coût final ne se mélangent jamais :

      coût final = coût initial − économies + améliorations

    Les économies ne concernent que le mode « optimisation » et les
    améliorations que le mode « amélioration » ; l'autre vaut zéro.
    """
    budget = money(budget)
    if budget is not None and budget <= 0:
        budget = None
    total = money(total) or Decimal("0.00")
    savings = max(money(savings) or Decimal("0.00"), Decimal("0.00"))
    improvements = max(money(improvements) or Decimal("0.00"), Decimal("0.00"))
    savings = min(savings, total)
    final_cost = (total - savings + improvements).quantize(MONEY, rounding=ROUND_HALF_UP)

    def gap(cost):
        if budget is None:
            return None, None
        remaining = (budget - cost).quantize(MONEY, rounding=ROUND_HALF_UP)
        return remaining, max(-remaining, Decimal("0.00")).quantize(MONEY)

    initial_remaining, initial_overage = gap(total)
    final_remaining, final_overage = gap(final_cost)

    def number(value):
        return float(value) if value is not None else None

    return {
        "budget_max": number(budget),
        "initial_cost": number(total),
        "initial_remaining": number(initial_remaining),
        "initial_overage": number(initial_overage),
        "savings": number(savings),
        "improvements_cost": number(improvements),
        "final_cost": number(final_cost),
        "final_remaining": number(final_remaining),
        "final_overage": number(final_overage),
        "respects_budget": None if budget is None else final_cost <= budget,
    }
