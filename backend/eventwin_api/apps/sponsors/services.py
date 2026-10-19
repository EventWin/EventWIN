import csv
import io
import itertools
import os
import re
import unicodedata
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from urllib.parse import urlparse

from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import EmailMultiAlternatives, get_connection
from django.core.validators import URLValidator, validate_email
from django.db import transaction
from django.db.models import QuerySet
from django.template.loader import render_to_string
from django.utils import timezone

from apps.participants.models import Participant

from .models import DEAL_STATUS_DEFAULT_PROBABILITY

LEGAL_SUFFIX_RE = re.compile(
    r'\b(s\.?a\.?s\.?|s\.?a\.?r\.?l\.?|s\.?a\.?|inc\.?|ltd\.?|gmbh|llc|plc)\b',
    re.IGNORECASE,
)


def normalize_sponsor_name(name):
    if not name:
        return ''
    decomposed = unicodedata.normalize('NFD', str(name))
    stripped = ''.join(ch for ch in decomposed if unicodedata.category(ch) != 'Mn')
    stripped = LEGAL_SUFFIX_RE.sub(' ', stripped)
    stripped = re.sub(r'[^a-zA-Z0-9]+', ' ', stripped.lower())
    return re.sub(r'\s+', ' ', stripped).strip()


def normalize_website_domain(website):
    if not website:
        return ''
    raw = str(website).strip()
    if not raw:
        return ''
    if '://' not in raw:
        raw = 'https://' + raw
    host = (urlparse(raw).hostname or '').lower()
    if host.startswith('www.'):
        host = host[4:]
    return host


def find_duplicate_sponsors(organization, name, website=''):
    """Return sponsors of the same organization whose normalized name or domain match."""
    from .models import Sponsor

    org_id = getattr(organization, 'pk', organization)
    if not org_id:
        return []

    target_name = normalize_sponsor_name(name)
    target_domain = normalize_website_domain(website)
    if not target_name and not target_domain:
        return []

    matches = []
    queryset = Sponsor.objects.filter(organization_id=org_id)
    if isinstance(queryset, QuerySet):
        queryset = queryset.iterator()
    for sponsor in queryset:
        if target_name and normalize_sponsor_name(sponsor.name) == target_name:
            matches.append(sponsor)
            continue
        if target_domain and normalize_website_domain(sponsor.website) == target_domain:
            matches.append(sponsor)
    return matches


def log_activity(deal, actor, action, message='', **kwargs):
    from .models import SponsorshipActivity

    return SponsorshipActivity.objects.create(
        deal=deal,
        actor=actor if isinstance(actor, Participant) else None,
        action=action,
        message=message or '',
        from_status=kwargs.get('from_status') or '',
        to_status=kwargs.get('to_status') or '',
    )


# ---------------------------------------------------------------------------
# Constantes et configuration (modifiables sans toucher à la logique)
# ---------------------------------------------------------------------------

TWO_PLACES = Decimal('0.01')

OPEN_STATUSES = ('lead', 'contacted', 'proposal_sent', 'negotiating')
COMMITTED_STATUSES = ('signed', 'paid')
ENGAGED_STATUSES = ('negotiating', 'signed', 'paid')
ALL_STATUSES = OPEN_STATUSES + COMMITTED_STATUSES + ('lost',)

ALLOWED_TRANSITIONS = {
    'lead': {'contacted', 'lost'},
    'contacted': {'proposal_sent', 'lost'},
    'proposal_sent': {'negotiating', 'lost'},
    'negotiating': {'signed', 'lost'},
    'signed': {'paid', 'lost'},
    'paid': set(),
    'lost': {'lead'},
}

DEFAULT_PAYMENT_PLAN = [
    {'pct': 30, 'label': 'Acompte à la signature', 'anchor': 'signature', 'offset_days': 0},
    {'pct': 70, 'label': 'Solde avant l\'événement', 'anchor': 'event_start', 'offset_days': -30},
]

DEFAULT_EXPOSURE_WEIGHTS = {
    'naming': 5,
    'speaking_slot': 4,
    'booth': 3,
    'logo_placement': 2,
    'attendee_data': 1.5,
    'social_post': 1,
    'goodies': 1,
    'other': 0.5,
}

DEFAULT_FIT_WEIGHTS = {
    'industry': 0.30,
    'audience_size': 0.15,
    'budget': 0.20,
    'history': 0.15,
    'audience_match': 0.20,
}

FIT_LABELS = {
    'industry': 'Secteur vs type d\'événement',
    'audience_size': 'Taille et nature de l\'audience',
    'budget': 'Budget cohérent avec les packages',
    'history': 'Historique de partenariats',
    'audience_match': 'Audience concernée par le secteur',
}

# Affinité secteur -> type d'événement (0 à 1). Valeur par défaut : 0.4.
INDUSTRY_EVENT_AFFINITY = {
    'finance': {'conference': 1, 'gala': 1, 'product_launch': 0.6, 'workshop': 0.5, 'internal_meeting': 0.4, 'retreat': 0.4, 'road_trip': 0.2},
    'tech': {'conference': 1, 'workshop': 1, 'product_launch': 1, 'retreat': 0.5, 'internal_meeting': 0.4, 'gala': 0.5, 'road_trip': 0.3},
    'retail': {'product_launch': 1, 'gala': 0.8, 'conference': 0.6, 'workshop': 0.4, 'retreat': 0.4, 'road_trip': 0.5},
    'food_beverage': {'gala': 1, 'retreat': 1, 'road_trip': 0.8, 'conference': 0.6, 'product_launch': 0.7, 'workshop': 0.4},
    'automotive': {'road_trip': 1, 'product_launch': 1, 'gala': 0.7, 'conference': 0.5, 'retreat': 0.4},
    'health': {'retreat': 1, 'workshop': 0.9, 'conference': 0.8, 'gala': 0.5, 'road_trip': 0.4},
    'media': {'conference': 1, 'gala': 1, 'product_launch': 1, 'workshop': 0.6, 'road_trip': 0.5},
    'energy': {'conference': 0.8, 'road_trip': 0.7, 'product_launch': 0.6, 'workshop': 0.6, 'gala': 0.5},
}
DEFAULT_AFFINITY = 0.4
AUDIENCE_TYPE_SCORE = {'external': 1.0, 'mixed': 0.9, 'internal': 0.5}

