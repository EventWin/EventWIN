"""Normalisation de texte partagée par tout le module Budget.

Historiquement la même fonction était recopiée dans ``validation.py``,
``ai_analysis.py`` et ``websearch.py`` : chaque copie dérivait légèrement, ce
qui faisait qu'une ressource « Chaises » pouvait être comprise à un endroit et
rejetée ailleurs. Il n'existe désormais **qu'une** définition, en Unicode
complet (aucun test ASCII) : « gâteau », « стол » ou « 直子 » passent tous.
"""

from __future__ import annotations

import re
import unicodedata

_WHITESPACES = re.compile(r"\s+")


def normalize_text(value) -> str:
    """Forme de comparaison : minuscules, sans accent, espaces réduits."""
    if value is None:
        return ''
    text = str(value).strip().lower()
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(char for char in text if not unicodedata.combining(char))
    return _WHITESPACES.sub(' ', text)


def letters_only(value) -> str:
    """Conserve uniquement les lettres Unicode (accents compris)."""
    if value is None:
        return ''
    return ''.join(char for char in str(value) if char.isalpha())


def has_letter(value) -> bool:
    """Vrai si la chaîne contient au moins une lettre (toute écriture)."""
    return bool(letters_only(value))


def is_single_repeated_letter(value) -> bool:
    """Vrai si la chaîne ne contient qu'une seule et même lettre répétée.

    C'est le seul cas, avec le vide et l'absence totale de lettre, qui est
    rejeté localement : « aaaa », « éééé » ou « пп » n'ont aucune chance
    d'être interprétés, même par un LLM.
    """
    letters = normalize_text(letters_only(value)).replace(' ', '')
    return len(letters) > 1 and len(set(letters)) == 1


def char_runs(value) -> list[tuple[str, int]]:
    """Séries de caractères identiques consécutifs, avec leur longueur.

    Sert à produire un **signal** (jamais un rejet) transmis au LLM : une
    répétition anormale est utile à comprendre, mais seule l'IA peut trancher.
    """
    runs: list[tuple[str, int]] = []
    current = ''
    for char in str(value or ''):
        if char == current[-1:] and char.strip():
            current += char
        else:
            if len(current) > 1:
                runs.append((current[0], len(current)))
            current = char
    if len(current) > 1:
        runs.append((current[0], len(current)))
    return runs
