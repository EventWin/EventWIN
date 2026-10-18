"""API du module Budget & Ressources.

Responsabilités :
  - CRUD des ressources budgétaires, strictement scopé à un événement ;
  - calcul serveur des totaux (jamais délégué au LLM) ;
  - orchestration de l'IA locale (Ollama) : **2 appels maximum par analyse**,
    quel que soit le nombre de ressources (1 lot de ressources + 1 analyse
    budgétaire), avec réutilisation des ressources inchangées (0 appel) ;
  - agrégats de compatibilité read-only consommés par le jumeau numérique
    (/api/budgets/ et /api/budget-categories/), sans casser /app/home.

Code de retour, pour ne jamais confondre deux échecs :

  - **503** : le service IA est injoignable (rien n'est simulé) ;
  - **502** : le service a répondu mais de façon inexploitable (détail par
    ressource) ;
  - **200 partiel** : certaines ressources ont abouti, les autres portent
    leur propre statut (``analysis_failed``, ``search_unavailable``…) ;
  - **409** : une analyse est déjà en cours sur cet événement ;
  - **400** : requête invalide (UUID illisible, quantité ≤ 0…), jamais un 500.
"""

from __future__ import annotations

import threading
import time
import uuid as uuid_lib
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import can_manage_event, events_manageable
from apps.event_filter import EventFilterMixin
from apps.events.models import Event

from . import ai_analysis, estimations, ollama_client, websearch
from .calculations import (
    analysis_mode,
    build_figures,
    calculate_budget,
    item_total,
    money,
    money_text,
)
from .estimations import (
    STATUS_AMBIGUOUS,
    STATUS_FAILED,
    STATUS_PRICED,
    STATUS_UNPRICED,
)
from .models import BudgetItem
from .serializers import BudgetItemSerializer
from .textutils import normalize_text
from .validation import INVALID_NAME_MESSAGE, ambiguity_reason, validate_resource_name


# ---------------------------------------------------------------------------
# Divers
# ---------------------------------------------------------------------------

def _money(value) -> float | None:
    value = money(value)
    return float(value) if value is not None else None


def _incomplete_notice(ambiguous_payload, unpriced_payload, estimate_errors) -> str:
    """Explique **précisément** pourquoi aucune recommandation n'est produite."""
    parts = []
    if unpriced_payload:
        parts.append(f"{len(unpriced_payload)} ressource(s) comprise(s) mais non chiffrée(s)")
    if ambiguous_payload:
        parts.append(f"{len(ambiguous_payload)} ressource(s) ambiguë(s)")
    if estimate_errors:
        parts.append(f"{len(estimate_errors)} échec(s) d'analyse")
    if not parts:
        parts.append("aucune ressource exploitable")
    return (
        "Aucune recommandation n'a été produite : aucun poste chiffré ne permet "
        "de raisonner (" + ', '.join(parts) + "). Complétez ou corrigez ces "
        "ressources, puis relancez l'analyse."
    )


def _duplicate_groups(items) -> list[dict]:
    """Lignes d'identité identique (nom, description, quantité, catégorie).

    L'analyse ne crée, ne fusionne et ne supprime **jamais** de ligne : elle se
    contente de signaler les doublons manifestes pour que l'organisateur
    tranche à la saisie. Deux ressources ne sont « le même besoin » que si
    leur identité complète concorde — jamais sur le seul nom.
    """
    groups: dict[tuple, list] = {}
    for item in items:
        key = (
            normalize_text(item.name),
            normalize_text(item.description),
            str(item.quantity),
            normalize_text(item.category),
        )
        groups.setdefault(key, []).append(item)

    duplicates = []
    for members in groups.values():
        if len(members) < 2:
            continue
        first = members[0]
        duplicates.append({
            'name': first.name,
            'description': first.description or '',
            'quantity': str(first.quantity),
            'category': first.category or '',
            'count': len(members),
            'item_ids': [str(member.pk) for member in members],
        })
    return duplicates


def _model_name() -> str:
    ai = getattr(settings, 'BUDGET_AI', {})
    return ai.get('MODEL', getattr(settings, 'OLLAMA_MODEL', 'ollama'))


def _ai_timeout() -> float:
    return float(getattr(settings, 'BUDGET_AI', {}).get('TIMEOUT', 180.0))


# ---------------------------------------------------------------------------
# Résolution et isolation de l'événement
# ---------------------------------------------------------------------------

class _EventRefused(Exception):
    """Porte une ``Response`` d'erreur (400/403/404) sans lever un 500."""

    def __init__(self, response: Response):
        super().__init__(str(response.data))
        self.response = response


def _authorize_event(request, event: Event) -> None:
    """Contrôle d'accès à l'événement : rôle **et** propriété (anti-IDOR).

    Depuis l'ajout du propriétaire d'événement (``Event.owner``) et des
    permissions RBAC (``apps/core/permissions.py``), ce contrôle vérifie la
    seule règle métier :

    - super-administrateur : accès complet ;
    - organisateur : uniquement ses événements ou ceux de son organisation ;
    - participant (et anonyme) : **refus** — les budgets, ressources, analyses
      IA et simulations sont des données d'organisation, jamais publiques.

    ``EventFilterMixin`` continue de borner chaque queryset par l'identifiant
    fourni ; ce contrôle ajoute la question « à qui appartient cet événement ? ».
    """
    if event is None:
        raise _EventRefused(Response(
            {'error': "Paramètre 'event' manquant, invalide ou événement introuvable."},
            status=status.HTTP_400_BAD_REQUEST,
        ))

    if not can_manage_event(request.user, event):
        raise _EventRefused(Response(
            {'error': 'Événement introuvable ou accès refusé.'},
            status=status.HTTP_403_FORBIDDEN,
        ))


