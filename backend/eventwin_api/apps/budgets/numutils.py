"""Validation stricte des nombres produits par le LLM.

Toutes les valeurs chiffrées passent par **une seule** fonction, qui renvoie
``None`` dès que la valeur n'est pas un nombre décimal exploitable. C'est elle
qui empêche les accidents observés en production :

- ``Decimal('NaN')`` accepté, puis planté plus tard sur un comparateur ;
- ``Decimal('Infinity')`` accepté, total infini affiché ;
- ``True``/``False`` acceptés comme ``1``/``0`` (un booléen n'est pas un prix) ;
- un prix négatif présenté comme une économie ;
- ``"12,50 €"`` ou ``"N/A"`` convertis en 0 silencieusement.

Un montant inconnu **reste** ``None`` : il n'est jamais remplacé par zéro.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation


def decimal_or_none(value) -> Decimal | None:
    """Nombre décimal ≥ 0, ou ``None`` si la valeur est inutilisable."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        number = value
    else:
        try:
            number = Decimal(str(value).replace(',', '.').strip())
        except (InvalidOperation, TypeError, ValueError):
            return None
    if not number.is_finite() or number < 0:
        return None
    return number


def positive_decimal_or_none(value) -> Decimal | None:
    """Nombre décimal **strictement** positif, ou ``None``."""
    number = decimal_or_none(value)
    return number if number is not None and number > 0 else None


def clean_choice_index(value, count: int) -> int | None:
    """Index entier dans ``[0, count)`` : les booléens sont rejetés.

    Un LLM répond souvent ``true`` là où un index est attendu, ou ``"2"`` sous
    forme de chaîne. Ces valeurs sont normalisées **uniquement** si elles
    désignent réellement un élément de la liste ; sinon l'offre est écartée
    plutôt que choisie au hasard.
    """
    if isinstance(value, bool) or value is None or count <= 0:
        return None
    if isinstance(value, int):
        index = value
    elif isinstance(value, float):
        if not float(value).is_integer():
            return None
        index = int(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped.lstrip('-').isdigit():
            return None
        index = int(stripped)
    else:
        return None
    return index if 0 <= index < count else None


def parse_range(low, high) -> tuple[Decimal | None, Decimal | None]:
    """Contraint ``low ≤ high`` ; sinon la fourchette est écartée.

    Une fourchette inversée (« 80 – 20 ») n'est jamais corrigée silencieusement :
    elle est abandonnée, faute de savoir quelle borne est la bonne.
    """
    low_number = decimal_or_none(low)
    high_number = decimal_or_none(high)
    if low_number is None or high_number is None:
        return None, None
    if low_number > high_number:
        return None, None
    return low_number, high_number
