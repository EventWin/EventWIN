"""Tableau de bord de supervision : uniquement des chiffres calculés en base.

Portée : les événements que l'utilisateur administre (tous pour le
super-administrateur). Les montants viennent du même calcul que le module
Budget (``calculate_budget``) ; l'adéquation moyenne vient des analyses IA
déjà en cache — aucun appel IA n'est déclenché ici.
"""

from datetime import date

from django.db.models import Count
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.ai.models import ParticipantFitAnalysis
from apps.budgets.calculations import calculate_budget
from apps.budgets.models import BudgetItem
from apps.core.permissions import IsOrganizer, events_manageable, is_super_admin
from apps.participants.models import EventParticipant, display_name

ACTIVITY_LIMIT = 10


def _money(value):
    return float(value) if value is not None else None


def _fit_averages(event_ids: set[str]) -> dict[str, dict]:
    """Moyenne des scores d'adéquation en cache, par événement.

    Seule l'analyse la plus récente de chaque participant est retenue, pour ne
    pas compter deux fois une personne analysée plusieurs fois.
    """
    latest = {}
    for row in ParticipantFitAnalysis.objects.order_by('participant_id', '-created_at'):
        latest.setdefault(row.participant_id, row)
    scores: dict[str, list[int]] = {}
    for row in latest.values():
        for event_id, result in (row.result.get('results') or {}).items():
            if event_id in event_ids and result.get('score') is not None:
                scores.setdefault(event_id, []).append(result['score'])
    return {
        event_id: {'average': round(sum(values) / len(values)), 'count': len(values)}
        for event_id, values in scores.items()
    }


@api_view(['GET'])
@permission_classes([IsOrganizer])
def dashboard(request):
    today = date.today()
    events = list(
        events_manageable(request.user)
        .select_related('organization')
        .annotate(registrations=Count('event_participants', distinct=True))
        .order_by('start_date', 'name')
    )
    event_ids = {str(event.pk) for event in events}

    items_by_event: dict = {}
    for item in BudgetItem.objects.filter(event__in=events):
        items_by_event.setdefault(item.event_id, []).append(item)
    fit = _fit_averages(event_ids)

    rows = []
    for event in events:
        budget = calculate_budget(event, items_by_event.get(event.pk, []))
        days_until = (event.start_date - today).days if event.start_date else None
        finished = bool(event.end_date and event.end_date < today) or event.status in ('completed', 'cancelled')
        rows.append({
            'id': str(event.pk),
            'name': event.name,
            'organization_name': event.organization.name if event.organization else '',
            'event_type': event.get_event_type_display(),
            'status': event.status,
            'status_label': event.get_status_display(),
            'start_date': event.start_date.isoformat() if event.start_date else None,
            'end_date': event.end_date.isoformat() if event.end_date else None,
            'days_until': days_until,
            'finished': finished,
            'location': event.location,
            'registered': event.registrations,
            'expected': event.participant_expected,
            'capacity': event.capacity,
            'budget': _money(budget['budget']),
            'estimated_total': _money(budget['total']),
            'budget_status': budget['status'],
            'usage_rate': _money(budget.get('usage_rate')),
            'priced_count': budget['priced_count'],
            'unpriced_count': budget['unpriced_count'],
            'items_count': len(items_by_event.get(event.pk, [])),
            'fit': fit.get(str(event.pk)),
        })

    # Les plus urgents d'abord : dépassement, puis date la plus proche.
    def urgency(row):
        return (
            row['finished'],
            row['budget_status'] != 'over_budget',
            row['days_until'] if row['days_until'] is not None else 10 ** 6,
        )
    rows.sort(key=urgency)

    active = [row for row in rows if not row['finished'] and row['status'] != 'draft']
    registrations = EventParticipant.objects.filter(event__in=events)

    activity = []
    for link in registrations.select_related('participant__user', 'event').order_by('-created_at')[:ACTIVITY_LIMIT]:
        activity.append({
            'kind': 'registration',
            'at': link.created_at.isoformat(),
            'title': f"{display_name(link.participant.user) if link.participant.user else 'Un participant'} s’est inscrit·e",
            'detail': link.event.name,
            'event_id': str(link.event_id),
        })
    for event in sorted(events, key=lambda e: e.created_at, reverse=True)[:ACTIVITY_LIMIT]:
        activity.append({
            'kind': 'event',
            'at': event.created_at.isoformat(),
            'title': 'Événement créé',
            'detail': event.name,
            'event_id': str(event.pk),
        })
    for analysis in (
        ParticipantFitAnalysis.objects.select_related('participant__user')
        .order_by('-created_at')[:ACTIVITY_LIMIT]
    ):
        touched = [eid for eid in (analysis.result.get('results') or {}) if eid in event_ids]
        if not touched:
            continue
        activity.append({
            'kind': 'fit',
            'at': analysis.created_at.isoformat(),
            'title': 'Adéquation IA calculée',
            'detail': f"{display_name(analysis.participant.user)} · {len(touched)} événement(s)",
            'event_id': None,
        })
    activity.sort(key=lambda entry: entry['at'], reverse=True)

    return Response({
        'scope': 'admin' if is_super_admin(request.user) else 'organizer',
        'totals': {
            'events': len(rows),
            'active': len(active),
            'drafts': sum(1 for row in rows if row['status'] == 'draft'),
            'upcoming_30d': sum(
                1 for row in active if row['days_until'] is not None and 0 <= row['days_until'] <= 30
            ),
            'organizations': len({row['organization_name'] for row in rows if row['organization_name']}),
            'registrations': registrations.count(),
            'participants': registrations.values('participant').distinct().count(),
            'expected': sum(row['expected'] for row in active),
            'budget': sum(row['budget'] or 0 for row in active),
            'estimated_total': sum(row['estimated_total'] or 0 for row in active),
            'over_budget': sum(1 for row in active if row['budget_status'] == 'over_budget'),
            'budget_missing': sum(1 for row in active if row['budget_status'] == 'budget_missing'),
            'without_estimate': sum(1 for row in active if not row['priced_count']),
        },
        'events': rows,
        'activity': activity[:ACTIVITY_LIMIT],
    })