def _event_from_request(request):
    """Résout l'événement ciblé (``?event=<uuid>`` ou corps JSON).

    Un UUID illisible produit **400**, jamais l'erreur ``ValidationError`` de
    Django qui se transformait en 500.
    """
    event_id = (
        request.query_params.get('event')
        or (request.data or {}).get('event')
        or (request.data or {}).get('event_id')
    )
    if not event_id:
        raise _EventRefused(Response(
            {'error': "Paramètre 'event' manquant ou événement introuvable."},
            status=status.HTTP_400_BAD_REQUEST,
        ))

    try:
        parsed = uuid_lib.UUID(str(event_id))
    except (ValueError, TypeError, AttributeError):
        raise _EventRefused(Response(
            {'error': "Paramètre 'event' : identifiant non valide (UUID attendu)."},
            status=status.HTTP_400_BAD_REQUEST,
        ))

    event = Event.objects.filter(pk=parsed).first()
    if event is None:
        # L'identifiant est bien un UUID, mais aucune ligne ne correspond :
        # dire « identifiant non valide » induirait le client en erreur sur la
        # forme alors que c'est le fond qui est faux.
        raise _EventRefused(Response(
            {'error': "Paramètre 'event' : événement introuvable."},
            status=status.HTTP_400_BAD_REQUEST,
        ))

    _authorize_event(request, event)
    return event


# ---------------------------------------------------------------------------
# Verrou par événement : deux analyses simultanées sont refusées
# ---------------------------------------------------------------------------

_ACTIVE_ANALYSES: dict[str, float] = {}
_ACTIVE_LOCK = threading.Lock()

# Champs du lien fournisseur persisté (purge ciblée sans toucher au prix).
OFFER_FIELDS = (
    'provider', 'product_url', 'offer_title', 'offer_domain', 'offer_note',
    'offer_price', 'offer_currency', 'offer_verified_at', 'offer_available',
)


def _analysis_ttl() -> float:
    return float(getattr(settings, 'BUDGET_AI', {}).get('LOCK_TTL', 600.0))


def _acquire_analysis(event_id) -> bool:
    """Marque l'événement comme « analyse en cours ».

    Le verrou porte une date d'expiration : un thread tué ne verrouille pas
    définitivement l'événement. Deux analyses simultanées du même événement
    sont **refusées** (409), pas fusionnées : fusionner reviendrait à payer
    deux fois l'IA pour des résultats mélangés.
    """
    key = str(event_id)
    now = time.monotonic()
    with _ACTIVE_LOCK:
        started = _ACTIVE_ANALYSES.get(key)
        if started is not None and now - started <= _analysis_ttl():
            return False
        _ACTIVE_ANALYSES[key] = now
        return True


def _release_analysis(event_id) -> None:
    with _ACTIVE_LOCK:
        _ACTIVE_ANALYSES.pop(str(event_id), None)


# ---------------------------------------------------------------------------
# Charge utile événement (jamais de valeur remplacée par défaut)
# ---------------------------------------------------------------------------

def _event_payload(event: Event) -> dict:
    """Données transmises à l'IA : une donnée absente est annoncée absente."""
    participants = event.participant_expected or event.participant_target or None
    return {
        'id': str(event.id),
        'name': event.name,
        'type': event.get_event_type_display(),
        # L'objectif et le lieu sont deux sens **distincts** : plus jamais
        # `objective or location`, qui mélangeait les deux.
        'objective': event.objective or '',
        'location': event.location or '',
        'description': event.objective or '',
        'participants': participants,
        'budget': _money(event.target_budget),
    }


def _summary_payload(event: Event, items) -> dict:
    """Totaux calculés côté serveur (source de vérité unique).

    Seules les ressources **chiffrées** sont comptées, une fois chacune. Les
    ressources ambiguës, non chiffrées, en échec ou en attente sont décomptées
    séparément : le total affiché est alors explicitement partiel.
    """
    items = list(items)
    calculated = calculate_budget(event, items)
    status_counts: dict[str, int] = {}
    for item in items:
        status_counts[item.analysis_status] = status_counts.get(item.analysis_status, 0) + 1

    return {
        'event': {
            'id': str(event.id),
            'name': event.name,
            'event_type': event.event_type,
            'event_type_label': event.get_event_type_display(),
            'location': event.location,
            'start_date': event.start_date,
            'end_date': event.end_date,
            'participants': event.participant_expected or event.participant_target or None,
        },
        'budget': _money(calculated['budget']),
        'total_expenses': _money(calculated['total']),
        'verified_total': _money(calculated['verified_total']),
        'estimated_total': _money(calculated['estimated_total']),
        'verified_count': calculated['verified_count'],
        'estimated_count': calculated['estimated_count'],
        'total_confidence': calculated['total_confidence'],
        'remaining_budget': _money(calculated['remaining']),
        'over_budget': calculated['status'] == 'over_budget',
        'status': calculated['status'],
        'incomplete': calculated['incomplete'],
        'overage': _money(calculated['overage']),
        'usage_rate': _money(calculated['usage_rate']),
        'expenses_count': len(items),
        'priced_count': calculated['priced_count'],
        'unpriced_count': calculated['unpriced_count'],
        'ambiguous_count': calculated['ambiguous_count'],
        'estimate_error_count': calculated['estimate_error_count'],
        # Nouveaux champs (additifs : aucune clé existante n'est retirée).
        'pending_count': status_counts.get('pending', 0),
        'search_unavailable_count': status_counts.get('search_unavailable', 0),
        'analysis_failed_count': status_counts.get('analysis_failed', 0),
        'analysis_status_counts': status_counts,
        'model': _model_name(),
    }


