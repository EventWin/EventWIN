"""Sourcing **vérifié** des propositions de l'assistant budgétaire.

Le LLM ne connaît aucun prix et ne fournit aucune URL : il propose seulement
des *pistes* (un produit ou un service à chercher). Ce module les confronte au
web réel :

  1. recherche de pages candidates (``websearch.search_offers``) ;
  2. contrôle de chaque page (``websearch.validate_direct_offer``) : page
     atteinte, marchande, et qui parle bien de ce qui est cherché ;
  3. un montant n'est retenu que s'il a été **lu sur la page** (JSON-LD
     Product/Offer), dans la devise du budget. Un tarif en devise étrangère
     n'est jamais converti ni additionné.

Résultat, par piste, l'un de quatre statuts — jamais confondus :

  - ``verified``           : page vérifiée **et** tarif relevé (en euros) ;
  - ``page_without_price`` : page réelle et pertinente, mais aucun tarif
    exploitable : le lien peut être affiché, jamais un coût ;
  - ``search_failed``      : panne réseau ou quota épuisé (réessayer a un sens) ;
  - ``no_source``          : aucune page fiable trouvée.

Aucune valeur n'est fabriquée ici : en l'absence de source, le coût reste
inconnu et le dit explicitement.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from decimal import Decimal

from django.conf import settings

from . import websearch
from .numutils import decimal_or_none
from .textutils import normalize_text

# Devise du budget : on n'additionne jamais deux devises.
BUDGET_CURRENCY = 'EUR'

VERIFIED = 'verified'
PAGE_WITHOUT_PRICE = 'page_without_price'
SEARCH_FAILED = 'search_failed'
NO_SOURCE = 'no_source'


@dataclass
class SourcedOffer:
    """Verdict de sourcing pour une piste."""

    status: str = NO_SOURCE
    reason: str = ''
    url: str = ''
    domain: str = ''
    title: str = ''
    unit_price: Decimal | None = None
    currency: str = ''
    available: bool | None = None

    @property
    def has_price(self) -> bool:
        return self.status == VERIFIED and self.unit_price is not None

    @property
    def has_link(self) -> bool:
        return bool(self.url) and self.status in (VERIFIED, PAGE_WITHOUT_PRICE)


def _max_validations() -> int:
    cfg = getattr(settings, 'BUDGET_SEARCH', {})
    return max(1, int(cfg.get('MAX_VALIDATIONS_PER_IDEA', 3)))


def _concurrency() -> int:
    return max(1, int(getattr(settings, 'BUDGET_SEARCH', {}).get('CONCURRENCY', 4)))


def build_query(query: str, location: str = '') -> str:
    """Requête déterministe : la piste du modèle, plus le lieu s'il est connu."""
    parts = [normalize_text(query)]
    if (location or '').strip():
        parts.append(normalize_text(location))
    return ' '.join(part for part in parts if part).strip()


def _verdict_of(payload) -> str:
    """Verdict d'une page ; un contrat historique sans clé est jugé sur ``verified``."""
    if not isinstance(payload, dict):
        return 'unreachable'
    verdict = str(payload.get('verdict') or '').strip()
    if verdict:
        return verdict
    return 'verified' if payload.get('verified') else 'unreachable'


def find_offer(query: str, identity: str, session) -> SourcedOffer:
    """Cherche une page réelle pour ``query`` et relève son tarif s'il existe."""
    cleaned = (query or '').strip()
    if not cleaned:
        return SourcedOffer(NO_SOURCE, "Aucune requête de recherche exploitable.")

    outcome = websearch.search_offers(cleaned, session)
    results = list(getattr(outcome, 'results', None) or [])
    if not results:
        if getattr(outcome, 'failed', False) or getattr(outcome, 'capped', False):
            return SourcedOffer(
                SEARCH_FAILED,
                "Recherche web indisponible ou quota atteint : aucune source "
                "n'a pu être consultée.",
            )
        return SourcedOffer(NO_SOURCE, "Aucune page fiable trouvée sur le web.")

    fallback: SourcedOffer | None = None
    for candidate in results[:_max_validations()]:
        url = websearch.clean_url(str(candidate.get('url') or ''))
        if not url:
            continue
        payload = websearch.validate_direct_offer(url, cleaned, identity or '')
        if _verdict_of(payload) != 'verified':
            continue

        final_url = websearch.clean_url(str(payload.get('url') or '')) or url
        price = decimal_or_none(payload.get('price'))
        currency = str(payload.get('currency') or '').upper()
        available = payload.get('available')
        offer = SourcedOffer(
            status=PAGE_WITHOUT_PRICE,
            url=final_url,
            domain=websearch.domain_of(final_url),
            title=str(payload.get('title') or candidate.get('title') or '').strip(),
            currency=currency,
            available=available if isinstance(available, bool) else None,
        )
        priced = (
            bool(payload.get('price_verified'))
            and price is not None and price > 0
        )
        if priced and currency == BUDGET_CURRENCY:
            offer.status = VERIFIED
            offer.unit_price = price
            return offer
        if priced:
            offer.reason = (
                f"Tarif relevé en {currency or 'devise inconnue'} : non converti, "
                "donc non utilisé dans les calculs."
            )
        else:
            offer.reason = (
                "Page réelle et pertinente, mais aucun tarif n'y a été relevé."
            )
        if fallback is None:
            fallback = offer

    return fallback or SourcedOffer(
        NO_SOURCE,
        "Aucune page marchande vérifiée parmi les résultats de recherche.",
    )


def find_offers(requests: dict, session) -> dict:
    """Sourcing en parallèle ; ``requests`` : ``clé -> (requête, identité)``.

    Le quota de recherches vit dans ``session`` : il est borné par analyse.
    Aucune exception ne remonte : une piste en échec devient ``search_failed``.
    """
    if not requests:
        return {}

    def work(key):
        query, identity = requests[key]
        try:
            return key, find_offer(query, identity, session)
        except Exception:  # noqa: BLE001 — une piste cassée ne casse pas l'analyse
            return key, SourcedOffer(
                SEARCH_FAILED, "La vérification de cette piste a échoué."
            )

    workers = min(_concurrency(), len(requests))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return dict(pool.map(work, list(requests)))
