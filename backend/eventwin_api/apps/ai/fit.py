"""Adéquation participant ↔ événements, évaluée par Gemini.

Principe (même philosophie que l'analyse budgétaire : le LLM juge, le serveur
calcule) :

- pour **un participant**, un seul appel compare **tous** les événements
  sélectionnés côte à côte, ce qui rend les écarts entre événements cohérents ;
- le modèle note chaque **dimension** fixe (accessibilité, alimentation…) de
  0 à 100, ou ``null`` quand le profil ne dit rien sur ce point ;
- le **score global** est une moyenne pondérée calculée ici, plafonnée dès
  qu'une contrainte **stricte** du participant n'est pas satisfaite ;
- les « dimensions discriminantes » (celles qui changent le plus d'un
  événement à l'autre) sont calculées ici, pas inventées par le modèle.

Les résultats sont mis en cache par empreinte du profil et des événements.
"""

import hashlib
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.db.models import Q

from apps.budgets.ollama_client import InvalidAiResponse, OllamaError, generate_json
from apps.core.permissions import events_manageable, events_visible, is_super_admin, profile_of
from apps.events.models import Event
from apps.participants.models import EventParticipant, Participant
from apps.participants.models import display_name as user_display_name

from .models import ParticipantFitAnalysis

logger = logging.getLogger(__name__)

PROMPT_VERSION = 'fit-v2'
MAX_EVENTS = 8
MAX_PARTICIPANTS = 30
# Score global maximal quand une contrainte stricte est bloquante.
BLOCKER_CAP = 35
# Écart minimal (points) pour qu'une dimension soit dite discriminante.
DIFFERENTIATOR_MIN_SPREAD = 25
CALL_TIMEOUT = 120.0
MAX_WORKERS = 3

# (clé, libellé, poids dans le score global, consigne donnée au modèle)
DIMENSIONS = [
    ('accessibility', 'Accessibilité', 2.0,
     'handicap, accès PMR, supports adaptés, assises'),
    ('diet', 'Alimentation', 1.5,
     'régime, allergies, alcool'),
    ('mobility', 'Mobilité & transport', 1.5,
     'effort physique, marche, mode de transport, trajet'),
    ('budget', 'Budget', 1.0,
     'frais restant à la charge du participant'),
    ('schedule', 'Rythme & disponibilités', 1.5,
     'horaires, nuits hors domicile, durée, soirées tardives'),
    ('interests', 'Intérêts & objectifs', 2.0,
     'objectif, intérêts tech/social/sport, format souhaité'),
    ('ambiance', 'Ambiance & social', 1.5,
     'calme ou festif, besoin d’espace calme, taille du groupe'),
    ('language', 'Langue', 1.0,
     'langue parlée par le participant vs langue de l’événement'),
]
DIMENSION_KEYS = [key for key, *_ in DIMENSIONS]
WEIGHTS = {key: weight for key, _, weight, _ in DIMENSIONS}

VERDICTS = [
    (75, 'excellent', 'Très adapté'),
    (55, 'good', 'Adapté'),
    (BLOCKER_CAP + 1, 'partial', 'Partiellement adapté'),
    (0, 'poor', 'Peu adapté'),
]

SYSTEM_PROMPT = f"""Tu es un expert en organisation d'événements et en inclusion.
Tu évalues à quel point UN participant est adapté à PLUSIEURS événements, en
comparant les événements entre eux pour ce participant précis.

Règles :
- Base-toi uniquement sur le profil et les descriptions fournis ; n'invente
  aucun fait sur l'événement.
- Note chaque dimension de 0 (incompatible) à 100 (idéal). Mets null si le
  profil ne contient aucune information sur cette dimension.
- Dimensions : {'; '.join(f'{key} = {hint}' for key, _, _, hint in DIMENSIONS)}.
- "blockers" : uniquement les contraintes marquées STRICTE que l'événement, tel
  que décrit, ne peut pas satisfaire sans changement majeur. Liste vide sinon.
- Sois concret et différenciant : explique ce qui change d'un événement à
  l'autre pour CE participant, en citant des éléments précis (horaires,
  menu, effort, hébergement, langue…).
- Dans tous les textes, désigne les événements par leur NOM, jamais par
  leur référence technique (E1, E2…).
- Rédige en français, phrases courtes.

Réponds UNIQUEMENT avec un objet JSON de la forme :
{{
  "events": [
    {{
      "event_ref": "E1",
      "dimensions": {{"<dimension>": {{"score": 0-100 ou null, "note": "justification courte"}}}},
      "blockers": [{{"constraint": "contrainte stricte concernée", "reason": "pourquoi"}}],
      "strengths": ["point fort"],
      "risks": ["point de vigilance"],
      "adaptations": ["aménagement concret qui améliorerait l'adéquation"],
      "summary": "une phrase de synthèse"
    }}
  ],
  "comparison": "2 à 4 phrases : quel événement convient le mieux à ce participant, lequel le moins, et ce qui fait la différence"
}}"""