# Secteur -> mots-clés cherchés dans les préférences des participants.
INDUSTRY_KEYWORDS = {
    'finance': ['finance', 'banque', 'bank', 'invest', 'assurance', 'insurance', 'fintech'],
    'tech': ['tech', 'digital', 'numérique', 'numerique', 'innovation', 'ia', 'ai', 'logiciel', 'software', 'startup'],
    'retail': ['mode', 'fashion', 'shopping', 'retail', 'commerce', 'boutique'],
    'food_beverage': ['gastronomie', 'cuisine', 'food', 'vin', 'wine', 'restaurant', 'café', 'cafe', 'dégustation', 'degustation'],
    'automotive': ['auto', 'voiture', 'car', 'moto', 'conduite', 'mobilité', 'mobilite'],
    'health': ['santé', 'sante', 'health', 'sport', 'bien-être', 'bien-etre', 'wellness', 'yoga', 'fitness'],
    'media': ['média', 'media', 'presse', 'podcast', 'cinéma', 'cinema', 'musique', 'music'],
    'energy': ['énergie', 'energie', 'energy', 'écologie', 'ecologie', 'durable', 'climat', 'solaire'],
}


class TransitionError(Exception):
    """Transition de statut refusée ; le message est destiné à l'utilisateur."""

    def __init__(self, message, conflicts=None):
        super().__init__(message)
        self.message = message
        self.conflicts = conflicts or []


def _event_start(event):
    """Date de début de l'événement (tolère une chaîne ISO non encore rechargée)."""
    value = event.start_date
    if isinstance(value, str):
        value = date.fromisoformat(value)
    return value


def _money(value):
    return Decimal(value or 0).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Synthèse du pipeline
# ---------------------------------------------------------------------------

def pipeline_summary(event):
    """Synthèse financière du sponsoring d'un événement."""
    from .models import SponsorshipDeal

    deals = list(SponsorshipDeal.objects.filter(event=event))
    counts = {status: 0 for status in ALL_STATUSES}
    confirmed_cash = Decimal('0')
    confirmed_in_kind = Decimal('0')
    weighted = Decimal('0')
    open_cash = Decimal('0')

    for deal in deals:
        counts[deal.status] = counts.get(deal.status, 0) + 1
        cash = Decimal(deal.cash_amount or 0)
        if deal.status in COMMITTED_STATUSES:
            confirmed_cash += cash
            confirmed_in_kind += Decimal(deal.in_kind_value or 0)
        elif deal.status in OPEN_STATUSES:
            open_cash += cash
            weighted += cash * Decimal(deal.probability_percent) / Decimal(100)

    target = Decimal(event.target_budget or 0)
    gap = max(target - confirmed_cash, Decimal('0'))
    coverage = float((confirmed_cash / target * 100).quantize(Decimal('0.1'))) if target > 0 else 0.0

    return {
        'target_budget': _money(target),
        'confirmed_cash': _money(confirmed_cash),
        'confirmed_in_kind': _money(confirmed_in_kind),
        'weighted_pipeline': _money(weighted),
        'best_case': _money(confirmed_cash + open_cash),
        'funding_gap': _money(gap),
        'coverage_percent': coverage,
        'active_deals': sum(counts[s] for s in OPEN_STATUSES),
        'counts': counts,
    }


# ---------------------------------------------------------------------------
# Recommandation de packages
# ---------------------------------------------------------------------------

def package_remaining_slots(package):
    sold = package.deals.filter(status__in=COMMITTED_STATUSES).count()
    return max(package.slots_total - sold, 0)


def recommend_packages(event, gap=None, max_results=5):
    """Combinaisons de packages couvrant l'écart de financement.

    Classement : moins de packages d'abord, puis plus petit surplus.
    Si aucune combinaison ne couvre l'écart, retourne la meilleure couverture partielle.
    """
    from .models import SponsorshipPackage

    if gap is None:
        gap = pipeline_summary(event)['funding_gap']
    gap = Decimal(str(gap))
    if gap <= 0:
        return []

    available = []
    for package in SponsorshipPackage.objects.filter(event=event, active=True, price__gt=0).order_by('tier_rank', 'name'):
        remaining = package_remaining_slots(package)
        if remaining > 0:
            available.append((package, remaining))
    if not available:
        return []

    ranges = []
    for package, remaining in available:
        needed = int((gap / Decimal(package.price)).to_integral_value(rounding='ROUND_CEILING'))
        ranges.append(range(0, min(remaining, needed, 10) + 1))

    def build(quantities):
        items = []
        total = Decimal('0')
        count = 0
        for (package, _), qty in zip(available, quantities):
            if qty:
                subtotal = Decimal(package.price) * qty
                total += subtotal
                count += qty
                items.append({
                    'package_id': str(package.id),
                    'package_name': package.name,
                    'price': _money(package.price),
                    'quantity': qty,
                    'subtotal': _money(subtotal),
                })
        covers = total >= gap
        return {
            'items': items,
            'packages_count': count,
            'total': _money(total),
            'surplus': _money(max(total - gap, Decimal('0'))),
            'shortfall': _money(max(gap - total, Decimal('0'))),
            'covers_gap': covers,
        }

    proposals = []
    best_partial = None
    for quantities in itertools.product(*ranges):
        if not any(quantities):
            continue
        proposal = build(quantities)
        if proposal['covers_gap']:
            proposals.append(proposal)
        elif best_partial is None or proposal['total'] > best_partial['total']:
            best_partial = proposal

    if proposals:
        proposals.sort(key=lambda p: (p['packages_count'], p['surplus']))
        return proposals[:max_results]
    return [best_partial] if best_partial else []


