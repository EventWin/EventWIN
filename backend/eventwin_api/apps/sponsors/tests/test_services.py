from datetime import date, timedelta
from decimal import Decimal

import pytest

from apps.events.models import Resource
from apps.participants.models import EventParticipant, ParticipantPreference
from apps.sponsors import services
from apps.sponsors.models import (
    SponsorDeliverable,
    SponsorPayment,
    Sponsor,
    SponsorshipActivity,
    SponsorshipDeal,
    SponsorshipPackage,
)
from apps.sponsors.tests.conftest import _participant

pytestmark = pytest.mark.django_db


def make_sponsor(org, name='Acme', industry='tech', **kw):
    return Sponsor.objects.create(
        organization=org, name=name, industry=industry,
        contact_name='Contact', contact_email=f'{name.lower().replace(" ", "")}@test.local', **kw,
    )


def make_package(event, name='Or', price='5000', slots=2, **kw):
    return SponsorshipPackage.objects.create(event=event, name=name, price=Decimal(price), slots_total=slots, **kw)


def make_deal(event, sponsor, status='lead', cash='0', package=None, **kw):
    return SponsorshipDeal.objects.create(
        event=event, sponsor=sponsor, status=status, cash_amount=Decimal(cash), package=package,
        probability_percent=kw.pop('probability_percent', 50), **kw,
    )


# ---------------------------------------------------------------- pipeline_summary

def test_pipeline_summary_without_deals(event_a):
    summary = services.pipeline_summary(event_a)
    assert summary['confirmed_cash'] == Decimal('0.00')
    assert summary['funding_gap'] == Decimal('20000.00')
    assert summary['coverage_percent'] == 0.0
    assert summary['counts']['lead'] == 0


def test_pipeline_summary_amounts(event_a, org_a):
    make_deal(event_a, make_sponsor(org_a, 'A'), 'signed', '8000', in_kind_value='500', signed_at=date.today())
    make_deal(event_a, make_sponsor(org_a, 'B'), 'paid', '2000', signed_at=date.today())
    make_deal(event_a, make_sponsor(org_a, 'C'), 'negotiating', '10000', probability_percent=60)
    make_deal(event_a, make_sponsor(org_a, 'D'), 'lead', '4000', probability_percent=10)
    make_deal(event_a, make_sponsor(org_a, 'E'), 'lost', '9999')
    s = services.pipeline_summary(event_a)
    assert s['confirmed_cash'] == Decimal('10000.00')
    assert s['confirmed_in_kind'] == Decimal('500.00')
    assert s['weighted_pipeline'] == Decimal('6400.00')  # 6000 + 400
    assert s['best_case'] == Decimal('24000.00')
    assert s['funding_gap'] == Decimal('10000.00')
    assert s['coverage_percent'] == 50.0
    assert s['active_deals'] == 2
    assert s['counts']['lost'] == 1


def test_funding_gap_never_negative(event_a, org_a):
    make_deal(event_a, make_sponsor(org_a), 'signed', '30000', signed_at=date.today())
    assert services.pipeline_summary(event_a)['funding_gap'] == Decimal('0.00')


# ---------------------------------------------------------------- recommend_packages

def test_recommend_no_packages(event_a):
    assert services.recommend_packages(event_a) == []


def test_recommend_zero_gap(event_a, org_a):
    make_package(event_a)
    make_deal(event_a, make_sponsor(org_a), 'signed', '25000', signed_at=date.today())
    assert services.recommend_packages(event_a) == []


def test_recommend_prefers_fewest_packages_then_smallest_surplus(event_a):
    make_package(event_a, 'Or', '10000', 2, tier_rank=1)
    make_package(event_a, 'Argent', '5000', 4, tier_rank=2)
    proposals = services.recommend_packages(event_a, gap=Decimal('12000'))
    best = proposals[0]
    assert best['covers_gap'] is True
    assert best['packages_count'] == 2
    assert best['total'] == Decimal('15000.00') or best['total'] == Decimal('20000.00')
    assert best['surplus'] == min(p['surplus'] for p in proposals if p['packages_count'] == 2)
    assert all(p['packages_count'] >= 2 for p in proposals)