# --- Portée ------------------------------------------------------------------

def participants_visible(user):
    """Participants que l'utilisateur peut analyser (mêmes règles que l'API)."""
    queryset = Participant.objects.select_related('user').prefetch_related(
        'preferences', 'constraints'
    )
    if is_super_admin(user):
        return queryset
    profile = profile_of(user)
    if profile is None:
        return queryset.none()
    if profile.is_organizer:
        return queryset.filter(
            Q(organization_id=profile.organization_id)
            | Q(event_participations__event__in=events_manageable(user))
        ).distinct()
    return queryset.filter(pk=profile.pk)


def display_name(participant: Participant) -> str:
    return user_display_name(participant.user) or str(participant.pk)


# --- Données envoyées au modèle ---------------------------------------------

def profile_payload(participant: Participant) -> dict:
    return {
        'name': display_name(participant),
        'constraints': sorted(
            [
                {'type': c.constraint_type, 'value': c.value, 'strict': c.is_hard_constraint}
                for c in participant.constraints.all()
            ],
            key=lambda item: (item['type'], item['value']),
        ),
        'preferences': sorted(
            [
                {'type': p.preference_type, 'value': p.value, 'weight': p.weight}
                for p in participant.preferences.all()
            ],
            key=lambda item: (item['type'], item['value']),
        ),
    }


def event_payload(event: Event) -> dict:
    days = None
    if event.start_date and event.end_date:
        days = (event.end_date - event.start_date).days + 1
    schedule = []
    for item in event.schedule_items.order_by('starts_at'):
        offset = (item.starts_at.date() - event.start_date).days + 1 if event.start_date else None
        schedule.append(
            f"J{offset or '?'} {item.starts_at:%H:%M}-{item.ends_at:%H:%M} "
            f"{item.title} ({item.category or 'n/c'}, {item.location or 'lieu n/c'})"
        )
    return {
        'id': str(event.pk),
        'name': event.name,
        'type': event.get_event_type_display(),
        'format': event.get_event_format_display(),
        'objective': event.objective,
        'audience': event.get_audience_type_display(),
        'start_date': event.start_date.isoformat() if event.start_date else None,
        'duration_days': days,
        'location': event.location,
        'mobility_level': event.get_mobility_level_display(),
        'accessibility_level': event.get_accessibility_level_display(),
        'accommodation_required': event.accommodation_required,
        'logistics_notes': event.route_or_logistics_notes,
        'schedule': schedule,
    }


def _model_name() -> str:
    return getattr(settings, 'BUDGET_AI', {}).get('MODEL', getattr(settings, 'GEMINI_MODEL', 'gemini'))


def input_hash(profile: dict, events: list[dict]) -> str:
    raw = json.dumps(
        {'v': PROMPT_VERSION, 'model': _model_name(), 'profile': profile, 'events': events},
        sort_keys=True, ensure_ascii=False,
    )
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def build_prompt(profile: dict, events: list[dict]) -> str:
    lines = ['PARTICIPANT :']
    lines.append(f"- Nom : {profile['name']}")
    if profile['constraints']:
        lines.append('- Contraintes :')
        for c in profile['constraints']:
            tag = 'STRICTE' if c['strict'] else 'souple'
            lines.append(f"  * [{tag}] {c['type']} : {c['value']}")
    else:
        lines.append('- Contraintes : aucune déclarée')
    if profile['preferences']:
        lines.append('- Préférences (poids 1 = faible, 3 = fort) :')
        for p in profile['preferences']:
            lines.append(f"  * {p['type']} : {p['value']} (poids {p['weight']})")
    else:
        lines.append('- Préférences : aucune déclarée')

    lines.append('')
    lines.append('ÉVÉNEMENTS À COMPARER :')
    for index, event in enumerate(events, start=1):
        payload = {key: value for key, value in event.items() if key != 'id'}
        lines.append(f'E{index} = {json.dumps(payload, ensure_ascii=False)}')
    lines.append('')
    lines.append(f'Renvoie exactement {len(events)} entrées dans "events" (E1 à E{len(events)}).')
    return '\n'.join(lines)