def _ai_unavailable(message: str) -> Response:
    """Le service IA est hors service : on le dit, on ne simule rien."""
    return Response(
        {'status': 'unavailable', 'error': message},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


def _ai_invalid(message: str, details: list | None = None) -> Response:
    """Le service a répondu mais de façon inexploitable (502).

    ``details`` est toujours non vide : un 502 sans explication contraignait
    le client à deviner ce qui s'est passé.
    """
    if not details:
        details = [{'error': message}]
    return Response(
        {'status': 'failed', 'error': message, 'details': details},
        status=status.HTTP_502_BAD_GATEWAY,
    )


# ---------------------------------------------------------------------------
# Vue principale
# ---------------------------------------------------------------------------

class BudgetItemViewSet(EventFilterMixin, viewsets.ModelViewSet):
    """CRUD des ressources d'un événement + endpoints IA.

    Le filtrage ``?event=<uuid>`` (EventFilterMixin) garantit qu'une requête ne
    peut jamais mélanger les ressources de deux événements.
    """

    queryset = BudgetItem.objects.select_related('event').all()
    serializer_class = BudgetItemSerializer

    def get_queryset(self):
        event_id = self.request.query_params.get('event')
        if not event_id:
            return self.queryset.none()
        try:
            parsed = uuid_lib.UUID(str(event_id))
        except (ValueError, TypeError, AttributeError):
            # Un identifiant illisible ne doit pas planter la liste.
            return self.queryset.none()
        # Portée : uniquement les événements administrés par l'utilisateur
        # (anti-IDOR : un identifiant étranger ne retourne rien).
        return (
            super().get_queryset()
            .filter(event=parsed, event__in=events_manageable(self.request.user))
            .order_by('category', 'name')
        )

    def perform_create(self, serializer):
        event, error = self._resolve_event_or_error(self.request)
        if error is not None:
            raise serializers.ValidationError(error.data)
        serializer.save(event=event)

    def perform_update(self, serializer):
        """Invalide une estimation devenue obsolète — mais pas pour un motif.

        - **nom, description, catégorie** changés : la ressource n'est plus la
          même, l'analyse est perdue (compréhension, offre et prix) ;
        - **quantité seule** changée : la ressource reste identique, son prix
          unitaire et sa page fournisseur restent valides — seul le total est
          recalculé, **sans aucun appel IA**.
        """
        instance = serializer.instance
        validated = serializer.validated_data

        identity_changed = any(
            field in validated and validated[field] != getattr(instance, field)
            for field in ('name', 'description', 'category')
        )

        if identity_changed:
            # La ressource n'est plus la même : compréhension, offre et prix
            # sont perdus. ``reset_analysis`` modifie l'instance en mémoire,
            # ``serializer.save()'' persiste ensuite l'ensemble.
            instance.reset_analysis()
            serializer.save()
        elif 'quantity' in validated and validated['quantity'] != instance.quantity:
            # Recalcul local du total : quantité × prix unitaire connu.
            new_quantity = validated['quantity']
            if instance.unit_price is not None and instance.analysis_status == STATUS_PRICED:
                serializer.save(quantity=new_quantity, total=money(instance.unit_price * new_quantity))
            else:
                serializer.save(quantity=new_quantity)
        else:
            serializer.save()

    def _resolve_event_or_error(self, request):
        """Variante non levante de ``_event_from_request`` (pour DRF)."""
        try:
            return _event_from_request(request), None
        except _EventRefused as refused:
            return None, refused.response

    # ---- Résumé ------------------------------------------------------------

    @action(detail=False, methods=['get'])
    def summary(self, request):
        try:
            event = _event_from_request(request)
        except _EventRefused as refused:
            return refused.response
        items = BudgetItem.objects.filter(event=event)
        return Response(_summary_payload(event, items))

    # ---- Estimation unitaire ----------------------------------------------

    @action(detail=False, methods=['post'])
    def estimate(self, request):
        """Estime **une** ressource, et la persiste si un id est fourni.

        L'identifiant, s'il est fourni, doit appartenir à l'événement autorisé :
        une ressource d'un autre événement n'est ni lue ni modifiée.
        """
        payload = request.data or {}

        # Un paramètre ``event`` fourni mais illisible/inconnu est une erreur
        # du client : on répond 400 sans lancer le moindre appel réseau.
        # Le cas « à la volée » n'existe que si l'événement n'est **pas du tout**
        # demandé : il reste sans persistance.
        event_param_given = bool(
            request.query_params.get('event')
            or payload.get('event')
            or payload.get('event_id')
        )
        try:
            event = _event_from_request(request)
        except _EventRefused as refused:
            if event_param_given:
                return refused.response
            event = None

        item = None
        item_id = payload.get('id')
        if item_id:
            if event is None:
                return Response(
                    {'error': "Paramètre 'event' obligatoire pour estimer une ressource enregistrée."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                item_uuid = uuid_lib.UUID(str(item_id))
            except (ValueError, TypeError, AttributeError):
                return Response(
                    {'error': 'Identifiant de ressource invalide.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            item = BudgetItem.objects.filter(pk=item_uuid, event=event).first()
            if item is None:
                return Response(
                    {'error': 'Ressource introuvable pour cet événement.'},
                    status=status.HTTP_404_NOT_FOUND,
                )

        quantity = payload.get('quantity', item.quantity if item else 1)
        try:
            quantity_value = Decimal(str(quantity))
        except Exception:  # noqa: BLE001 — quantité illisible
            quantity_value = None
        if quantity_value is None or not quantity_value.is_finite() or quantity_value <= 0:
            return Response(
                {'error': 'Quantité invalide : un nombre strictement positif est requis.',
                 'quantity': str(quantity)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        name = str(payload.get('resource_name') or payload.get('name') or (item.name if item else ''))
        valid, message = validate_resource_name(name)
        if not valid:
            return Response(
                {'understood': False, 'ambiguity_reason': message, 'error': 'validation'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session = websearch.new_session()
        query = estimations.search_query_for(
            name,
            str(payload.get('details') or payload.get('description') or ''),
            event.location if event else '',
        )
        outcome = websearch.search_offers(query, session)
        # Même liste bornée pour le prompt et pour la validation des indices.
        candidates = estimations.prompt_candidates(outcome.results)

        expense = {
            'expense_id': str(item.id) if item else 'ad-hoc',
            'name': name,
            'description': str(payload.get('details') or payload.get('description') or ''),
            'category': item.category if item else 'autre',
            'quantity': str(quantity_value),
            'local_signals': estimations.local_signals_for(
                item if item is not None else type('T', (), {'name': name, 'description': payload.get('details', '')})()
            ),
            'web_candidates': [
                {
                    'index': index,
                    'title': candidate.get('title', ''),
                    'url': candidate.get('url', ''),
                    'domain': candidate.get('domain', ''),
                    'listed_price': candidate.get('price'),
                    'currency': candidate.get('currency', ''),
                }
                for index, candidate in enumerate(candidates)
            ],
        }

        try:
            results = estimations.analyse_expenses(
                _event_payload(item.event) if item is not None else {
                    'id': '', 'name': '', 'type': '', 'objective': '',
                    'location': event.location if event else '', 'participants': None,
                    'budget': None,
                },
                [expense],
                candidates_by_id={expense['expense_id']: candidates},
                queries_by_id={expense['expense_id']: query},
                timeout=_ai_timeout(),
            )
        except ollama_client.OllamaError as error:
            return _ai_unavailable(str(error))
        except ollama_client.InvalidAiResponse as error:
            return _ai_invalid(str(error))

        result = results.get(expense['expense_id'])
        if result is None:
            return _ai_invalid("L'IA n'a pas répondu pour cette ressource.")

        body = {
            'expense_id': result.expense_id,
            'understood': result.understood,
            'status': result.status,
            'ambiguity_reason': result.reason if result.status == STATUS_AMBIGUOUS else '',
            'unpriced_reason': result.reason if result.status == STATUS_UNPRICED else '',
            'unit_price_estimate': _money(result.unit_price),
            'price_range_min': _money(result.price_range_min),
            'price_range_max': _money(result.price_range_max),
            'price_source': result.price_source,
            'offer': result.offer,
            'match_note': result.match_note,
            'warnings': result.warnings,
            'web_search': websearch.search_info(session),
        }

        if item is not None:
            self._apply_result(
                item, result,
                search_failed=(
                    not candidates and (outcome.failed or outcome.capped)
                ),
            )
            body['item'] = BudgetItemSerializer(item).data
        return Response(body)

    # ---- Analyse complète ---------------------------------------------------

    @action(detail=False, methods=['post'])
    def analyze(self, request):
        """Comprend, chiffre et analyse le budget d'un événement.

        Pipeline (voir ``_run_analysis``) :

          1. rejet **structurel** local (aucun appel IA) ;
          2. réutilisation des ressources dont l'empreinte n'a pas changé
             (**0 appel IA**) ;
          3. recherches web parallèles, quota borné, requête déterministe ;
          4. **un** appel IA par lot de ressources (taille configurable) ;
          5. validation stricte puis persistance en transaction ;
          6. **un** appel IA pour l'analyse budgétaire, seulement s'il existe
             des ressources chiffrées.

        Soit **2 appels IA au maximum**, quelle que soit la taille du budget.
        """
        try:
            event = _event_from_request(request)
        except _EventRefused as refused:
            return refused.response

        items = list(BudgetItem.objects.filter(event=event))
        if not items:
            return Response(
                {'error': 'Ajoutez au moins une ressource avant de lancer une analyse.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Quantité invalide : erreur explicite. Jamais remplacée par 1 ni par 0.
        invalid_quantity = [
            item.name for item in items
            if item.quantity is None or item.quantity <= 0
        ]
        if invalid_quantity:
            return Response(
                {
                    'error': 'quantity',
                    'message': (
                        'Quantité invalide pour : ' + ', '.join(invalid_quantity) +
                        '. Un nombre strictement positif est requis.'
                    ),
                    'resources': invalid_quantity,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not _acquire_analysis(event.id):
            return Response(
                {'error': 'analysis_running',
                 'message': 'Une analyse est déjà en cours pour cet événement.'},
                status=status.HTTP_409_CONFLICT,
            )

        handed_off = False
        try:
            response, handed_off = self._run_analysis(event, items)
            return response
        except _EventRefused as refused:
            return refused.response
        except ollama_client.OllamaError as error:
            return _ai_unavailable(str(error))
        except ollama_client.InvalidAiResponse as error:
            return _ai_invalid(str(error))
        finally:
            if not handed_off:
                _release_analysis(event.id)

    # ---- Pipeline d'analyse --------------------------------------------------

    def _run_analysis(self, event: Event, items: list[BudgetItem]) -> tuple[Response, bool]:
        started_at = time.monotonic()
        deadline = started_at + float(
            getattr(settings, 'BUDGET_AI', {}).get('ANALYSIS_TIMEOUT', 120.0)
        )
        session = websearch.new_session()
        estimate_errors: list[dict] = []
        ai_calls = 0

        # --- 1) Rejet structurel local (0 appel IA) --------------------------
        reusable_statuses = {
            'priced', 'ambiguous',
        }
        to_analyze: list[BudgetItem] = []
        structural: list[BudgetItem] = []

        for item in items:
            valid, _ = validate_resource_name(item.name)
            if not valid:
                item.mark_ambiguous(ambiguity_reason(item.name, item.description))
                item.analysis_fingerprint = item.compute_fingerprint(event.event_type)
                structural.append(item)
                continue
            fingerprint = item.compute_fingerprint(event.event_type)
            if (
                item.analysis_fingerprint == fingerprint
                and item.analysis_status in reusable_statuses
            ):
                # Ressource inchangée : déjà comprise. Aucun appel, aucune
                # recherche — la quantité ne fait pas partie de l'empreinte.
                # Seul le total est éventuellement recalculé localement.
                if item.analysis_status == STATUS_PRICED and item.unit_price is not None:
                    recalculated = money(item.unit_price * item.quantity)
                    if recalculated is not None and recalculated != money(item.total):
                        item.total = recalculated
                        item.save(update_fields=['total'])
                # Le lien persisté est revalidé à chaque analyse : un domaine
                # devenu exclu (dictionnaire, encyclopédie…) ou une adresse
                # illisible ne doit pas survivre, même sur une ressource
                # inchangée. Purge locale, sans appel réseau.
                if item.product_url:
                    cleaned = websearch.clean_url(item.product_url)
                    if not cleaned:
                        item.clear_offer_fields()
                        item.save(update_fields=OFFER_FIELDS)
                    elif cleaned != item.product_url:
                        item.product_url = cleaned
                        item.provider = websearch.domain_of(cleaned) or item.provider
                        item.offer_domain = item.provider
                        item.save(update_fields=['product_url', 'provider', 'offer_domain'])
                continue
            item.analysis_fingerprint = fingerprint
            to_analyze.append(item)

        if structural:
            with transaction.atomic():
                for item in structural:
                    item.save()

        # --- 2) Recherches web (parallèles, quota borné par analyse) ---------
        candidates_by_id: dict[str, list[dict]] = {}
        queries_by_id: dict[str, str] = {}
        search_failed_by_id: dict[str, bool] = {}

        if to_analyze:
            queries = {
                item: estimations.search_query_for(item.name, item.description, event.location)
                for item in to_analyze
            }
            for item, query in queries.items():
                queries_by_id[str(item.pk)] = query

            # Concurrence bornée (settings) : la durée ne croît plus avec le
            # nombre de ressources.
            workers = min(
                int(getattr(settings, 'BUDGET_SEARCH', {}).get('CONCURRENCY', 4)),
                max(1, len(to_analyze)),
            )
            with ThreadPoolExecutor(max_workers=workers) as pool:
                outcomes = list(pool.map(
                    lambda item: websearch.search_offers(queries[item], session),
                    to_analyze,
                ))
            for item, outcome in zip(to_analyze, outcomes):
                # Liste bornée **une seule fois** : le prompt et la validation
                # des indices lisent exactement la même liste.
                candidates_by_id[str(item.pk)] = estimations.prompt_candidates(
                    outcome.results
                )
                # Panne ou quota épuisé, et rien de trouvé : la ressource n'a
                # simplement pas pu être cherchée (ce n'est pas une ambiguïté).
                search_failed_by_id[str(item.pk)] = (
                    not outcome.results and (outcome.failed or outcome.capped)
                )

        # --- 3) Appels IA : **un par lot**, jamais par ressource -------------
        batch_size = max(1, int(getattr(settings, 'BUDGET_AI', {}).get('BATCH_SIZE', 8)))
        batches = [
            to_analyze[index:index + batch_size]
            for index in range(0, len(to_analyze), batch_size)
        ]

        context = _event_payload(event)
        failed_batches = 0

        for index, batch in enumerate(batches):
            if index > 0 and time.monotonic() > deadline:
                # Délai global dépassé : la suite part en tâche de fond, le
                # front reçoit immédiatement l'état partiel + un préavis.
                break
            payload = [
                estimations.build_expense_payload(
                    item,
                    estimations.local_signals_for(item),
                    candidates_by_id.get(str(item.pk), []),
                )
                for item in batch
            ]
            try:
                results = estimations.analyse_expenses(
                    context,
                    payload,
                    candidates_by_id=candidates_by_id,
                    queries_by_id=queries_by_id,
                    timeout=_ai_timeout(),
                )
                ai_calls += 1
            except ollama_client.OllamaError as error:
                # Service injoignable : on marque le lot en échec proprement.
                # Si c'est le tout premier échec, la vue renverra 503.
                failed_batches += 1
                estimate_errors.extend(
                    {'resource': item.name, 'error': str(error)} for item in batch
                )
                with transaction.atomic():
                    for item in batch:
                        item.analysis_status = STATUS_FAILED
                        item.save(update_fields=['analysis_status'])
                if index == 0:
                    raise
                continue
            except ollama_client.InvalidAiResponse as error:
                failed_batches += 1
                estimate_errors.extend(
                    {'resource': item.name, 'error': str(error)} for item in batch
                )
                with transaction.atomic():
                    for item in batch:
                        item.analysis_status = STATUS_FAILED
                        item.save(update_fields=['analysis_status'])
                if index == 0:
                    raise
                continue

            with transaction.atomic():
                for item in batch:
                    result = results.get(str(item.pk))
                    if result is None:
                        item.analysis_status = STATUS_FAILED
                        item.save(update_fields=['analysis_status'])
                        estimate_errors.append({
                            'resource': item.name,
                            'error': "Aucun résultat renvoyé par l'IA pour cette "
                                     "ressource.",
                        })
                        continue
                    if result.status == STATUS_FAILED:
                        # Un échec par ressource n'est jamais silencieux : il
                        # remonte au front comme les autres erreurs.
                        estimate_errors.append({
                            'resource': item.name,
                            'error': result.reason or (
                                "L'IA n'a pas répondu pour cette ressource."
                            ),
                        })
                    self._apply_result(
                        item, result,
                        search_failed=search_failed_by_id.get(str(item.pk), False),
                    )
                    if result.warnings and not item.offer_note:
                        item.offer_note = ' '.join(result.warnings)[:2000]
                        item.save(update_fields=['offer_note'])

        # --- 4) État courant, après persistance ------------------------------
        items = list(BudgetItem.objects.filter(event=event))
        priced_items = [
            item for item in items
            if item.analysis_status == STATUS_PRICED and item_total(item) is not None
        ]
        ambiguous_items = [item for item in items if item.analysis_status == STATUS_AMBIGUOUS]
        unpriced_items = [
            item for item in items if item.analysis_status == STATUS_UNPRICED
        ]

        ambiguous_payload = [
            self._resource_payload(item, item.ambiguity_reason or INVALID_NAME_MESSAGE)
            for item in ambiguous_items
        ]
        unpriced_payload = [
            self._resource_payload(item, item.unpriced_reason)
            for item in unpriced_items
        ]

        incomplete = bool(
            ambiguous_items or unpriced_items or estimate_errors
            or any(item.analysis_status in ('pending', 'search_unavailable', 'analysis_failed')
                   for item in items)
        )

        # --- 5) Analyse budgétaire : **un** appel, seulement s'il y a un prix -
        background = False
        if priced_items and time.monotonic() <= deadline:
            try:
                analysis = ai_analysis.analyse_budget(
                    context,
                    [_ExpenseView(item) for item in priced_items],
                    ambiguous=ambiguous_payload,
                    unpriced=unpriced_payload,
                    incomplete=incomplete,
                    timeout=_ai_timeout(),
                )
                ai_calls += 1
            except ollama_client.InvalidAiResponse as error:
                return _ai_invalid(
                    str(error),
                    [{'resource': '(analyse budgétaire)', 'error': str(error)}],
                ), False
        elif priced_items:
            # Délai dépassé : la suite est exécutée en tâche de fond.
            background = True
            analysis = None
        elif unpriced_payload and time.monotonic() <= deadline:
            # Rien n'est chiffré, mais des ressources ont été **comprises** :
            # on demande tout de même des recommandations **qualitatives**
            # (sans prix), pour ne pas rester muet. C'est le second appel.
            try:
                analysis = ai_analysis.analyse_budget(
                    context,
                    [],
                    ambiguous=ambiguous_payload,
                    unpriced=unpriced_payload,
                    incomplete=True,
                    timeout=_ai_timeout(),
                )
                ai_calls += 1
            except (ollama_client.OllamaError, ollama_client.InvalidAiResponse):
                # L'analyse budgétaire est un bonus : son échec ne remet pas en
                # cause les ressources déjà analysées. On retombe sur l'état
                # déterministe, qui explique honnêtement l'absence de conseil.
                analysis = None
        else:
            analysis = None

        if background:
            self._start_background_analysis(event, session, deadline)

        if analysis is None:
            # Pas d'analyse IA disponible (aucune ressource chiffrée, ou
            # tâche de fond lancée) : on produit un état déterministe **sans
            # rien simuler** — mêmes clés, aucun contenu IA inventé.
            analysis = self._deterministic_analysis(
                event, items, ambiguous_payload, unpriced_payload, estimate_errors
            )

        # --- 6) Complétion côté application (source de vérité) ---------------
        analysis['items'] = BudgetItemSerializer(items, many=True).data
        analysis['estimate_errors'] = estimate_errors
        # Doublons d'identité évidente : signalés, jamais fusionnés par l'IA.
        analysis['duplicates'] = _duplicate_groups(items)
        analysis['web_search'] = websearch.search_info(session)
        analysis['web_search']['note'] = (
            analysis['web_search']['note']
            + (f" {len(structural)} ressource(s) écartée(s) avant analyse : "
               f"structurellement inexploitable(s)."
               if structural else '')
        )
        analysis['unpriced'] = unpriced_payload
        analysis['ai_calls'] = ai_calls
        analysis['background'] = background
        analysis.setdefault('computed', {})['ai_calls'] = ai_calls

        computed = calculate_budget(event, items, len(estimate_errors))
        analysis['status'] = computed['status']
        analysis['incomplete'] = computed['incomplete'] or incomplete
        analysis['analysis_mode'] = analysis_mode(computed['status'])
        status_counts: dict[str, int] = {}
        for item in items:
            status_counts[item.analysis_status] = status_counts.get(item.analysis_status, 0) + 1
        analysis.setdefault('computed', {}).update({
            'budget': _money(computed['budget']),
            'total_expenses': _money(computed['total']),
            'remaining_budget': _money(computed['remaining']),
            'overage': _money(computed['overage']),
            'over_budget': computed['status'] == 'over_budget',
            'status': computed['status'],
            'incomplete': analysis['incomplete'],
            'priced_count': computed['priced_count'],
            'unpriced_count': computed['unpriced_count'],
            'ambiguous_count': computed['ambiguous_count'],
            'excluded_count': computed['excluded_count'],
            'pending_count': computed['pending_count'],
            'estimate_error_count': computed['estimate_error_count'],
            # Les trois états de ressource (chiffrée / comprise non chiffrée /
            # ambiguë) plus les états d'échec, pour que le front n'ait pas à
            # les deviner de ``items``.
            'analysis_status_counts': status_counts,
            'model': _model_name(),
        })
        if analysis['incomplete'] and not analysis.get('recommendations_notice'):
            analysis['recommendations_notice'] = (
                'Analyse budgétaire incomplète : certains coûts restent inconnus. '
                'Les suggestions qualitatives peuvent être examinées, mais aucun solde '
                'ne doit être interprété comme définitif.'
            )
        if background:
            analysis['recommendations_notice'] = (
                "Le délai d'analyse est dépassé : les recommandations sont produites "
                "en arrière-plan. Rechargez la page dans quelques instants pour les "
                "afficher ; les prix ci-dessous sont déjà calculés."
            )
        # Chiffres distincts (budget max, coût initial, reste/dépassement,
        # économies, améliorations, coût final), recalculés sur les totaux
        # définitifs : jamais les montants bruts du modèle.
        ai_computed = analysis.setdefault('computed', {})
        savings = (
            (ai_computed.get('optimization') or {}).get('estimated_savings')
            if computed['status'] == 'over_budget' else None
        )
        improvements = (
            ai_computed.get('recommendations_total')
            if computed['status'] in ('under_budget', 'on_budget') else None
        )
        analytical_figures = build_figures(
            computed['budget'], computed['total'],
            savings=savings, improvements=improvements,
        )
        ai_computed['figures'] = analytical_figures
        analysis['figures'] = analytical_figures
        # ``background`` dit à l'appelant de ne **pas** rendre le verrou :
        # la tâche de fond le libère elle-même en fin de travail.
        return Response(analysis), background

    # ---- Tâche de fond ------------------------------------------------------

    def _start_background_analysis(self, event: Event, session, deadline: float) -> None:
        """Termine l'analyse budgétaire après la réponse HTTP.

        Aucune dépendance externe : un simple thread daemon. Le verrou reste
        pris jusqu'à la fin du travail, et les connexions DB du thread sont
        fermées proprement. L'état reste interrogeable via ``/summary/``.
        """
        event_id = event.id

        def worker():
            try:
                items = list(BudgetItem.objects.filter(event_id=event_id))
                priced_items = [
                    item for item in items
                    if item.analysis_status == STATUS_PRICED and item_total(item) is not None
                ]
                if not priced_items:
                    return
                ambiguous_payload = [
                    self._resource_payload(item, item.ambiguity_reason or INVALID_NAME_MESSAGE)
                    for item in items if item.analysis_status == STATUS_AMBIGUOUS
                ]
                unpriced_payload = [
                    self._resource_payload(item, item.unpriced_reason)
                    for item in items if item.analysis_status == STATUS_UNPRICED
                ]
                ai_analysis.analyse_budget(
                    _event_payload(Event.objects.get(pk=event_id)),
                    [_ExpenseView(item) for item in priced_items],
                    ambiguous=ambiguous_payload,
                    unpriced=unpriced_payload,
                    incomplete=True,
                    timeout=_ai_timeout(),
                )
            except Exception:  # noqa: BLE001 — jamais d'exception non gérée en fond
                import logging
                logging.getLogger(__name__).exception(
                    "Analyse budgétaire de fond interrompue (%s).", event_id
                )
            finally:
                _release_analysis(event_id)
                from django.db import connections
                connections.close_all()

        threading.Thread(target=worker, daemon=True, name=f'budget-analysis-{event_id}').start()

    # ---- Analyse déterministe (aucun appel IA) ------------------------------

    @staticmethod
    def _deterministic_analysis(event, items, ambiguous_payload, unpriced_payload,
                                estimate_errors) -> dict:
        """Analyse sans LLM, utilisée quand il n'y a rien à appeler.

        Produit les mêmes clés qu'une analyse normale (contrat front respecté),
        mais sans scénario ni recommandation : ne jamais simuler un contenu IA.
        """
        calculated = calculate_budget(event, items, len(estimate_errors))
        # L'état canonique vient de la même fonction que le chemin IA :
        # ``calculate_budget`` renvoie l'état compat (``under_budget``) pour
        # l'ancien front, jamais l'état canonique (``within_budget``).
        state = ai_analysis.budget_state(calculated['total'], calculated['budget'])
        summary = (
            'Aucune ressource n’a été chiffrée : rien n’a été analysé. '
            'Reformulez les lignes ci-dessous puis relancez l’analyse.'
            if not calculated['priced_count'] else
            f"Total connu : {money_text(calculated['total'])} "
            f"(analyse déterministe, sans appel IA)."
        )
        return {
            'status': calculated['status'],
            'budget_state': state,
            'incomplete': calculated['incomplete'],
            'summary': summary,
            'main_recommendation': {'title': '', 'reason': '', 'new_total': 0, 'saving': 0},
            'scenarios': [],
            'scenarios_rejected': 0,
            'recommendations': [],
            'recommendations_notice': _incomplete_notice(
                ambiguous_payload, unpriced_payload, estimate_errors
            ),
            'figures': build_figures(calculated['budget'], calculated['total']),
            'ambiguous': ambiguous_payload,
            'unpriced': unpriced_payload,
            'computed': {
                'budget': _money(calculated['budget']),
                'total_expenses': _money(calculated['total']),
                'remaining_budget': _money(calculated['remaining']),
                'overage': _money(calculated['overage']),
                'over_budget': calculated['status'] == 'over_budget',
                'status': calculated['status'],
                'budget_state': state,
                'incomplete': calculated['incomplete'],
                'usage_rate': _money(calculated['usage_rate']),
                'recommendations_total': 0.0,
                'figures': build_figures(calculated['budget'], calculated['total']),
                'ambiguous_count': len(ambiguous_payload),
                'unpriced_count': len(unpriced_payload),
                'priced_count': calculated['priced_count'],
                'excluded_count': calculated['excluded_count'],
                'pending_count': calculated['pending_count'],
                'model': _model_name(),
            },
            'analysis_mode': analysis_mode(calculated['status']),
            'expenses_count': 0,
        }

    # ---- Helpers ------------------------------------------------------------

    @staticmethod
    def _resource_payload(item: BudgetItem, reason: str) -> dict:
        """Charge utile d'une ressource écartée : aucun champ monétaire."""
        return {
            'id': str(item.id),
            'name': item.name,
            'quantity': float(item.quantity or 0),
            'category': item.category,
            'category_label': item.get_category_display(),
            'description': item.description,
            'reason': reason,
        }

    @classmethod
    def _apply_result(cls, item: BudgetItem, result, search_failed: bool = False) -> None:
        """Reporte un résultat **validé** sur la ressource, sans rien inventer.

        Les invariants sont portés par ``BudgetItem.mark_*`` : une ressource
        écartée n'a ni prix, ni fournisseur, ni lien ; une ressource non
        chiffrée n'a jamais ``total = 0``.

        ``search_failed`` signale que la recherche web n'a rien donné pour
        cette ressource (panne ou quota épuisé) : si le modèle n'a pas osé de
        montant, l'état ``search_unavailable`` dit à l'organisateur que
        réessayer plus tard est utile — ce n'est **pas** une ambiguïté.
        """
        item.analysis_fingerprint = item.compute_fingerprint(
            item.event.event_type if item.event_id else ''
        )
        item.estimated_at = timezone.now()

        if result.status == STATUS_AMBIGUOUS:
            item.mark_ambiguous(result.reason)
            item.analysis_fingerprint = item.compute_fingerprint(
                item.event.event_type if item.event_id else ''
            )
            item.estimated_at = None
            item.save()
            return

        if result.status == STATUS_FAILED:
            item.clear_priced_fields()
            item.is_ambiguous = False
            item.ambiguity_reason = ''
            item.unpriced_reason = ''
            item.analysis_status = STATUS_FAILED
            item.estimated_at = None
            item.save()
            return

        offer = result.offer or {}
        url = str(offer.get('url') or '')
        # Jamais de troncature : on conserve l'URL telle quelle, même si elle
        # dépasse la longueur maximale du champ. La validation côté modèle
        # s'applique séparément ; ici, la règle métier est de ne pas la couper.

        item.provider = str(offer.get('domain') or offer.get('provider') or '')[:255]
        item.product_url = url
        item.offer_title = str(offer.get('title') or '')[:300]
        item.offer_domain = str(offer.get('domain') or '')[:255]
        item.offer_note = ' '.join(result.warnings)[:2000]
        item.offer_price = offer.get('price') if offer.get('price_verified') else None
        item.offer_currency = str(offer.get('currency') or '')[:10]
        item.offer_verified_at = timezone.now() if url else None
        available = offer.get('available')
        item.offer_available = available if isinstance(available, bool) else None

        if result.status == STATUS_UNPRICED:
            if search_failed and not result.offer:
                item.mark_unpriced(
                    result.reason or (
                        "Recherche web indisponible et aucun tarif proposé : "
                        "relancez l'analyse ultérieurement."
                    ),
                    status='search_unavailable',
                )
            else:
                item.mark_unpriced(
                    result.reason,
                    preserve_offer=bool(offer.get('verified') and url),
                )
            item.save()
            return

        # --- Chiffrée --------------------------------------------------------
        quantity = item.quantity
        unit_price = result.unit_price
        if quantity is None or quantity <= 0 or unit_price is None:
            item.mark_unpriced(
                result.reason or "Quantité ou prix unitaire invalide : aucun total calculé."
            )
            item.save()
            return
        item.mark_priced()
        if result.price_source == 'real_offer' and item.offer_price is not None:
            # Tarif réellement relevé sur la page retenue.
            item.price_source = 'real_offer'
            item.unit_price = item.offer_price
        else:
            # Estimation de l'IA, **explicitement étiquetée** comme telle : elle
            # n'est jamais présentée comme un tarif fournisseur.
            item.price_source = 'ai_estimate'
            item.unit_price = unit_price
        # Le total est **toujours** calculé par l'application.
        item.total = money(item.unit_price * quantity)
        item.price_range_min = result.price_range_min
        item.price_range_max = result.price_range_max
        item.estimated_at = timezone.now()
        item.save()


class _ExpenseView:
    """Adaptateur vers l'interface attendue par ``ai_analysis``."""

    __slots__ = (
        'id', 'name', 'quantity', 'unit_price', 'total', 'min_quantity',
        'is_essential', 'price_source', 'product_url', 'offer_title',
        'offer_domain',
    )

    def __init__(self, item: BudgetItem):
        self.id = item.id
        self.name = item.name
        self.quantity = item.quantity
        self.unit_price = item.unit_price
        self.total = item_total(item)
        self.min_quantity = item.min_quantity
        self.is_essential = item.is_essential
        self.price_source = item.price_source
        # Offre réelle déjà rattachée à la ressource : jamais fabriquée ici.
        self.product_url = item.product_url
        self.offer_title = item.offer_title
        self.offer_domain = item.offer_domain


# ---------------------------------------------------------------------------
# Agrégats de compatibilité (jumeau numérique)
# ---------------------------------------------------------------------------

class BudgetCompatView(APIView):
    """Agrégat read-only pour le jumeau : GET /api/budgets/?event=<uuid>.

    Correction d'un bug d'agrégat : ``total_budget`` contenait la **somme des
    estimations**, qui n'est pas un budget. Il porte désormais le budget réel
    de l'événement (``Event.target_budget``) ; la somme des estimations est
    exposée dans un champ distinct, sans retirer les clés lues par le front.
    """

    def get(self, request):
        try:
            event = _event_from_request(request)
        except _EventRefused:
            return Response([])

        items = list(BudgetItem.objects.filter(event=event))
        calculated = calculate_budget(event, items)
        return Response([
            {
                'id': str(event.id),
                'event': str(event.id),
                'name': f'Budget — {event.name}',
                # Budget **réel** de l'événement (fiche événement).
                'total_budget': str(calculated['budget'] or Decimal('0.00')),
                # Somme des seules ressources chiffrées (total partiel).
                'estimated_total': str(calculated['total']),
                'target_budget': str(calculated['budget'] or Decimal('0.00')),
                'remaining_budget': (
                    str(calculated['remaining'])
                    if calculated['remaining'] is not None else None
                ),
                'currency': getattr(settings, 'BUDGET_CURRENCY', '') or None,
                # Transparence sur ce qui n'est pas encore chiffré.
                'priced_count': calculated['priced_count'],
                'unpriced_count': calculated['unpriced_count'],
                'ambiguous_count': calculated['ambiguous_count'],
                'incomplete': calculated['incomplete'],
            }
        ])


class BudgetCategoryCompatView(APIView):
    """Agrégat read-only par catégorie : GET /api/budget-categories/?event=<uuid>.

    Sémantique des champs, désormais explicite :

    - ``planned_amount`` : somme des **estimations IA** connues pour la
      catégorie (ce que l'application sait, pas un plan validé) ;
    - ``actual_amount`` : dépense réellement constatée. **Le projet ne suit
      aucune dépense réelle** : ce champ est donc toujours ``null`` plutôt
      que dupliquer ``planned_amount`` en faisant croire à deux mesures
      différentes ;
    - ``estimated_amount`` : doublon explicite de ``planned_amount`` ;
    - ``unpriced_count`` / ``ambiguous_count`` : lignes non comptées.

    Chaque ressource n'entre qu'une fois, dans sa seule catégorie, et seules
    les lignes chiffrées sont additionnées.
    """

    def get(self, request):
        try:
            event = _event_from_request(request)
        except _EventRefused:
            return Response([])

        buckets: dict[str, Decimal] = {}
        unpriced_counts: dict[str, int] = {}
        ambiguous_counts: dict[str, int] = {}

        for item in BudgetItem.objects.filter(event=event):
            key = item.category or 'autre'
            if item.analysis_status == 'ambiguous':
                ambiguous_counts[key] = ambiguous_counts.get(key, 0) + 1
                continue
            total = item_total(item)
            if total is None:
                unpriced_counts[key] = unpriced_counts.get(key, 0) + 1
                continue
            buckets[key] = buckets.get(key, Decimal('0')) + total

        labels = dict(BudgetItem.CATEGORIES)
        keys = sorted(set(buckets) | set(unpriced_counts) | set(ambiguous_counts))
        return Response([
            {
                'id': f'{event.id}-{key}',
                'budget': str(event.id),
                'name': labels.get(key, key),
                'planned_amount': str(buckets.get(key, Decimal('0')).quantize(Decimal('0.01'))),
                'estimated_amount': str(buckets.get(key, Decimal('0')).quantize(Decimal('0.01'))),
                # Aucune dépense réelle n'est suivie : null, jamais un doublon.
                'actual_amount': None,
                'unpriced_count': unpriced_counts.get(key, 0),
                'ambiguous_count': ambiguous_counts.get(key, 0),
            }
            for key in keys
        ])
