"""
Client Ollama pour l'analyse budgétaire.

L'IA est un vrai LLM local : Angular appelle Django, Django appelle Ollama.
Aucun calcul de total n'est délégué au modèle : le LLM reçoit des chiffres déjà
calculés et ne produit que des recommandations.

Deux familles d'erreurs sont distinguées, pour ne jamais présenter une réponse
invalide comme une indisponibilité (ni l'inverse) :

- ``OllamaError`` : le service est injoignable, en timeout ou hors service →
  la vue répond 503 « IA indisponible » ;
- ``InvalidAiResponse`` : le service a répondu, mais de façon inexploitable
  (pas de JSON, objet malformé) → la vue répond 502 avec le détail.
"""

import json
import logging
import re
import threading
import time

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)


class OllamaError(Exception):
    """Le service IA est injoignable ou n'a pas répondu à temps."""


class InvalidAiResponse(Exception):
    """Le service IA a répondu, mais la réponse n'est pas exploitable."""


def _config() -> tuple[str, str, float, float]:
    """Lit la configuration **à l'exécution** (jamais à l'import).

    Un timeout lu au moment de l'import ne peut pas être ajusté par
    environnement ni testé, et impose un redémarrage complet pour changer.
    """
    ai = getattr(settings, 'BUDGET_AI', {})
    base = ai.get('BASE_URL', getattr(settings, 'OLLAMA_BASE_URL', 'http://localhost:11434'))
    model = ai.get('MODEL', getattr(settings, 'OLLAMA_MODEL', 'llama3.2:3b'))
    timeout = float(ai.get('TIMEOUT', getattr(settings, 'OLLAMA_TIMEOUT', 180.0)))
    temperature = float(ai.get('TEMPERATURE', 0.4))
    return base.rstrip('/'), model, timeout, temperature


# Cache court d'is_available() : chaque requête ne doit pas payer un appel
# HTTP supplémentaire. Verrouillé car utilisé depuis des threads de recherche
# web parallèles.
_AVAILABILITY_CACHE: dict[str, tuple[float, bool]] = {}
_AVAILABILITY_TTL = 15.0
_AVAILABILITY_LOCK = __import__('threading').Lock()


def is_available(ttl: float = _AVAILABILITY_TTL) -> bool:
    """Ping le serveur, avec un cache court pour ne pas le harceler."""
    base, _, _, _ = _config()
    now = time.monotonic()
    with _AVAILABILITY_LOCK:
        cached = _AVAILABILITY_CACHE.get(base)
        if cached and now - cached[0] < ttl:
            return cached[1]
    try:
        response = httpx.get(f'{base}/api/tags', timeout=5.0)
        available = response.status_code == 200
    except httpx.HTTPError:
        available = False
    with _AVAILABILITY_LOCK:
        _AVAILABILITY_CACHE[base] = (now, available)
    return available


def _strip_code_fence(raw: str) -> str:
    """Retire les ```json ... ``` que les LLM ajoutent souvent."""
    cleaned = raw.strip()
    fenced = re.match(r'^```(?:json)?\s*(.*?)\s*```$', cleaned, re.DOTALL)
    return fenced.group(1) if fenced else cleaned


def _first_json_object(raw: str) -> dict:
    """
    Extrait le premier objet JSON équilibré. Si le modèle ajoute du texte
    autour, on retrouve quand même l'objet sans faire échouer toute la requête.
    """
    text = _strip_code_fence(raw)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find('{')
    while start != -1:
        depth = 0
        in_string = False
        escaped = False

        for position in range(start, len(text)):
            char = text[position]

            if in_string:
                if escaped:
                    escaped = False
                elif char == '\\':
                    escaped = True
                elif char == '"':
                    in_string = False
                continue

            if char == '"':
                in_string = True
            elif char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:position + 1])
                    except json.JSONDecodeError:
                        break

        start = text.find('{', start + 1)

    raise InvalidAiResponse("L'IA n'a pas renvoyé de JSON exploitable.")


def generate_json(prompt: str, system: str, timeout: float | None = None) -> dict:
    """Appelle Ollama et renvoie un objet JSON validé.

    ``timeout`` est lu à l'exécution : il peut être ajusté par requête (les
    lots volumineux demandent plus de temps qu'un appel unitaire).
    """
    base, model, configured_timeout, temperature = _config()
    effective_timeout = float(timeout if timeout is not None else configured_timeout)

    try:
        response = httpx.post(
            f'{base}/api/generate',
            json={
                'model': model,
                'prompt': prompt,
                'system': system,
                # Ollama contraint la sortie au format JSON.
                'format': 'json',
                'stream': False,
                'options': {'temperature': temperature},
            },
            timeout=effective_timeout,
        )
        response.raise_for_status()
    except httpx.TimeoutException as error:
        raise OllamaError(
            f"Ollama n'a pas répondu dans le délai imparti ({int(effective_timeout)}s). "
            'Essayez un modèle plus léger ou vérifiez que le serveur tourne.'
        ) from error
    except httpx.HTTPError as error:
        raise OllamaError(
            f'Ollama est injoignable sur {base}. '
            'Vérifiez que le service est démarré (`ollama serve`).'
        ) from error

    try:
        payload = response.json()
    except ValueError as error:
        raise InvalidAiResponse("La réponse du service IA n'est pas du JSON.") from error

    raw = payload.get('response', '') if isinstance(payload, dict) else ''
    if not isinstance(raw, str) or not raw.strip():
        raise InvalidAiResponse("L'IA a renvoyé une réponse vide.")

    result = _first_json_object(raw)
    if not isinstance(result, dict):
        raise InvalidAiResponse("La réponse de l'IA n'est pas un objet JSON.")

    logger.info('Ollama (%s) a renvoyé une réponse exploitable.', model)
    return result