# --- Validation et scoring (côté serveur) ------------------------------------

_REF_PATTERN = re.compile(r'\s*\(?\bE\d{1,2}\b\)?')


def _clean(value, limit: int) -> str:
    """Texte affichable : sans références techniques E1/E2 oubliées par le modèle."""
    return _REF_PATTERN.sub('', str(value or '')).strip()[:limit]


def _clamp_score(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(0, min(100, int(round(number))))


def _text_list(value, limit=4) -> list[str]:
    if not isinstance(value, list):
        return []
    items = []
    for entry in value:
        if isinstance(entry, str) and entry.strip():
            items.append(_clean(entry, 300))
        elif isinstance(entry, dict):
            text = ' — '.join(_clean(v, 300) for v in entry.values() if str(v).strip())
            if text:
                items.append(text)
    return items[:limit]


def verdict_for(score):
    if score is None:
        return {'key': 'unknown', 'label': 'Non évalué'}
    for threshold, key, label in VERDICTS:
        if score >= threshold:
            return {'key': key, 'label': label}
    return {'key': 'poor', 'label': 'Peu adapté'}


def score_event(raw: dict) -> dict:
    """Valide la réponse du modèle pour un événement et calcule le score."""
    raw_dims = raw.get('dimensions') if isinstance(raw.get('dimensions'), dict) else {}
    dimensions = {}
    for key in DIMENSION_KEYS:
        entry = raw_dims.get(key)
        if not isinstance(entry, dict):
            entry = {'score': entry} if isinstance(entry, (int, float)) else {}
        dimensions[key] = {
            'score': _clamp_score(entry.get('score')),
            'note': _clean(entry.get('note'), 300),
        }

    blockers = []
    for blocker in raw.get('blockers') or []:
        if isinstance(blocker, dict) and (blocker.get('constraint') or blocker.get('reason')):
            blockers.append({
                'constraint': str(blocker.get('constraint') or '').strip()[:200],
                'reason': _clean(blocker.get('reason'), 300),
            })
        elif isinstance(blocker, str) and blocker.strip():
            blockers.append({'constraint': blocker.strip()[:200], 'reason': ''})

    scored = [(WEIGHTS[k], d['score']) for k, d in dimensions.items() if d['score'] is not None]
    base_score = (
        int(round(sum(w * s for w, s in scored) / sum(w for w, _ in scored))) if scored else None
    )
    score = base_score
    if score is not None and blockers:
        score = min(score, BLOCKER_CAP)

    return {
        'score': score,
        'base_score': base_score,
        'capped': bool(blockers) and base_score is not None and base_score > BLOCKER_CAP,
        'verdict': verdict_for(score),
        'dimensions': dimensions,
        'blockers': blockers,
        'strengths': _text_list(raw.get('strengths')),
        'risks': _text_list(raw.get('risks')),
        'adaptations': _text_list(raw.get('adaptations')),
        'summary': _clean(raw.get('summary'), 400),
    }


def differentiators(results: dict) -> list[dict]:
    """Dimensions dont la note varie le plus entre événements (calcul serveur)."""
    found = []
    for key, label, _, _ in DIMENSIONS:
        scores = [
            (event_id, result['dimensions'][key]['score'])
            for event_id, result in results.items()
            if result['dimensions'][key]['score'] is not None
        ]
        if len(scores) < 2:
            continue
        best = max(scores, key=lambda item: item[1])
        worst = min(scores, key=lambda item: item[1])
        spread = best[1] - worst[1]
        if spread >= DIFFERENTIATOR_MIN_SPREAD:
            found.append({
                'dimension': key, 'label': label, 'spread': spread,
                'best_event_id': best[0], 'best_score': best[1],
                'worst_event_id': worst[0], 'worst_score': worst[1],
            })
    found.sort(key=lambda item: item['spread'], reverse=True)
    return found[:3]


def parse_response(payload: dict, events: list[dict]) -> dict:
    """Transforme la réponse brute en résultat validé, indexé par id d'événement."""
    refs = {f'E{index}': event['id'] for index, event in enumerate(events, start=1)}
    raw_events = payload.get('events') if isinstance(payload.get('events'), list) else []
    results = {}
    for position, raw in enumerate(raw_events):
        if not isinstance(raw, dict):
            continue
        ref = str(raw.get('event_ref') or '').strip().upper()
        event_id = refs.get(ref)
        if event_id is None and position < len(events):
            # Tolère un modèle qui oublie la référence mais respecte l'ordre.
            event_id = events[position]['id']
        if event_id and event_id not in results:
            results[event_id] = score_event(raw)

    missing = [event['name'] for event in events if event['id'] not in results]
    if missing:
        raise InvalidAiResponse(
            "L'IA n'a pas évalué tous les événements (manquant : " + ', '.join(missing) + ').'
        )

    ranked = sorted(
        ((event_id, r['score']) for event_id, r in results.items() if r['score'] is not None),
        key=lambda item: item[1], reverse=True,
    )
    return {
        'results': results,
        'comparison': _clean(payload.get('comparison'), 800),
        'best_event_id': ranked[0][0] if ranked else None,
        'worst_event_id': ranked[-1][0] if len(ranked) > 1 else None,
        'differentiators': differentiators(results),
    }


# --- Orchestration -----------------------------------------------------------

def _ask_model(profile: dict, events: list[dict]) -> dict:
    """Un appel Gemini (le client bascule seul de modèle si le quota est atteint)."""
    payload = generate_json(build_prompt(profile, events), SYSTEM_PROMPT, timeout=CALL_TIMEOUT)
    return parse_response(payload, events)


def analyze(user, event_ids: list[str], participant_ids: list[str] | None, refresh: bool = False) -> dict:
    """Analyse l'adéquation des participants aux événements demandés."""
    event_ids = [str(e) for e in dict.fromkeys(event_ids or [])]
    if not event_ids:
        raise ValueError('Sélectionnez au moins un événement.')
    if len(event_ids) > MAX_EVENTS:
        raise ValueError(f'{MAX_EVENTS} événements maximum par analyse.')

    events_by_id = {
        str(event.pk): event
        for event in events_visible(user).filter(pk__in=event_ids)
    }
    unknown = [e for e in event_ids if e not in events_by_id]
    if unknown:
        raise LookupError('Événement introuvable ou hors de votre périmètre.')
    events = [events_by_id[e] for e in event_ids]
    events_data = [event_payload(event) for event in events]
    # Empreinte indépendante de l'ordre d'affichage des colonnes.
    events_for_hash = sorted(events_data, key=lambda item: item['id'])

    participants_qs = participants_visible(user)
    if participant_ids:
        participant_ids = [str(p) for p in dict.fromkeys(participant_ids)]
        participants = list(participants_qs.filter(pk__in=participant_ids))
        if len(participants) != len(participant_ids):
            raise LookupError('Participant introuvable ou hors de votre périmètre.')
    else:
        participants = list(
            participants_qs.filter(role='participant').order_by('user__last_name', 'user__username')
        )
    truncated = len(participants) > MAX_PARTICIPANTS
    participants = participants[:MAX_PARTICIPANTS]

    jobs = []
    for participant in participants:
        profile = profile_payload(participant)
        jobs.append((participant, profile, input_hash(profile, events_for_hash)))

    cached = {}
    if not refresh:
        for row in ParticipantFitAnalysis.objects.filter(
            participant__in=participants, input_hash__in=[job[2] for job in jobs]
        ):
            cached[(str(row.participant_id), row.input_hash)] = row.result

    to_run = [job for job in jobs if (str(job[0].pk), job[2]) not in cached]
    outcomes = {}
    if to_run:
        # Les threads ne font que l'appel HTTP : toutes les lectures/écritures
        # en base restent dans le thread de la requête.
        with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(to_run))) as pool:
            futures = {
                str(participant.pk): pool.submit(_ask_model, profile, events_for_hash)
                for participant, profile, _ in to_run
            }
            for participant_id, future in futures.items():
                try:
                    outcomes[participant_id] = ('ok', future.result())
                except OllamaError as error:
                    outcomes[participant_id] = ('unavailable', str(error))
                except InvalidAiResponse as error:
                    outcomes[participant_id] = ('invalid', str(error))

    registrations = set(
        EventParticipant.objects.filter(
            participant__in=participants, event__in=events
        ).values_list('participant_id', 'event_id')
    )

    rows = []
    for participant, profile, digest in jobs:
        participant_id = str(participant.pk)
        entry = {
            'id': participant_id,
            'full_name': profile['name'],
            'email': participant.user.email if participant.user else '',
            'profile': {'constraints': profile['constraints'], 'preferences': profile['preferences']},
            'registered_event_ids': [
                str(event.pk) for event in events if (participant.pk, event.pk) in registrations
            ],
            'cached': False,
            'error': None,
        }
        if (participant_id, digest) in cached:
            entry.update(cached[(participant_id, digest)])
            entry['cached'] = True
        else:
            state, value = outcomes[participant_id]
            if state == 'ok':
                ParticipantFitAnalysis.objects.update_or_create(
                    participant=participant, input_hash=digest,
                    defaults={'model_name': _model_name(), 'result': value},
                )
                entry.update(value)
            else:
                entry['error'] = {'kind': state, 'message': value}
        rows.append(entry)

    if rows and all(row['error'] and row['error']['kind'] == 'unavailable' for row in rows):
        raise OllamaError(rows[0]['error']['message'])

    return {
        'model': _model_name(),
        'dimensions': [
            {'key': key, 'label': label, 'weight': weight} for key, label, weight, _ in DIMENSIONS
        ],
        'blocker_cap': BLOCKER_CAP,
        'events': [
            {
                'id': data['id'], 'name': data['name'], 'type': data['type'],
                'format': data['format'], 'start_date': data['start_date'],
                'location': data['location'],
            }
            for data in events_data
        ],
        'participants': rows,
        'truncated': truncated,
    }