def test_recommend_respects_remaining_slots(event_a, org_a):
    gold = make_package(event_a, 'Or', '10000', 1)
    make_deal(event_a, make_sponsor(org_a), 'signed', '10000', package=gold, signed_at=date.today())
    assert services.recommend_packages(event_a, gap=Decimal('5000')) == []


def test_recommend_partial_coverage_when_impossible(event_a):
    make_package(event_a, 'Bronze', '1000', 2)
    proposals = services.recommend_packages(event_a, gap=Decimal('50000'))
    assert len(proposals) == 1
    assert proposals[0]['covers_gap'] is False
    assert proposals[0]['total'] == Decimal('2000.00')
    assert proposals[0]['shortfall'] == Decimal('48000.00')


def test_recommend_ignores_inactive_packages(event_a):
    make_package(event_a, 'Off', '10000', 3, active=False)
    assert services.recommend_packages(event_a, gap=Decimal('5000')) == []


# ---------------------------------------------------------------- score_sponsor_fit

def test_fit_score_is_bounded_and_saved(event_a, org_a):
    make_package(event_a)
    sponsor = make_sponsor(org_a, industry='finance')
    event_a.event_type = 'conference'
    event_a.save()
    result = services.score_sponsor_fit(event_a, sponsor)
    assert 0 <= result['fit_score'] <= 100
    assert result['industry_match'] is True
    assert len(result['breakdown']) == 5
    assert abs(sum(c['weight'] for c in result['breakdown']) - 1) < 0.01
    assert result['evaluation'].fit_score == result['fit_score']
    assert 'Score' in result['explanation']


def test_fit_no_package_is_hard_failure(event_a, org_a):
    result = services.score_sponsor_fit(event_a, make_sponsor(org_a))
    assert result['budget_fit'] is False
    assert result['hard_constraint_failures'][0]['code'] == 'no_package_available'
    assert result['estimated_roi'] is None


def test_fit_industry_changes_score(event_a, org_a):
    event_a.event_type = 'road_trip'
    event_a.save()
    make_package(event_a)
    auto = services.score_sponsor_fit(event_a, make_sponsor(org_a, 'Auto', 'automotive'), save=False)
    finance = services.score_sponsor_fit(event_a, make_sponsor(org_a, 'Bank', 'finance'), save=False)
    assert auto['fit_score'] > finance['fit_score']
    assert 'evaluation' not in auto


def test_fit_history_boosts_score(event_a, event_b, org_a):
    make_package(event_a)
    sponsor = make_sponsor(org_a)
    before = services.score_sponsor_fit(event_a, sponsor, save=False)['fit_score']
    other = event_b
    other.organization = org_a
    other.save()
    make_deal(other, sponsor, 'paid', '5000', signed_at=date.today())
    after = services.score_sponsor_fit(event_a, sponsor, save=False)
    assert after['fit_score'] > before
    assert after['budget_fit'] is True


def test_fit_audience_match_counts_participants(event_a, org_a):
    make_package(event_a)
    sponsor = make_sponsor(org_a, industry='health')
    for index in range(4):
        p = _participant(f'p{index}', f'p{index}@t.local', 'participant', org_a)
        EventParticipant.objects.create(event=event_a, participant=p)
        if index < 2:
            ParticipantPreference.objects.create(participant=p, preference_type='activity', value='Yoga et bien-être')
    result = services.score_sponsor_fit(event_a, sponsor, save=False)
    assert result['audience_match_count'] == 2


def test_fit_custom_weights(event_a, org_a):
    make_package(event_a)
    sponsor = make_sponsor(org_a, industry='finance')
    event_a.event_type = 'conference'
    event_a.save()
    only_industry = services.score_sponsor_fit(
        event_a, sponsor, weights={'industry': 1, 'audience_size': 0, 'budget': 0, 'history': 0, 'audience_match': 0}, save=False,
    )
    assert only_industry['fit_score'] == 100