# ---------------------------------------------------------------------------
# Pertinence sponsor <-> événement
# ---------------------------------------------------------------------------

def _audience_match(event, sponsor):
    from apps.participants.models import EventParticipant, ParticipantPreference

    total = EventParticipant.objects.filter(event=event).count()
    keywords = [k.casefold() for k in INDUSTRY_KEYWORDS.get(sponsor.industry, [])]
    if not total or not keywords:
        return 0, total
    participant_ids = EventParticipant.objects.filter(event=event).values_list('participant_id', flat=True)
    matched = set()
    for pref in ParticipantPreference.objects.filter(participant_id__in=participant_ids):
        haystack = f'{pref.preference_type} {pref.value}'.casefold()
        if any(keyword in haystack for keyword in keywords):
            matched.add(pref.participant_id)
    return len(matched), total


def score_sponsor_fit(event, sponsor, weights=None, save=True):
    """Score 0-100 explicable de la pertinence d'un sponsor pour un événement."""
    from .models import SponsorFitEvaluation, SponsorshipDeal, SponsorshipPackage

    weights = dict(DEFAULT_FIT_WEIGHTS, **(weights or {}))
    total_weight = sum(weights.values()) or 1

    # 1. Secteur vs type d'événement
    affinity = INDUSTRY_EVENT_AFFINITY.get(sponsor.industry, {}).get(event.event_type, DEFAULT_AFFINITY)
    industry_match = affinity >= 0.6

    # 2. Audience : taille puis nature
    expected = event.participant_expected or event.participant_target or 0
    if expected >= 300:
        size_score = 1.0
    elif expected >= 100:
        size_score = 0.8
    elif expected >= 50:
        size_score = 0.6
    elif expected >= 20:
        size_score = 0.4
    else:
        size_score = 0.2
    audience_score = size_score * 0.6 + AUDIENCE_TYPE_SCORE.get(event.audience_type, 0.7) * 0.4

    # 3. Budget : historique de montants vs prix des packages
    packages = list(SponsorshipPackage.objects.filter(event=event, active=True))
    sellable = [p for p in packages if package_remaining_slots(p) > 0]
    past_deals = SponsorshipDeal.objects.filter(
        sponsor=sponsor, status__in=COMMITTED_STATUSES, cash_amount__gt=0,
    ).exclude(event=event)
    past_amounts = [Decimal(d.cash_amount) for d in past_deals]
    if not sellable:
        budget_score, budget_fit = 0.0, False
        budget_detail = 'Aucun package disponible sur cet événement.'
    elif past_amounts:
        average = sum(past_amounts) / len(past_amounts)
        close = [p for p in sellable if average * Decimal('0.5') <= Decimal(p.price) <= average * Decimal('1.5')]
        budget_fit = bool(close)
        budget_score = 1.0 if close else 0.2
        budget_detail = (
            f'Montant moyen passé {_money(average)} € : '
            + ('au moins un package est dans la fourchette.' if close else 'aucun package dans la fourchette.')
        )
    else:
        budget_score, budget_fit = 0.5, True
        budget_detail = 'Aucun historique : compatibilité estimée par défaut.'

    # 4. Historique avec la même organisation
    past_count = SponsorshipDeal.objects.filter(
        sponsor=sponsor, status__in=COMMITTED_STATUSES,
    ).exclude(event=event).count()
    history_score = 0.0 if past_count == 0 else (0.7 if past_count == 1 else 1.0)

    # 5. Audience concernée
    matched, participants_total = _audience_match(event, sponsor)
    if participants_total:
        ratio = matched / participants_total
        match_score = min(1.0, ratio / 0.5)
        match_detail = f'{matched} participant(s) sur {participants_total} ont des préférences liées au secteur.'
    else:
        match_score = 0.0
        match_detail = 'Aucun participant inscrit à cet événement.'

    criteria = [
        ('industry', affinity, f'Affinité {sponsor.get_industry_display()} / {event.event_type} : {int(affinity * 100)} %.'),
        ('audience_size', audience_score, f'{expected} participants attendus, public {event.audience_type}.'),
        ('budget', budget_score, budget_detail),
        ('history', history_score, f'{past_count} partenariat(s) confirmé(s) sur d\'autres événements.'),
        ('audience_match', match_score, match_detail),
    ]
    breakdown = []
    weighted_sum = 0.0
    for key, raw, detail in criteria:
        weight = weights[key] / total_weight
        weighted_sum += raw * weight
        breakdown.append({
            'key': key,
            'label': FIT_LABELS[key],
            'weight': round(weight, 3),
            'score': int(round(raw * 100)),
            'detail': detail,
        })
    fit_score = int(round(weighted_sum * 100))

    failures = []
    if not sellable:
        failures.append({'code': 'no_package_available', 'message': 'Aucun package actif avec des places restantes.'})
    else:
        exclusive_blocked = all(
            p.exclusive_industry and p.deals.filter(status__in=COMMITTED_STATUSES, sponsor__industry=sponsor.industry).exists()
            for p in sellable
        )
        if exclusive_blocked and sponsor.industry != 'other':
            failures.append({
                'code': 'industry_exclusivity',
                'message': 'Tous les packages restants sont exclusifs et déjà pris dans ce secteur.',
            })

    # Revenu attendu pondéré par le score
    if sellable:
        prices = sorted(Decimal(p.price) for p in sellable)
        reference = prices[len(prices) // 2]
        if past_amounts:
            average = sum(past_amounts) / len(past_amounts)
            reference = min(prices, key=lambda price: abs(price - average))
        estimated_roi = _money(reference * Decimal(fit_score) / Decimal(100))
    else:
        estimated_roi = None

    best = max(breakdown, key=lambda c: c['score'] * c['weight'])
    weakest = min(breakdown, key=lambda c: c['score'])
    explanation = (
        f'Score {fit_score}/100. Point fort : {best["label"].lower()} ({best["score"]}/100). '
        f'Point faible : {weakest["label"].lower()} ({weakest["score"]}/100).'
    )
    if failures:
        explanation += ' Blocage : ' + ' '.join(f['message'] for f in failures)

    result = {
        'sponsor': sponsor,
        'event': event,
        'fit_score': fit_score,
        'audience_match_count': matched,
        'industry_match': industry_match,
        'budget_fit': budget_fit,
        'estimated_roi': estimated_roi,
        'hard_constraint_failures': failures,
        'breakdown': breakdown,
        'explanation': explanation,
    }
    if save:
        result['evaluation'] = SponsorFitEvaluation.objects.create(
            event=event,
            sponsor=sponsor,
            fit_score=fit_score,
            audience_match_count=matched,
            industry_match=industry_match,
            budget_fit=budget_fit,
            estimated_roi=estimated_roi,
            hard_constraint_failures=failures,
            breakdown=breakdown,
            explanation=explanation,
        )
    return result


# ---------------------------------------------------------------------------
# Conflits
# ---------------------------------------------------------------------------

def detect_conflicts(event, assume_committed=None):
    """Liste les conflits du sponsoring d'un événement.

    `assume_committed` : ids de deals à traiter comme signés (simulation avant signature).
    Chaque conflit : {code, severity ('error'|'warning'), message, deal_ids}.
    """
    from .models import SponsorDeliverable, SponsorshipDeal, SponsorshipPackage

    assume = {str(i) for i in (assume_committed or [])}

    def is_committed(deal):
        return deal.status in COMMITTED_STATUSES or str(deal.id) in assume

    def is_engaged(deal):
        return deal.status in ENGAGED_STATUSES or str(deal.id) in assume

    conflicts = []
    deals = list(
        SponsorshipDeal.objects.filter(event=event).exclude(status='lost').select_related('sponsor', 'package')
    )

    for package in SponsorshipPackage.objects.filter(event=event):
        pdeals = [d for d in deals if d.package_id == package.id]
        committed = [d for d in pdeals if is_committed(d)]
        engaged = [d for d in pdeals if is_engaged(d)]

        if len(committed) > package.slots_total:
            conflicts.append({
                'code': 'slots_exceeded',
                'severity': 'error',
                'message': f'Package « {package.name} » : {len(committed)} deals confirmés pour {package.slots_total} place(s).',
                'deal_ids': [str(d.id) for d in committed],
            })
        elif len(engaged) > package.slots_total:
            conflicts.append({
                'code': 'slots_overpromised',
                'severity': 'warning',
                'message': f'Package « {package.name} » : {len(engaged)} deals engagés pour {package.slots_total} place(s).',
                'deal_ids': [str(d.id) for d in engaged],
            })

        if package.exclusive_industry:
            by_industry = {}
            for deal in engaged:
                by_industry.setdefault(deal.sponsor.industry, []).append(deal)
            for industry, group in by_industry.items():
                if len(group) < 2 or industry == 'other':
                    continue
                hard = sum(1 for d in group if is_committed(d)) >= 2
                conflicts.append({
                    'code': 'industry_exclusivity',
                    'severity': 'error' if hard else 'warning',
                    'message': f'Package exclusif « {package.name} » : {len(group)} sponsors du secteur {industry}.',
                    'deal_ids': [str(d.id) for d in group],
                })

    by_industry = {}
    for deal in deals:
        if is_committed(deal) and deal.sponsor.industry != 'other':
            by_industry.setdefault(deal.sponsor.industry, []).append(deal)
    for industry, group in by_industry.items():
        if len({d.sponsor_id for d in group}) >= 2:
            conflicts.append({
                'code': 'competing_sponsors',
                'severity': 'warning',
                'message': f'{len(group)} sponsors concurrents confirmés dans le secteur {industry}.',
                'deal_ids': [str(d.id) for d in group],
            })

    booths = (
        SponsorDeliverable.objects
        .filter(deal__event=event, deliverable_type='booth', resource__isnull=False)
        .exclude(deal__status='lost')
        .select_related('resource')
    )
    by_resource = {}
    for deliverable in booths:
        by_resource.setdefault(deliverable.resource_id, []).append(deliverable)
    for group in by_resource.values():
        resource = group[0].resource
        if resource.capacity > 0 and len(group) > resource.capacity:
            conflicts.append({
                'code': 'resource_overbooked',
                'severity': 'error',
                'message': f'Ressource « {resource.name} » : {len(group)} stands pour une capacité de {resource.capacity}.',
                'deal_ids': sorted({str(d.deal_id) for d in group}),
            })

    return conflicts


# ---------------------------------------------------------------------------
# Machine à états
# ---------------------------------------------------------------------------

def _ensure_deliverables(deal):
    """Crée, sans doublon, les contreparties décrites par le package du deal."""
    from .models import SponsorDeliverable

    if not deal.package_id:
        return []
    valid_types = {value for value, _ in SponsorDeliverable.TYPE_CHOICES}
    existing = {(d.title, d.deliverable_type) for d in deal.deliverables.all()}
    created = []
    for benefit in deal.package.benefits or []:
        if not isinstance(benefit, dict) or not benefit.get('title'):
            continue
        dtype = benefit.get('type') if benefit.get('type') in valid_types else 'other'
        key = (benefit['title'], dtype)
        if key in existing:
            continue
        due = None
        start = _event_start(deal.event)
        if start:
            due = start + timedelta(days=int(benefit.get('offset_days') or 0))
        created.append(SponsorDeliverable.objects.create(
            deal=deal, title=benefit['title'], deliverable_type=dtype, due_date=due,
        ))
        existing.add(key)
    return created


def _ensure_payments(deal, plan=None):
    """Crée l'échéancier par défaut si le deal n'en a pas encore."""
    from .models import SponsorPayment

    cash = Decimal(deal.cash_amount or 0)
    if cash <= 0 or deal.payments.exists():
        return []
    plan = plan or DEFAULT_PAYMENT_PLAN
    signed = deal.signed_at or date.today()
    if isinstance(signed, str):
        signed = date.fromisoformat(signed)
    start = _event_start(deal.event)
    created = []
    allocated = Decimal('0')
    for index, step in enumerate(plan):
        if index == len(plan) - 1:
            amount = cash - allocated
        else:
            amount = (cash * Decimal(step['pct']) / Decimal(100)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
        allocated += amount
        if step.get('anchor') == 'event_start' and start:
            due = max(start + timedelta(days=step.get('offset_days', 0)), signed)
        elif step.get('anchor') == 'event_start':
            due = signed + timedelta(days=30)
        else:
            due = signed + timedelta(days=step.get('offset_days', 0))
        created.append(SponsorPayment.objects.create(
            deal=deal, label=step['label'], amount=amount, due_date=due,
        ))
    return created


@transaction.atomic
def transition_deal(deal, new_status, actor=None, probability_percent=None, lost_reason=None, payment_plan=None):
    """Fait passer un deal à un nouveau statut en appliquant les règles métier."""
    old_status = deal.status
    if new_status not in ALLOWED_TRANSITIONS:
        raise TransitionError(f'Statut inconnu : {new_status}.')
    if new_status not in ALLOWED_TRANSITIONS[old_status]:
        raise TransitionError(f'Transition impossible : {old_status} → {new_status}.')

    if new_status == 'lost' and not (lost_reason or '').strip():
        raise TransitionError('Un motif est obligatoire pour marquer un dossier comme perdu.')

    if new_status == 'signed':
        conflicts = detect_conflicts(deal.event, assume_committed=[deal.id])
        blocking = [c for c in conflicts if c['severity'] == 'error' and str(deal.id) in c['deal_ids']]
        if blocking:
            raise TransitionError(
                'Signature bloquée : ' + ' '.join(c['message'] for c in blocking),
                conflicts=blocking,
            )

    if probability_percent is None:
        probability_percent = DEAL_STATUS_DEFAULT_PROBABILITY[new_status]
    if not 0 <= int(probability_percent) <= 100:
        raise TransitionError('La probabilité doit être comprise entre 0 et 100.')

    deal.status = new_status
    deal.probability_percent = int(probability_percent)
    if new_status == 'lost':
        deal.lost_reason = lost_reason.strip()
    elif old_status == 'lost':
        deal.lost_reason = ''
    if new_status == 'signed' and not deal.signed_at:
        deal.signed_at = date.today()
    deal.save()

    if new_status == 'signed':
        _ensure_deliverables(deal)
        _ensure_payments(deal, plan=payment_plan)

    message = f'{old_status} → {new_status}'
    if new_status == 'lost':
        message += f' ({deal.lost_reason})'
    log_activity(deal, actor, 'status_changed', message=message, from_status=old_status, to_status=new_status)
    return deal


# ---------------------------------------------------------------------------
# Exposition (rapport ROI)
# ---------------------------------------------------------------------------

def compute_exposure(deal, weights=None):
    """Estimation de l'exposition obtenue grâce aux contreparties livrées."""
    weights = dict(DEFAULT_EXPOSURE_WEIGHTS, **(weights or {}))
    event = deal.event
    participants = event.participant_expected or event.participant_target or 0
    deliverables = list(deal.deliverables.all())
    delivered = [d for d in deliverables if d.status == 'delivered']
    delivered_weight = sum(weights.get(d.deliverable_type, weights['other']) for d in delivered)
    visibility = float(deal.package.visibility_weight) if deal.package_id else 1.0
    return {
        'participants': participants,
        'delivered': len(delivered),
        'total': len(deliverables),
        'delivered_weight': round(delivered_weight, 2),
        'visibility_weight': visibility,
        'estimated_exposure': int(round(participants * delivered_weight * visibility)),
    }


# ---------------------------------------------------------------------------
# Paiements en retard et alertes
# ---------------------------------------------------------------------------

def refresh_overdue_payments(today=None):
    """Passe en `overdue` les paiements non réglés dont l'échéance est dépassée."""
    from .models import SponsorPayment

    today = today or date.today()
    late = SponsorPayment.objects.filter(
        status__in=('planned', 'invoiced'), due_date__lt=today,
    ).exclude(deal__status='lost').select_related('deal')
    count = 0
    for payment in late:
        payment.status = 'overdue'
        payment.save(update_fields=['status'])
        log_activity(payment.deal, None, 'payment_updated', message=f'Paiement « {payment.label} » en retard.')
        count += 1
    return count


def build_alerts(event, today=None, now=None, inactivity_days=14, horizon_days=7):
    """Alertes d'un événement : paiements, contreparties, deals inactifs, conflits."""
    from .models import SponsorDeliverable, SponsorPayment, SponsorshipActivity, SponsorshipDeal

    today = today or date.today()
    now = now or timezone.now()
    horizon = today + timedelta(days=horizon_days)
    alerts = []

    payments = (
        SponsorPayment.objects.filter(deal__event=event)
        .exclude(status='paid').exclude(deal__status='lost').select_related('deal__sponsor')
    )
    for payment in payments:
        if payment.due_date is None:
            continue
        sponsor = payment.deal.sponsor.name
        if payment.status == 'overdue' or payment.due_date < today:
            days = (today - payment.due_date).days
            alerts.append({
                'code': 'payment_overdue', 'severity': 'error', 'target': 'payments',
                'deal_id': str(payment.deal_id), 'object_id': str(payment.id),
                'message': f'{sponsor} : « {payment.label} » ({_money(payment.amount)} €) en retard de {days} jour(s).',
            })
        elif payment.due_date <= horizon:
            alerts.append({
                'code': 'payment_due_soon', 'severity': 'warning', 'target': 'payments',
                'deal_id': str(payment.deal_id), 'object_id': str(payment.id),
                'message': f'{sponsor} : « {payment.label} » dû le {payment.due_date.isoformat()}.',
            })

    deliverables = (
        SponsorDeliverable.objects.filter(deal__event=event)
        .exclude(status='delivered').exclude(deal__status='lost').select_related('deal__sponsor')
    )
    for item in deliverables:
        sponsor = item.deal.sponsor.name
        if item.due_date and item.due_date < today:
            alerts.append({
                'code': 'deliverable_late', 'severity': 'error', 'target': 'deliverables',
                'deal_id': str(item.deal_id), 'object_id': str(item.id),
                'message': f'{sponsor} : contrepartie « {item.title} » en retard (échéance {item.due_date.isoformat()}).',
            })
        elif item.status == 'at_risk' or (item.due_date and item.due_date <= horizon):
            alerts.append({
                'code': 'deliverable_at_risk', 'severity': 'warning', 'target': 'deliverables',
                'deal_id': str(item.deal_id), 'object_id': str(item.id),
                'message': f'{sponsor} : contrepartie « {item.title} » à surveiller.',
            })

    threshold = now - timedelta(days=inactivity_days)
    for deal in SponsorshipDeal.objects.filter(event=event, status='negotiating').select_related('sponsor'):
        last = SponsorshipActivity.objects.filter(deal=deal).order_by('-created_at').first()
        last_at = last.created_at if last else deal.created_at
        if last_at < threshold:
            days = (now - last_at).days
            alerts.append({
                'code': 'deal_inactive', 'severity': 'warning', 'target': 'pipeline',
                'deal_id': str(deal.id), 'object_id': str(deal.id),
                'message': f'{deal.sponsor.name} : négociation sans activité depuis {days} jours.',
            })

    for conflict in detect_conflicts(event):
        alerts.append({
            'code': conflict['code'], 'severity': conflict['severity'], 'target': 'conflicts',
            'deal_id': conflict['deal_ids'][0] if conflict['deal_ids'] else None,
            'object_id': None, 'message': conflict['message'],
        })

    order = {'error': 0, 'warning': 1}
    alerts.sort(key=lambda a: order.get(a['severity'], 2))
    return alerts


# ---------------------------------------------------------------------------
# Intégrations en lecture seule : budget et simulation
# ---------------------------------------------------------------------------

def net_budget(event, budget_id=None):
    """Budget net = coût estimé de l'événement − financement des sponsors.

    Le coût vient du module Budget actuel (ressources ``BudgetItem`` chiffrées,
    même calcul que la page Budget : ``calculate_budget``) ; le budget cible
    est ``Event.target_budget``. ``budget_id`` est conservé pour compatibilité
    d'API mais n'a plus d'effet : un événement n'a qu'un budget.
    """
    from apps.budgets.calculations import calculate_budget
    from apps.budgets.models import BudgetItem

    computed = calculate_budget(event, BudgetItem.objects.filter(event=event))
    planned = Decimal(computed['total'] or 0)
    target = Decimal(event.target_budget or 0)

    summary = pipeline_summary(event)
    confirmed = summary['confirmed_cash']
    weighted = summary['weighted_pipeline']
    best = summary['best_case']
    return {
        'has_budget': computed['priced_count'] > 0 or target > 0,
        'budget_id': str(event.pk),
        'budget_name': f'Budget — {event.name}',
        'currency': getattr(settings, 'BUDGET_CURRENCY', '') or 'EUR',
        'target_budget': _money(target),
        'planned_cost': _money(planned),
        'cost_incomplete': bool(computed['incomplete']),
        'priced_count': computed['priced_count'],
        'confirmed_sponsorship': confirmed,
        'weighted_sponsorship': weighted,
        'best_case_sponsorship': best,
        'net_pessimistic': _money(planned - confirmed),
        'net_weighted': _money(planned - confirmed - weighted),
        'net_optimistic': _money(planned - best),
    }


def sponsorship_impact_for_scenario(scenario, include_weighted=False):
    """Revenu de sponsoring à intégrer dans un scénario (lecture seule)."""
    summary = pipeline_summary(scenario.event)
    weighted = summary['weighted_pipeline'] if include_weighted else Decimal('0.00')
    return {
        'scenario_id': str(scenario.id),
        'event_id': str(scenario.event_id),
        'included_weighted': bool(include_weighted),
        'confirmed_cash': summary['confirmed_cash'],
        'confirmed_in_kind': summary['confirmed_in_kind'],
        'weighted_pipeline': weighted,
        'total_revenue': _money(summary['confirmed_cash'] + weighted),
    }


# ---------------------------------------------------------------------------
# Rapport ROI d'un deal
# ---------------------------------------------------------------------------

def deal_report(deal):
    deliverables = list(deal.deliverables.order_by('due_date', 'title'))
    payments = list(deal.payments.order_by('due_date', 'label'))
    paid = sum((Decimal(p.amount) for p in payments if p.status == 'paid'), Decimal('0'))
    planned = sum((Decimal(p.amount) for p in payments), Decimal('0'))
    return {
        'deal_id': str(deal.id),
        'sponsor': deal.sponsor.name,
        'event': deal.event.name,
        'package': deal.package.name if deal.package_id else '',
        'status': deal.status,
        'cash_amount': _money(deal.cash_amount),
        'in_kind_value': _money(deal.in_kind_value),
        'currency': deal.currency,
        'deliverables': [
            {
                'title': d.title, 'type': d.deliverable_type, 'due_date': d.due_date,
                'status': d.status, 'delivered_at': d.delivered_at, 'asset_url': d.asset_url,
            } for d in deliverables
        ],
        'deliverables_delivered': sum(1 for d in deliverables if d.status == 'delivered'),
        'deliverables_total': len(deliverables),
        'payments': [
            {'label': p.label, 'amount': _money(p.amount), 'due_date': p.due_date, 'status': p.status, 'paid_at': p.paid_at}
            for p in payments
        ],
        'payments_planned': _money(planned),
        'payments_paid': _money(paid),
        'exposure': compute_exposure(deal),
    }


def deal_report_csv(deal):
    report = deal_report(deal)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(['Sponsor', report['sponsor']])
    writer.writerow(['Événement', report['event']])
    writer.writerow(['Package', report['package']])
    writer.writerow(['Statut', report['status']])
    writer.writerow(['Montant cash', report['cash_amount'], report['currency']])
    writer.writerow(['Valeur en nature', report['in_kind_value'], report['currency']])
    writer.writerow(['Exposition estimée', report['exposure']['estimated_exposure']])
    writer.writerow([])
    writer.writerow(['Contreparties', 'Type', 'Échéance', 'Statut', 'Livrée le', 'Asset'])
    for d in report['deliverables']:
        writer.writerow([d['title'], d['type'], d['due_date'] or '', d['status'], d['delivered_at'] or '', d['asset_url']])
    writer.writerow([])
    writer.writerow(['Paiements', 'Montant', 'Échéance', 'Statut', 'Payé le'])
    for p in report['payments']:
        writer.writerow([p['label'], p['amount'], p['due_date'] or '', p['status'], p['paid_at'] or ''])
    return out.getvalue()


# ---------------------------------------------------------------------------
# Import CSV de sponsors
# ---------------------------------------------------------------------------

CSV_COLUMNS = ('name', 'industry', 'contact_name', 'contact_email', 'website', 'country')


def import_sponsors_csv(organization, actor, text):
    """Importe des sponsors depuis un CSV ; chaque ligne est traitée dans sa propre transaction."""
    from .models import Sponsor

    text = text.lstrip('\ufeff')
    try:
        dialect = csv.Sniffer().sniff(text[:2048], delimiters=',;\t')
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    fields = [(f or '').strip().lower() for f in (reader.fieldnames or [])]
    reader.fieldnames = fields
    result = {'created': 0, 'skipped': 0, 'errors': [], 'skipped_details': []}
    missing = [c for c in ('name', 'contact_email') if c not in fields]
    if missing:
        result['errors'].append({'line': 1, 'message': 'Colonnes obligatoires manquantes : ' + ', '.join(missing) + '.'})
        return result

    valid_industries = {value for value, _ in Sponsor.INDUSTRY_CHOICES}
    url_validator = URLValidator()
    for line, row in enumerate(reader, start=2):
        row = {(k or '').strip().lower(): (v or '').strip() for k, v in row.items() if k}
        if not any(row.values()):
            continue
        name = row.get('name', '')
        if not name:
            result['errors'].append({'line': line, 'message': 'Le nom est obligatoire.'})
            continue
        email = row.get('contact_email', '')
        try:
            validate_email(email)
        except DjangoValidationError:
            result['errors'].append({'line': line, 'message': f'E-mail invalide : « {email} ».'})
            continue
        website = row.get('website', '')
        if website:
            if '://' not in website:
                website = 'https://' + website
            try:
                url_validator(website)
            except DjangoValidationError:
                result['errors'].append({'line': line, 'message': f'Site web invalide : « {website} ».'})
                continue
        industry = row.get('industry', '').lower() or 'other'
        if industry not in valid_industries:
            result['errors'].append({'line': line, 'message': f'Secteur inconnu : « {industry} ».'})
            continue
        if find_duplicate_sponsors(organization, name, website):
            result['skipped'] += 1
            result['skipped_details'].append({'line': line, 'name': name, 'reason': 'Sponsor déjà existant.'})
            continue
        try:
            with transaction.atomic():
                Sponsor.objects.create(
                    organization=organization, created_by=actor if isinstance(actor, Participant) else None, name=name, industry=industry,
                    contact_name=row.get('contact_name', '') or name, contact_email=email,
                    website=website, country=row.get('country', ''),
                )
            result['created'] += 1
        except Exception as exc:  # noqa: BLE001 - une ligne en erreur ne doit pas bloquer les autres
            result['errors'].append({'line': line, 'message': f'Création impossible : {exc}'})
    return result


# ---------------------------------------------------------------------------
# Portail sponsor : jeton signé, contenu, dépôt d'asset, e-mail
# ---------------------------------------------------------------------------

PORTAL_SALT = 'sponsors.portal'


class PortalError(Exception):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def portal_ttl_days():
    try:
        return int(os.getenv('SPONSORS_PORTAL_TTL_DAYS', '30'))
    except ValueError:
        return 30


def make_portal_token(deal):
    return signing.dumps({'deal': str(deal.id)}, salt=PORTAL_SALT)


def portal_link(token):
    base = os.getenv('SPONSORS_PORTAL_BASE_URL', 'http://localhost:4200').rstrip('/')
    return f'{base}/sponsor/{token}'


def read_portal_token(token):
    """Retourne le deal associé à un jeton valide ; sinon PortalError."""
    from .models import SponsorshipDeal

    try:
        payload = signing.loads(token, salt=PORTAL_SALT, max_age=portal_ttl_days() * 86400)
    except signing.SignatureExpired:
        raise PortalError('Ce lien a expiré. Contactez votre organisateur.', status_code=410)
    except signing.BadSignature:
        raise PortalError('Ce lien n\'est pas valide.', status_code=404)
    deal = (
        SponsorshipDeal.objects.select_related('event', 'sponsor', 'package')
        .filter(pk=payload.get('deal')).first()
    )
    if deal is None or deal.status not in COMMITTED_STATUSES:
        raise PortalError('Ce lien n\'est plus actif.', status_code=404)
    return deal


def portal_payload(deal):
    """Contenu exposé au sponsor : aucune donnée interne (notes, probabilité, responsable, journal)."""
    return {
        'event_name': deal.event.name,
        'event_start': deal.event.start_date,
        'event_end': deal.event.end_date,
        'sponsor_name': deal.sponsor.name,
        'package_name': deal.package.name if deal.package_id else '',
        'status': deal.status,
        'deliverables': [
            {
                'id': str(d.id), 'title': d.title, 'deliverable_type': d.deliverable_type,
                'due_date': d.due_date, 'status': d.status, 'asset_url': d.asset_url,
            } for d in deal.deliverables.order_by('due_date', 'title')
        ],
        'payments': [
            {
                'label': p.label, 'amount': _money(p.amount), 'currency': deal.currency,
                'due_date': p.due_date, 'status': p.status,
            } for p in deal.payments.order_by('due_date', 'label')
        ],
    }


def submit_portal_asset(deal, deliverable_id, asset_url):
    """Le sponsor dépose le lien de son asset pour l'une de ses contreparties."""
    deliverable = deal.deliverables.filter(pk=deliverable_id).first()
    if deliverable is None:
        raise PortalError('Contrepartie introuvable.', status_code=404)
    asset_url = (asset_url or '').strip()
    try:
        URLValidator(schemes=['http', 'https'])(asset_url)
    except DjangoValidationError:
        raise PortalError('Le lien fourni n\'est pas une URL valide.')
    if deliverable.status == 'delivered':
        raise PortalError('Cette contrepartie est déjà livrée.')
    deliverable.asset_url = asset_url
    deliverable.status = 'in_progress'
    deliverable.save(update_fields=['asset_url', 'status'])
    log_activity(deal, None, 'asset_submitted', message=f'Asset déposé par le sponsor : {deliverable.title}')
    return deliverable


def send_portal_email(deal, link, to_email=None):
    """Envoie le lien du portail ; sans SMTP configuré, bascule sur le backend console."""
    recipient = (to_email or deal.sponsor.contact_email or '').strip()
    if not recipient:
        raise PortalError('Aucune adresse e-mail disponible pour ce sponsor.')
    try:
        validate_email(recipient)
    except DjangoValidationError:
        raise PortalError('Adresse e-mail invalide.')
    html = render_to_string('emails/sponsor_portal_invite.html', {
        'contact_name': deal.sponsor.contact_name,
        'sponsor_name': deal.sponsor.name,
        'event_name': deal.event.name,
        'link': link,
        'ttl_days': portal_ttl_days(),
    })
    connection = None
    sender = getattr(settings, 'EMAIL_HOST_USER', '') or 'no-reply@eventtwin.local'
    uses_smtp = str(getattr(settings, 'EMAIL_BACKEND', '')).endswith('smtp.EmailBackend')
    if uses_smtp and not getattr(settings, 'EMAIL_HOST_USER', ''):
        # SMTP non configuré (dev local) : on affiche l'e-mail dans la console au lieu d'échouer.
        connection = get_connection('django.core.mail.backends.console.EmailBackend')
    message = EmailMultiAlternatives(
        f'Votre espace sponsor — {deal.event.name}',
        f'Accédez à votre espace sponsor : {link}',
        sender, [recipient], connection=connection,
    )
    message.attach_alternative(html, 'text/html')
    message.send()
    return recipient


# ---------------------------------------------------------------------------
# Webhook d'alertes (n8n)
# ---------------------------------------------------------------------------

def alerts_webhook_payload(events=None):
    from apps.events.models import Event

    queryset = Event.objects.all() if events is None else events
    payload = []
    for event in queryset:
        alerts = build_alerts(event)
        if alerts:
            payload.append({'event_id': str(event.id), 'event_name': event.name, 'alerts': alerts})
    return payload