def options(user) -> dict:
    """Événements et participants sélectionnables par l'utilisateur."""
    events = events_visible(user).exclude(status='cancelled').order_by('start_date', 'name')
    participants = participants_visible(user).filter(role='participant').order_by(
        'user__last_name', 'user__username'
    )
    return {
        'events': [
            {
                'id': str(event.pk), 'name': event.name,
                'type': event.get_event_type_display(), 'status': event.status,
                'start_date': event.start_date.isoformat() if event.start_date else None,
                'location': event.location,
            }
            for event in events
        ],
        'participants': [
            {
                'id': str(participant.pk), 'full_name': display_name(participant),
                'email': participant.user.email if participant.user else '',
                'constraints_count': len(participant.constraints.all()),
                'preferences_count': len(participant.preferences.all()),
            }
            for participant in participants
        ],
        'limits': {'events': MAX_EVENTS, 'participants': MAX_PARTICIPANTS},
    }


# --- Résultats pour un seul événement (jumeau 3D) ------------------------------

def event_attendees(user, event_id: str) -> tuple[Event, list[Participant]]:
    """Participants inscrits à l'événement, dans le périmètre de l'utilisateur."""
    event = events_visible(user).filter(pk=event_id).first()
    if event is None:
        raise LookupError('Événement introuvable ou hors de votre périmètre.')
    registered = EventParticipant.objects.filter(event=event).values('participant_id')
    participants = list(participants_visible(user).filter(pk__in=registered))
    return event, participants