def test_fit_exclusivity_blocks(event_a, org_a):
    pkg = make_package(event_a, slots=3, exclusive_industry=True)
    make_deal(event_a, make_sponsor(org_a, 'Bank1', 'finance'), 'signed', '5000', package=pkg, signed_at=date.today())
    result = services.score_sponsor_fit(event_a, make_sponsor(org_a, 'Bank2', 'finance'), save=False)
    assert any(f['code'] == 'industry_exclusivity' for f in result['hard_constraint_failures'])


# ---------------------------------------------------------------- detect_conflicts

def test_no_conflicts_when_empty(event_a):
    assert services.detect_conflicts(event_a) == []


def test_slots_exceeded_is_error(event_a, org_a):
    pkg = make_package(event_a, slots=1)
    make_deal(event_a, make_sponsor(org_a, 'A'), 'signed', '1', package=pkg, signed_at=date.today())
    make_deal(event_a, make_sponsor(org_a, 'B'), 'paid', '1', package=pkg, signed_at=date.today())
    codes = {c['code']: c for c in services.detect_conflicts(event_a)}
    assert codes['slots_exceeded']['severity'] == 'error'


def test_slots_overpromised_is_warning(event_a, org_a):
    pkg = make_package(event_a, slots=1)
    make_deal(event_a, make_sponsor(org_a, 'A'), 'signed', '1', package=pkg, signed_at=date.today())
    make_deal(event_a, make_sponsor(org_a, 'B'), 'negotiating', '1', package=pkg)
    codes = {c['code']: c for c in services.detect_conflicts(event_a)}
    assert codes['slots_overpromised']['severity'] == 'warning'
    assert 'slots_exceeded' not in codes


def test_industry_exclusivity_conflict(event_a, org_a):
    pkg = make_package(event_a, slots=5, exclusive_industry=True)
    a = make_deal(event_a, make_sponsor(org_a, 'Bank1', 'finance'), 'signed', '1', package=pkg, signed_at=date.today())
    b = make_deal(event_a, make_sponsor(org_a, 'Bank2', 'finance'), 'signed', '1', package=pkg, signed_at=date.today())
    conflict = next(c for c in services.detect_conflicts(event_a) if c['code'] == 'industry_exclusivity')
    assert conflict['severity'] == 'error'
    assert set(conflict['deal_ids']) == {str(a.id), str(b.id)}


def test_other_industry_never_conflicts(event_a, org_a):
    pkg = make_package(event_a, slots=5, exclusive_industry=True)
    for name in ('X', 'Y'):
        make_deal(event_a, make_sponsor(org_a, name, 'other'), 'signed', '1', package=pkg, signed_at=date.today())
    assert not [c for c in services.detect_conflicts(event_a) if c['code'] in ('industry_exclusivity', 'competing_sponsors')]


def test_competing_sponsors_warning(event_a, org_a):
    make_deal(event_a, make_sponsor(org_a, 'Bank1', 'finance'), 'signed', '1', signed_at=date.today())
    make_deal(event_a, make_sponsor(org_a, 'Bank2', 'finance'), 'signed', '1', signed_at=date.today())
    conflict = next(c for c in services.detect_conflicts(event_a) if c['code'] == 'competing_sponsors')
    assert conflict['severity'] == 'warning'


def test_booth_resource_overbooked(event_a, org_a):
    stand = Resource.objects.create(event=event_a, resource_type='booth', name='Hall A', capacity=1)
    for name in ('A', 'B'):
        deal = make_deal(event_a, make_sponsor(org_a, name), 'signed', '1', signed_at=date.today())
        SponsorDeliverable.objects.create(deal=deal, title='Stand', deliverable_type='booth', resource=stand)
    conflict = next(c for c in services.detect_conflicts(event_a) if c['code'] == 'resource_overbooked')
    assert conflict['severity'] == 'error'
    assert len(conflict['deal_ids']) == 2


def test_lost_deals_are_ignored(event_a, org_a):
    pkg = make_package(event_a, slots=1)
    make_deal(event_a, make_sponsor(org_a, 'A'), 'signed', '1', package=pkg, signed_at=date.today())
    make_deal(event_a, make_sponsor(org_a, 'B'), 'lost', '1', package=pkg)
    assert services.detect_conflicts(event_a) == []


# ---------------------------------------------------------------- transitions

