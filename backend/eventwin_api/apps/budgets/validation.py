"""Validation d'entrée : **structurel** uniquement.

Règle d'or : la sémantique appartient à l'IA. Ce module ne rejette que ce
qu'aucun modèle ne peut raisonnablement interpréter (vide, aucune lettre, une
seule lettre répétée). Historiquement un dictionnaire ``VAGUE_NAMES`` écartait
de vrais postes (« bar », « autre », « divers », « test ») et un test ASCII
refusait les noms écrits hors alphabet latin : les deux ont disparu.

Les autres signaux (nom très court, faible proportion de lettres, longues
répétitions de caractères) ne sont **jamais** un rejet : ils sont calculés ici,
transmis au LLM comme contexte, et seule l'IA décide si la ressource est
comprise ou ambiguë.
"""

from __future__ import annotations

from .textutils import char_runs, has_letter, is_single_repeated_letter

# Message unique exigé par la spécification fonctionnelle.
INVALID_NAME_MESSAGE = (
    "Le nom de cette ressource n'est pas suffisamment précis. "
    "Veuillez le reformuler pour permettre une estimation correcte."
)

# Seuils **techniques** de détection de signal : ils ne produisent jamais un
# rejet, seulement une information transmise au modèle (cf. local_signals).
SHORT_NAME_LENGTH = 3
LOW_LETTER_RATIO = 0.4
LONG_RUN_LENGTH = 4


def validate_resource_name(name: str) -> tuple[bool, str]:
    """Rejette uniquement le structurel : vide, sans lettre, lettre unique répétée."""
    raw = (name or '').strip()
    if not raw:
        return False, INVALID_NAME_MESSAGE
    if not has_letter(raw):
        return False, INVALID_NAME_MESSAGE
    if is_single_repeated_letter(raw):
        return False, INVALID_NAME_MESSAGE
    return True, ''


def validate_resource_input(name: str, description: str = '') -> tuple[bool, str]:
    """Nom + description : le rejet reste structurel, la sémantique est à l'IA."""
    return validate_resource_name(name)


def local_signals(name: str, description: str = '') -> list[str]:
    """Signaux locaux déterministes, communiqués au LLM mais jamais appliqués.

    Ce sont des **indices**, pas des verdicts : « sono » est court et sonne
    comme une abréviation pourtant parfaitement identifiée, « 1111111 » est
    une répétation sans rapport avec un produit. Seul le modèle peut trancher.
    """
    signals: list[str] = []
    raw = (name or '').strip()
    lowered = raw.lower()

    if len(raw) < SHORT_NAME_LENGTH:
        signals.append(f"nom très court ({len(raw)} caractère{'s' if len(raw) > 1 else ''})")

    letters = sum(1 for char in raw if char.isalpha())
    if raw and letters / len(raw) < LOW_LETTER_RATIO:
        signals.append("le nom contient surtout des chiffres ou des symboles")

    for char, length in char_runs(raw):
        if length >= LONG_RUN_LENGTH:
            signals.append(f"répétition inhabituelle de « {char} » ({length} fois)")

    if not (description or '').strip():
        signals.append("aucune description fournie")

    if lowered != raw.lower().strip() or not raw.islower():
        # Simple rappel de forme : certaines saisies sont en MAJUSCULES ou en
        # leet (« ch41s3 »), ce qui complique l'identification.
        if any(char.isdigit() for char in raw):
            signals.append("le nom contient des chiffres au milieu des lettres")

    return signals


def ambiguity_reason(name: str, description: str = '') -> str:
    """Raison **précise** d'une ressource ambiguë, pour l'affichage.

    Le tableau « Ressources ambiguës » doit expliquer *pourquoi* une ligne a
    été écartée de l'analyse. On ne se contente pas du message générique de
    validation : on dit ce qui ne va pas (structurellement inexploitable, ou
    non compris par le modèle malgré le nom et la description).
    """
    raw = (name or '').strip()
    if not raw:
        return "Aucun nom n'a été saisi pour cette ligne."
    if not has_letter(raw) or is_single_repeated_letter(raw):
        return (
            "Ce nom est structurellement inexploitable : il ne contient "
            "aucune succession de lettres décrivant un produit ou un service."
        )
    if description.strip():
        return (
            "Le nom et la description ne permettent pas d'identifier précisément "
            "le produit ou le service demandé."
        )
    return INVALID_NAME_MESSAGE