def event_results(user, event_id: str) -> dict:
    """Dernier résultat Gemini **en cache** de chaque inscrit pour cet événement.

    Aucun appel IA : on relit les analyses déjà faites (depuis le jumeau ou la
    matrice d'adéquation), la plus récente par participant.
    """
    event, participants = event_attendees(user, event_id)
    key = str(event.pk)
    results = {}
    rows = (
        ParticipantFitAnalysis.objects.filter(participant__in=participants)
        .order_by('participant_id', '-created_at')
    )
    for row in rows:
        pid = str(row.participant_id)
        result = (row.result.get('results') or {}).get(key)
        if pid in results or not result:
            continue
        results[pid] = {
            **result,
            'comparison': row.result.get('comparison', '') if len(row.result.get('results') or {}) > 1 else '',
            'analyzed_at': row.created_at.isoformat(),
            'model': row.model_name,
        }
    return {
        'event_id': key,
        'model': _model_name(),
        'attendees': len(participants),
        'missing': [str(p.pk) for p in participants if str(p.pk) not in results],
        'results': results,
    }


def analyze_event(user, event_id: str, refresh: bool = False) -> dict:
    """Analyse Gemini des inscrits (seulement ceux sans résultat, sauf ``refresh``)."""
    current = event_results(user, event_id)
    _, participants = event_attendees(user, event_id)
    ids = [str(p.pk) for p in participants] if refresh else current['missing']
    errors = []
    for start in range(0, len(ids), MAX_PARTICIPANTS):
        batch = ids[start:start + MAX_PARTICIPANTS]
        outcome = analyze(user, [event_id], batch, refresh=refresh)
        errors += [
            {'participant_id': row['id'], 'message': row['error']['message']}
            for row in outcome['participants'] if row['error']
        ]
    payload = event_results(user, event_id)
    payload['errors'] = errors
    return payload