def test_full_happy_path_logs_each_step(event_a, org_a, organizer_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'lead', '10000')
    for status in ('contacted', 'proposal_sent', 'negotiating', 'signed', 'paid'):
        services.transition_deal(deal, status, actor=organizer_a)
    deal.refresh_from_db()
    assert deal.status == 'paid'
    assert deal.probability_percent == 100
    assert SponsorshipActivity.objects.filter(deal=deal, action='status_changed').count() == 5
    last = SponsorshipActivity.objects.filter(deal=deal).first()
    assert last.actor == organizer_a and last.to_status == 'paid'


@pytest.mark.parametrize('start,target', [
    ('lead', 'signed'), ('lead', 'paid'), ('contacted', 'negotiating'),
    ('negotiating', 'lead'), ('paid', 'lost'), ('paid', 'lead'), ('lost', 'signed'),
])
def test_invalid_transitions_are_rejected(event_a, org_a, start, target):
    deal = make_deal(event_a, make_sponsor(org_a), start, '1', signed_at=date.today())
    with pytest.raises(services.TransitionError):
        services.transition_deal(deal, target, lost_reason='x')
    deal.refresh_from_db()
    assert deal.status == start


def test_unknown_status_rejected(event_a, org_a):
    with pytest.raises(services.TransitionError):
        services.transition_deal(make_deal(event_a, make_sponsor(org_a)), 'banana')


def test_lost_requires_reason_and_can_reopen(event_a, org_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'negotiating', '1')
    with pytest.raises(services.TransitionError):
        services.transition_deal(deal, 'lost')
    services.transition_deal(deal, 'lost', lost_reason='Budget gelé')
    deal.refresh_from_db()
    assert deal.status == 'lost' and deal.probability_percent == 0 and deal.lost_reason == 'Budget gelé'
    services.transition_deal(deal, 'lead')
    deal.refresh_from_db()
    assert deal.status == 'lead' and deal.lost_reason == ''


def test_signing_generates_deliverables_and_payments(event_a, org_a):
    start = date.today() + timedelta(days=90)
    event_a.start_date = start
    event_a.end_date = start + timedelta(days=2)  # contrainte : fin ≥ début
    event_a.save()
    pkg = make_package(event_a, benefits=[
        {'type': 'logo_placement', 'title': 'Logo sur le site', 'offset_days': -20},
        {'type': 'booth', 'title': 'Stand', 'offset_days': 0},
        {'type': 'inconnu', 'title': 'Autre chose', 'offset_days': 1},
    ])
    deal = make_deal(event_a, make_sponsor(org_a), 'negotiating', '10000', package=pkg)
    services.transition_deal(deal, 'signed')
    deliverables = {d.title: d for d in deal.deliverables.all()}
    assert set(deliverables) == {'Logo sur le site', 'Stand', 'Autre chose'}
    assert deliverables['Logo sur le site'].due_date == start - timedelta(days=20)
    assert deliverables['Autre chose'].deliverable_type == 'other'
    payments = list(deal.payments.order_by('due_date'))
    assert [p.amount for p in payments] == [Decimal('3000.00'), Decimal('7000.00')]
    assert sum(p.amount for p in payments) == Decimal('10000.00')
    assert payments[0].due_date == date.today()
    assert payments[1].due_date == start - timedelta(days=30)


def test_generation_is_idempotent(event_a, org_a):
    pkg = make_package(event_a, benefits=[{'type': 'booth', 'title': 'Stand', 'offset_days': 0}])
    deal = make_deal(event_a, make_sponsor(org_a), 'negotiating', '1000', package=pkg)
    services.transition_deal(deal, 'signed')
    services._ensure_deliverables(deal)
    services._ensure_payments(deal)
    assert deal.deliverables.count() == 1
    assert deal.payments.count() == 2


def test_signing_without_cash_creates_no_payments(event_a, org_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'negotiating', '0')
    services.transition_deal(deal, 'signed')
    assert deal.payments.count() == 0


