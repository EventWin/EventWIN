"""
Client LLM (Google Gemini) pour l'analyse budgétaire.

Angular appelle Django, Django appelle l'API Gemini (la clé reste côté
serveur). Le module garde son nom historique ``ollama_client`` et ses noms
d'exceptions pour ne pas casser les vues et les tests qui l'importent.
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


def _config() -> tuple[str, str, str, float, float]:
    """Lit la configuration **à l'exécution** (jamais à l'import).

    Un timeout lu au moment de l'import ne peut pas être ajusté par
    environnement ni testé, et impose un redémarrage complet pour changer.
    """
    ai = getattr(settings, 'BUDGET_AI', {})
    base = ai.get('BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')
    api_key = ai.get('API_KEY', '')
    model = ai.get('MODEL', 'gemini-3.5-flash')
    timeout = float(ai.get('TIMEOUT', 180.0))
    temperature = float(ai.get('TEMPERATURE', 0.4))
    return base.rstrip('/'), api_key, model, timeout, temperature


# Cache court d'is_available() : chaque requête ne doit pas payer un appel
# HTTP supplémentaire. Verrouillé car utilisé depuis des threads de recherche
# web parallèles.
_AVAILABILITY_CACHE: dict[str, tuple[float, bool]] = {}
_AVAILABILITY_TTL = 15.0
_AVAILABILITY_LOCK = threading.Lock()


def is_available(ttl: float = _AVAILABILITY_TTL) -> bool:
    """Vérifie que la clé et le modèle sont utilisables, avec un cache court."""
    base, api_key, model, _, _ = _config()
    if not api_key:
        return False
    cache_key = f'{base}/{model}'
    now = time.monotonic()
    with _AVAILABILITY_LOCK:
        cached = _AVAILABILITY_CACHE.get(cache_key)
        if cached and now - cached[0] < ttl:
            return cached[1]
    try:
        response = httpx.get(
            f'{base}/models/{model}',
            headers={'x-goog-api-key': api_key},
            timeout=5.0,
        )
        available = response.status_code == 200
    except httpx.HTTPError:
        available = False
    with _AVAILABILITY_LOCK:
        _AVAILABILITY_CACHE[cache_key] = (now, available)
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


def _http_error_message(response: httpx.Response) -> str:
    """Message lisible pour une erreur HTTP renvoyée par Gemini."""
    try:
        detail = response.json().get('error', {}).get('message', '')
    except ValueError:
        detail = ''
    status = response.status_code
    if status in (401, 403):
        hint = 'Clé API Gemini refusée : vérifiez GEMINI_API_KEY.'
    elif status == 404:
        hint = 'Modèle Gemini introuvable : vérifiez GEMINI_MODEL.'
    elif status == 429:
        hint = 'Quota Gemini atteint : réessayez plus tard.'
    else:
        hint = f'Gemini a répondu une erreur HTTP {status}.'
    return f'{hint} {detail}'.strip()


# --- Repli entre modèles ------------------------------------------------------
# Les quotas Gemini (offre gratuite surtout) sont **par modèle** : un modèle à
# court de quota (429), surchargé (503) ou retiré (404) ne doit pas rendre
# toute l'IA indisponible. On passe au modèle suivant de la chaîne, et le
# modèle en échec est mis de côté quelques minutes pour ne pas gaspiller
# d'appels.
_RETRYABLE_STATUSES = {404, 429, 500, 503}
_COOLDOWN_SECONDS = {429: 15 * 60, 503: 60, 500: 60, 404: 24 * 3600}
_MODEL_COOLDOWN: dict[str, float] = {}
_COOLDOWN_LOCK = threading.Lock()


def model_chain() -> list[str]:
    """Modèle principal puis modèles de repli, sans doublon."""
    ai = getattr(settings, 'BUDGET_AI', {})
    _, _, primary, _, _ = _config()
    fallbacks = ai.get('FALLBACK_MODELS') or []
    return list(dict.fromkeys([primary, *fallbacks]))


def _available_models() -> list[str]:
    chain = model_chain()
    now = time.monotonic()
    with _COOLDOWN_LOCK:
        ready = [m for m in chain if _MODEL_COOLDOWN.get(m, 0) <= now]
    # Tous en pause : on retente quand même dans l'ordre plutôt que d'abandonner.
    return ready or chain


def _cool_down(model: str, status: int | None) -> None:
    with _COOLDOWN_LOCK:
        _MODEL_COOLDOWN[model] = time.monotonic() + _COOLDOWN_SECONDS.get(status or 0, 60)


def generate_json(prompt: str, system: str, timeout: float | None = None) -> dict:
    """Appelle Gemini (avec repli entre modèles) et renvoie un objet JSON validé.

    ``timeout`` est lu à l'exécution : il peut être ajusté par requête (les
    lots volumineux demandent plus de temps qu'un appel unitaire).
    """
    models = _available_models()
    last_error: OllamaError | None = None
    for index, model in enumerate(models):
        try:
            return _generate_with_model(model, prompt, system, timeout)
        except OllamaError as error:
            status = getattr(error, 'status_code', None)
            if status not in _RETRYABLE_STATUSES:
                raise
            _cool_down(model, status)
            last_error = error
            if index < len(models) - 1:
                logger.warning('Gemini %s indisponible (%s) : repli sur %s.', model, status, models[index + 1])
    assert last_error is not None
    raise last_error


def _generate_with_model(model: str, prompt: str, system: str, timeout: float | None) -> dict:
    """Un appel à un modèle Gemini précis."""
    base, api_key, _, configured_timeout, temperature = _config()
    effective_timeout = float(timeout if timeout is not None else configured_timeout)

    if not api_key:
        raise OllamaError(
            "Aucune clé API Gemini configurée (GEMINI_API_KEY) : l'IA est indisponible."
        )

    try:
        response = httpx.post(
            f'{base}/models/{model}:generateContent',
            headers={'x-goog-api-key': api_key},
            json={
                'systemInstruction': {'parts': [{'text': system}]},
                'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
                'generationConfig': {
                    'temperature': temperature,
                    # Gemini contraint la sortie au format JSON.
                    'responseMimeType': 'application/json',
                },
            },
            timeout=effective_timeout,
        )
    except httpx.TimeoutException as error:
        raise OllamaError(
            f"Gemini n'a pas répondu dans le délai imparti ({int(effective_timeout)}s)."
        ) from error
    except httpx.HTTPError as error:
        raise OllamaError(
            f"L'API Gemini est injoignable ({base}). Vérifiez la connexion réseau."
        ) from error

    if response.status_code >= 400:
        error = OllamaError(_http_error_message(response))
        # Permet aux appelants de réessayer sur un quota atteint (429).
        error.status_code = response.status_code
        raise error

    try:
        payload = response.json()
    except ValueError as error:
        raise InvalidAiResponse("La réponse du service IA n'est pas du JSON.") from error

    candidates = payload.get('candidates') if isinstance(payload, dict) else None
    if not candidates:
        reason = (payload.get('promptFeedback') or {}).get('blockReason') if isinstance(payload, dict) else None
        raise InvalidAiResponse(
            f"Gemini n'a renvoyé aucune réponse{f' (bloquée : {reason})' if reason else ''}."
        )
    parts = (candidates[0].get('content') or {}).get('parts') or []
    raw = ''.join(part.get('text', '') for part in parts if isinstance(part, dict))
    if not raw.strip():
        raise InvalidAiResponse("L'IA a renvoyé une réponse vide.")

    result = _first_json_object(raw)
    if not isinstance(result, dict):
        raise InvalidAiResponse("La réponse de l'IA n'est pas un objet JSON.")

    logger.info('Gemini (%s) a renvoyé une réponse exploitable.', model)
    return result