def test_signing_blocked_by_exclusivity(event_a, org_a):
    pkg = make_package(event_a, slots=5, exclusive_industry=True)
    make_deal(event_a, make_sponsor(org_a, 'Bank1', 'finance'), 'signed', '1', package=pkg, signed_at=date.today())
    second = make_deal(event_a, make_sponsor(org_a, 'Bank2', 'finance'), 'negotiating', '1', package=pkg)
    third = make_deal(event_a, make_sponsor(org_a, 'Bank3', 'finance'), 'negotiating', '1', package=pkg)
    # un seul signé + un candidat = 2 confirmés dans un package exclusif : bloqué
    with pytest.raises(services.TransitionError) as exc:
        services.transition_deal(second, 'signed')
    assert exc.value.conflicts
    second.refresh_from_db()
    assert second.status == 'negotiating'
    assert third.status == 'negotiating'


def test_signing_blocked_by_slots(event_a, org_a):
    pkg = make_package(event_a, slots=1)
    make_deal(event_a, make_sponsor(org_a, 'A'), 'signed', '1', package=pkg, signed_at=date.today())
    candidate = make_deal(event_a, make_sponsor(org_a, 'B'), 'negotiating', '1', package=pkg)
    with pytest.raises(services.TransitionError):
        services.transition_deal(candidate, 'signed')


def test_signing_not_blocked_by_unrelated_error(event_a, org_a):
    pkg = make_package(event_a, slots=1)
    make_deal(event_a, make_sponsor(org_a, 'A'), 'signed', '1', package=pkg, signed_at=date.today())
    make_deal(event_a, make_sponsor(org_a, 'B'), 'paid', '1', package=pkg, signed_at=date.today())  # déjà en erreur
    free = make_deal(event_a, make_sponsor(org_a, 'C'), 'negotiating', '1')
    services.transition_deal(free, 'signed')
    free.refresh_from_db()
    assert free.status == 'signed'


def test_explicit_probability_is_respected_and_validated(event_a, org_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'lead')
    services.transition_deal(deal, 'contacted', probability_percent=35)
    deal.refresh_from_db()
    assert deal.probability_percent == 35
    with pytest.raises(services.TransitionError):
        services.transition_deal(deal, 'proposal_sent', probability_percent=150)


# ---------------------------------------------------------------- exposure

def test_exposure_counts_only_delivered(event_a, org_a):
    event_a.participant_expected = 200
    event_a.save()
    pkg = make_package(event_a, visibility_weight=Decimal('1.50'))
    deal = make_deal(event_a, make_sponsor(org_a), 'signed', '1', package=pkg, signed_at=date.today())
    SponsorDeliverable.objects.create(deal=deal, title='Naming', deliverable_type='naming', status='delivered')
    SponsorDeliverable.objects.create(deal=deal, title='Stand', deliverable_type='booth', status='pending')
    exposure = services.compute_exposure(deal)
    assert exposure['delivered'] == 1 and exposure['total'] == 2
    assert exposure['delivered_weight'] == 5
    assert exposure['estimated_exposure'] == 200 * 5 * 1.5


def test_exposure_without_deliverables_is_zero(event_a, org_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'signed', '1', signed_at=date.today())
    assert services.compute_exposure(deal)['estimated_exposure'] == 0


def test_exposure_custom_weights(event_a, org_a):
    event_a.participant_expected = 10
    event_a.save()
    deal = make_deal(event_a, make_sponsor(org_a), 'signed', '1', signed_at=date.today())
    SponsorDeliverable.objects.create(deal=deal, title='Logo', deliverable_type='logo_placement', status='delivered')
    assert services.compute_exposure(deal, weights={'logo_placement': 10})['estimated_exposure'] == 100


def test_balance_due_date_never_before_signature(event_a, org_a):
    """Événement dans moins de 30 jours : le solde est dû à la signature, pas dans le passé."""
    event_a.start_date = date.today() + timedelta(days=10)
    event_a.end_date = event_a.start_date + timedelta(days=2)  # contrainte : fin ≥ début
    event_a.save()
    deal = make_deal(event_a, make_sponsor(org_a), 'negotiating', '1000')
    services.transition_deal(deal, 'signed')
    assert all(p.due_date >= date.today() for p in deal.payments.all())
