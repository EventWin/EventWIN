from datetime import date, timedelta
from decimal import Decimal

import pytest

from apps.budgets.models import BudgetItem
from apps.simulation.models import Scenario
from apps.sponsors.models import SponsorDeliverable, SponsorPayment, SponsorshipActivity, SponsorshipDeal
from apps.sponsors.tests.conftest import api_client
from apps.sponsors.tests.test_services import make_deal, make_package, make_sponsor

pytestmark = pytest.mark.django_db


# ------------------------------------------------------------ transition / assign

def test_transition_endpoint_happy_path(event_a, org_a, organizer_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'lead', '1000')
    res = api_client(organizer_a).post(f'/api/sponsorship-deals/{deal.id}/transition/', {'status': 'contacted'}, format='json')
    assert res.status_code == 200
    assert res.data['status'] == 'contacted'
    assert SponsorshipActivity.objects.filter(deal=deal, actor=organizer_a, action='status_changed').exists()


def test_transition_endpoint_invalid_returns_400_with_message(event_a, org_a, organizer_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'lead')
    res = api_client(organizer_a).post(f'/api/sponsorship-deals/{deal.id}/transition/', {'status': 'paid'}, format='json')
    assert res.status_code == 400
    assert 'impossible' in res.data['detail']


def test_transition_lost_needs_reason(event_a, org_a, organizer_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'lead')
    client = api_client(organizer_a)
    assert client.post(f'/api/sponsorship-deals/{deal.id}/transition/', {'status': 'lost'}, format='json').status_code == 400
    ok = client.post(f'/api/sponsorship-deals/{deal.id}/transition/', {'status': 'lost', 'lost_reason': 'Pas de budget'}, format='json')
    assert ok.status_code == 200


def test_transition_bad_probability(event_a, org_a, organizer_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'lead')
    res = api_client(organizer_a).post(f'/api/sponsorship-deals/{deal.id}/transition/', {'status': 'contacted', 'probability_percent': 'abc'}, format='json')
    assert res.status_code == 400


def test_transition_forbidden_for_other_org(event_a, org_a, organizer_b):
    deal = make_deal(event_a, make_sponsor(org_a))
    res = api_client(organizer_b).post(f'/api/sponsorship-deals/{deal.id}/transition/', {'status': 'contacted'}, format='json')
    assert res.status_code == 404


def test_transition_signed_returns_generated_children(event_a, org_a, organizer_a):
    pkg = make_package(event_a, benefits=[{'type': 'booth', 'title': 'Stand', 'offset_days': 0}])
    deal = make_deal(event_a, make_sponsor(org_a), 'negotiating', '1000', package=pkg)
    res = api_client(organizer_a).post(f'/api/sponsorship-deals/{deal.id}/transition/', {'status': 'signed'}, format='json')
    assert res.status_code == 200
    assert res.data['deliverables_total'] == 1
    assert deal.payments.count() == 2


def test_patch_cannot_change_status(event_a, org_a, organizer_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'lead')
    res = api_client(organizer_a).patch(f'/api/sponsorship-deals/{deal.id}/', {'status': 'signed'}, format='json')
    assert res.status_code == 400
    deal.refresh_from_db()
    assert deal.status == 'lead'


def test_patch_amount_is_logged(event_a, org_a, organizer_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'lead', '1000')
    res = api_client(organizer_a).patch(f'/api/sponsorship-deals/{deal.id}/', {'cash_amount': '2500.00'}, format='json')
    assert res.status_code == 200
    assert SponsorshipActivity.objects.filter(deal=deal, action='amount_changed').exists()


def test_mine_filter(event_a, org_a, organizer_a, admin_user):
    mine = make_deal(event_a, make_sponsor(org_a, 'Mine'), owner=organizer_a)
    make_deal(event_a, make_sponsor(org_a, 'Other'), owner=admin_user)
    res = api_client(organizer_a).get(f'/api/sponsorship-deals/?event={event_a.id}&mine=1')
    assert [d['id'] for d in res.data] == [str(mine.id)]


def test_assign_changes_owner_and_logs(event_a, org_a, organizer_a):
    from apps.sponsors.tests.conftest import _participant
    colleague = _participant('colleague', 'c@test.local', 'organizer', org_a)
    deal = make_deal(event_a, make_sponsor(org_a), owner=organizer_a)
    res = api_client(organizer_a).post(f'/api/sponsorship-deals/{deal.id}/assign/', {'owner': str(colleague.id)}, format='json')
    assert res.status_code == 200
    deal.refresh_from_db()
    assert deal.owner_id == colleague.id
    assert SponsorshipActivity.objects.filter(deal=deal, action='owner_changed').exists()


def test_assign_rejects_regular_participant_and_non_owner(event_a, org_a, organizer_a, attendee):
    from apps.sponsors.tests.conftest import _participant
    other = _participant('other', 'o@test.local', 'organizer', org_a)
    deal = make_deal(event_a, make_sponsor(org_a), owner=organizer_a)
    assert api_client(organizer_a).post(f'/api/sponsorship-deals/{deal.id}/assign/', {'owner': str(attendee.id)}, format='json').status_code == 400
    assert api_client(other).post(f'/api/sponsorship-deals/{deal.id}/assign/', {'owner': str(other.id)}, format='json').status_code == 403


def test_activities_filter_by_deal(event_a, org_a, organizer_a):
    d1 = make_deal(event_a, make_sponsor(org_a, 'A'))
    d2 = make_deal(event_a, make_sponsor(org_a, 'B'))
    client = api_client(organizer_a)
    client.post(f'/api/sponsorship-deals/{d1.id}/transition/', {'status': 'contacted'}, format='json')
    res = client.get(f'/api/sponsorship-activities/?deal={d1.id}')
    assert res.status_code == 200 and len(res.data) == 1
    assert client.get(f'/api/sponsorship-activities/?deal={d2.id}').data == []


def test_package_with_signed_deal_cannot_be_deleted(event_a, org_a, organizer_a):
    pkg = make_package(event_a)
    make_deal(event_a, make_sponsor(org_a), 'signed', '1', package=pkg, signed_at=date.today())
    assert api_client(organizer_a).delete(f'/api/sponsorship-packages/{pkg.id}/').status_code == 400
    free = make_package(event_a, 'Libre')
    assert api_client(organizer_a).delete(f'/api/sponsorship-packages/{free.id}/').status_code == 204


# ------------------------------------------------------------ analyse

def test_summary_endpoint(event_a, org_a, organizer_a):
    make_deal(event_a, make_sponsor(org_a), 'signed', '5000', signed_at=date.today())
    res = api_client(organizer_a).get(f'/api/sponsorship-summary/?event={event_a.id}')
    assert res.status_code == 200
    assert res.data['summary']['confirmed_cash'] == 5000
    assert set(res.data) == {'event', 'summary', 'conflicts', 'alerts'}


def test_event_param_validation_and_scoping(event_a, event_b, organizer_a):
    client = api_client(organizer_a)
    assert client.get('/api/sponsorship-summary/').status_code == 400
    assert client.get('/api/sponsorship-summary/?event=not-a-uuid').status_code == 400
    assert client.get(f'/api/sponsorship-summary/?event={event_b.id}').status_code == 404


@pytest.mark.parametrize('url', [
    'sponsorship-summary', 'sponsorship-recommendations', 'sponsorship-conflicts', 'sponsorship-alerts', 'sponsorship-net-budget',
])
def test_analysis_endpoints_require_organizer(url, event_a, attendee):
    assert api_client().get(f'/api/{url}/?event={event_a.id}').status_code == 401
    assert api_client(attendee).get(f'/api/{url}/?event={event_a.id}').status_code == 403


def test_recommendations_endpoint(event_a, organizer_a):
    make_package(event_a, 'Or', '10000', 2)
    client = api_client(organizer_a)
    res = client.get(f'/api/sponsorship-recommendations/?event={event_a.id}&gap=8000')
    assert res.status_code == 200
    assert res.data['proposals'][0]['covers_gap'] is True
    assert client.get(f'/api/sponsorship-recommendations/?event={event_a.id}&gap=abc').status_code == 400
    assert client.get(f'/api/sponsorship-recommendations/?event={event_a.id}&gap=-5').status_code == 400


def test_conflicts_endpoint(event_a, org_a, organizer_a):
    pkg = make_package(event_a, slots=1)
    make_deal(event_a, make_sponsor(org_a, 'A'), 'signed', '1', package=pkg, signed_at=date.today())
    make_deal(event_a, make_sponsor(org_a, 'B'), 'paid', '1', package=pkg, signed_at=date.today())
    res = api_client(organizer_a).get(f'/api/sponsorship-conflicts/?event={event_a.id}')
    assert any(c['code'] == 'slots_exceeded' for c in res.data)


def test_fit_evaluate_sorted_and_scoped(event_a, org_a, org_b, organizer_a):
    make_package(event_a)
    event_a.event_type = 'conference'
    event_a.save()
    best = make_sponsor(org_a, 'Bank', 'finance')
    worse = make_sponsor(org_a, 'Mystery', 'other')
    make_sponsor(org_b, 'Foreign', 'finance')
    res = api_client(organizer_a).post('/api/sponsor-fit/evaluate/', {'event': str(event_a.id)}, format='json')
    assert res.status_code == 200
    names = [r['sponsor_name'] for r in res.data]
    assert names == ['Bank', 'Mystery'] and 'Foreign' not in names
    assert res.data[0]['fit_score'] >= res.data[1]['fit_score']
    only = api_client(organizer_a).post('/api/sponsor-fit/evaluate/', {'event': str(event_a.id), 'sponsor_ids': [str(worse.id)]}, format='json')
    assert [r['sponsor_name'] for r in only.data] == ['Mystery']
    assert only.data[0]['breakdown']
    bad = api_client(organizer_a).post('/api/sponsor-fit/evaluate/', {'event': str(event_a.id), 'sponsor_ids': 'x'}, format='json')
    assert bad.status_code == 400


# ------------------------------------------------------------ rapport

def test_report_json_and_csv(event_a, org_a, organizer_a):
    deal = make_deal(event_a, make_sponsor(org_a, 'Acme Corp'), 'signed', '4000', signed_at=date.today())
    SponsorDeliverable.objects.create(deal=deal, title='Logo', deliverable_type='logo_placement', status='delivered')
    SponsorDeliverable.objects.create(deal=deal, title='Stand', deliverable_type='booth')
    SponsorPayment.objects.create(deal=deal, label='Acompte', amount=Decimal('1000'), status='paid', due_date=date.today())
    client = api_client(organizer_a)
    res = client.get(f'/api/sponsorship-deals/{deal.id}/report/')
    assert res.status_code == 200
    assert res.data['deliverables_delivered'] == 1 and res.data['deliverables_total'] == 2
    assert res.data['payments_paid'] == 1000
    csv_res = client.get(f'/api/sponsorship-deals/{deal.id}/report-csv/')
    assert csv_res.status_code == 200
    assert csv_res['Content-Type'].startswith('text/csv')
    assert 'attachment' in csv_res['Content-Disposition']
    assert 'Acme Corp' in csv_res.content.decode('utf-8-sig')


# ------------------------------------------------------------ import CSV / quick-create

CSV_OK = (
    'name,industry,contact_name,contact_email,website,country\n'
    'Alpha,tech,Ann,ann@alpha.io,alpha.io,FR\n'
    'Beta,finance,Bob,bob@beta.io,,BE\n'
)


def test_import_csv_creates_and_scopes(org_a, organizer_a):
    from apps.sponsors.models import Sponsor
    res = api_client(organizer_a).post('/api/sponsors/import/', {'csv': CSV_OK}, format='json')
    assert res.status_code == 200
    assert res.data['created'] == 2 and res.data['errors'] == []
    alpha = Sponsor.objects.get(name='Alpha')
    assert alpha.organization_id == org_a.id and alpha.created_by_id == organizer_a.id
    assert alpha.website == 'https://alpha.io'


def test_import_csv_reports_errors_duplicates_per_line(org_a, organizer_a):
    from apps.sponsors.tests.test_services import make_sponsor as ms
    ms(org_a, 'Alpha')
    text = (
        'name;industry;contact_name;contact_email;website;country\n'
        'Alpha;tech;Ann;ann@alpha.io;;FR\n'
        ';tech;X;x@x.io;;FR\n'
        'Gamma;tech;G;not-an-email;;FR\n'
        'Delta;spaceship;D;d@d.io;;FR\n'
        'Epsilon;tech;E;e@e.io;;FR\n'
    )
    res = api_client(organizer_a).post('/api/sponsors/import/', {'csv': text}, format='json')
    assert res.status_code == 200
    assert res.data['created'] == 1 and res.data['skipped'] == 1
    assert sorted(e['line'] for e in res.data['errors']) == [3, 4, 5]


def test_import_csv_missing_columns_and_empty(organizer_a):
    client = api_client(organizer_a)
    res = client.post('/api/sponsors/import/', {'csv': 'foo,bar\n1,2\n'}, format='json')
    assert res.data['created'] == 0 and res.data['errors'][0]['line'] == 1
    assert client.post('/api/sponsors/import/', {'csv': ''}, format='json').status_code == 400


def test_import_csv_file_upload_latin1(org_a, organizer_a):
    from django.core.files.uploadedfile import SimpleUploadedFile
    content = 'name,industry,contact_name,contact_email\nCafé Noir,food_beverage,René,rene@cafe.fr\n'.encode('latin-1')
    upload = SimpleUploadedFile('s.csv', content, content_type='text/csv')
    res = api_client(organizer_a).post('/api/sponsors/import/', {'file': upload}, format='multipart')
    assert res.status_code == 200 and res.data['created'] == 1


def test_import_requires_organizer(attendee):
    assert api_client(attendee).post('/api/sponsors/import/', {'csv': CSV_OK}, format='json').status_code == 403


def test_quick_create_sponsor_and_deal(event_a, org_a, organizer_a):
    pkg = make_package(event_a)
    body = {
        'sponsor': {'name': 'Nova', 'industry': 'tech', 'contact_name': 'N', 'contact_email': 'n@nova.io'},
        'deal': {'event': str(event_a.id), 'package': str(pkg.id), 'cash_amount': '3000.00'},
    }
    res = api_client(organizer_a).post('/api/sponsors/quick-create/', body, format='json')
    assert res.status_code == 201
    assert res.data['sponsor']['name'] == 'Nova'
    deal = SponsorshipDeal.objects.get(pk=res.data['deal']['id'])
    assert deal.owner_id == organizer_a.id and deal.sponsor.created_by_id == organizer_a.id
    assert SponsorshipActivity.objects.filter(deal=deal, action='created').exists()


def test_quick_create_duplicate_then_force(event_a, org_a, organizer_a):
    make_sponsor(org_a, 'Nova')
    body = {'sponsor': {'name': 'Nova SAS', 'industry': 'tech', 'contact_name': 'N', 'contact_email': 'n2@nova.io'}}
    client = api_client(organizer_a)
    res = client.post('/api/sponsors/quick-create/', body, format='json')
    assert res.status_code == 409 and res.data['duplicates']
    assert client.post('/api/sponsors/quick-create/?force=true', body, format='json').status_code == 201


def test_quick_create_is_atomic_when_deal_invalid(event_a, org_a, organizer_a):
    from apps.sponsors.models import Sponsor
    body = {
        'sponsor': {'name': 'Ghost', 'industry': 'tech', 'contact_name': 'G', 'contact_email': 'g@g.io'},
        'deal': {'event': str(event_a.id), 'cash_amount': '-5'},
    }
    res = api_client(organizer_a).post('/api/sponsors/quick-create/', body, format='json')
    assert res.status_code == 400
    assert not Sponsor.objects.filter(name='Ghost').exists()


def test_quick_create_foreign_event_is_hidden(event_b, organizer_a):
    body = {
        'sponsor': {'name': 'Spy', 'industry': 'tech', 'contact_name': 'S', 'contact_email': 's@s.io'},
        'deal': {'event': str(event_b.id)},
    }
    assert api_client(organizer_a).post('/api/sponsors/quick-create/', body, format='json').status_code == 404


# ------------------------------------------------------------ alertes

def test_alerts_cover_payments_deliverables_inactivity(event_a, org_a, organizer_a):
    from django.utils import timezone
    today = date.today()
    deal = make_deal(event_a, make_sponsor(org_a, 'A'), 'signed', '1000', signed_at=today)
    SponsorPayment.objects.create(deal=deal, label='Late', amount=Decimal('10'), due_date=today - timedelta(days=3), status='planned')
    SponsorPayment.objects.create(deal=deal, label='Soon', amount=Decimal('10'), due_date=today + timedelta(days=2), status='planned')
    SponsorPayment.objects.create(deal=deal, label='Done', amount=Decimal('10'), due_date=today - timedelta(days=9), status='paid')
    SponsorDeliverable.objects.create(deal=deal, title='Late item', due_date=today - timedelta(days=1))
    SponsorDeliverable.objects.create(deal=deal, title='Risky', status='at_risk')
    SponsorDeliverable.objects.create(deal=deal, title='Fine', due_date=today + timedelta(days=60))
    stale = make_deal(event_a, make_sponsor(org_a, 'Stale'), 'negotiating', '500')
    SponsorshipDeal.objects.filter(pk=stale.pk).update(created_at=timezone.now() - timedelta(days=30))
    res = api_client(organizer_a).get(f'/api/sponsorship-alerts/?event={event_a.id}')
    codes = [a['code'] for a in res.data]
    assert codes.count('payment_overdue') == 1 and 'payment_due_soon' in codes
    assert 'deliverable_late' in codes and 'deliverable_at_risk' in codes
    assert 'deal_inactive' in codes
    assert not any('Fine' in a['message'] or 'Done' in a['message'] for a in res.data)
    assert res.data[0]['severity'] == 'error'


def test_recent_activity_prevents_inactivity_alert(event_a, org_a, organizer_a):
    from django.utils import timezone
    deal = make_deal(event_a, make_sponsor(org_a), 'negotiating', '500')
    SponsorshipDeal.objects.filter(pk=deal.pk).update(created_at=timezone.now() - timedelta(days=40))
    SponsorshipActivity.objects.create(deal=deal, action='note', message='Appel client')
    res = api_client(organizer_a).get(f'/api/sponsorship-alerts/?event={event_a.id}')
    assert 'deal_inactive' not in [a['code'] for a in res.data]


def test_refresh_overdue_payments(event_a, org_a):
    from apps.sponsors import services
    today = date.today()
    deal = make_deal(event_a, make_sponsor(org_a), 'signed', '1000', signed_at=today)
    late = SponsorPayment.objects.create(deal=deal, label='L', amount=1, due_date=today - timedelta(days=1), status='invoiced')
    ok = SponsorPayment.objects.create(deal=deal, label='O', amount=1, due_date=today + timedelta(days=1))
    paid = SponsorPayment.objects.create(deal=deal, label='P', amount=1, due_date=today - timedelta(days=5), status='paid')
    assert services.refresh_overdue_payments() == 1
    for p in (late, ok, paid):
        p.refresh_from_db()
    assert (late.status, ok.status, paid.status) == ('overdue', 'planned', 'paid')
    assert services.refresh_overdue_payments() == 0


# ------------------------------------------------------------ budget net / scénario

def _priced_item(event, name, total):
    return BudgetItem.objects.create(
        event=event, name=name, quantity=1, unit_price=Decimal(total), total=Decimal(total),
        price_source='ai_estimate', analysis_status='priced',
    )


def test_net_budget_reads_budget_without_writing(event_a, org_a, organizer_a):
    # Coût estimé = ressources chiffrées du module Budget (même calcul que la page Budget).
    _priced_item(event_a, 'Hôtel', '6000')
    _priced_item(event_a, 'Salle', '4000')
    make_deal(event_a, make_sponsor(org_a, 'A'), 'signed', '3000', signed_at=date.today())
    make_deal(event_a, make_sponsor(org_a, 'B'), 'negotiating', '2000', probability_percent=50)
    before = BudgetItem.objects.count()
    res = api_client(organizer_a).get(f'/api/sponsorship-net-budget/?event={event_a.id}')
    assert res.status_code == 200
    d = res.data
    assert d['planned_cost'] == 10000 and d['confirmed_sponsorship'] == 3000
    assert d['net_pessimistic'] == 7000 and d['net_weighted'] == 6000 and d['net_optimistic'] == 5000
    assert d['target_budget'] == 20000
    assert before == BudgetItem.objects.count()


def test_net_budget_without_priced_items(event_a, organizer_a):
    client = api_client(organizer_a)
    data = client.get(f'/api/sponsorship-net-budget/?event={event_a.id}').data
    # Aucun coût chiffré : coût 0, mais le budget cible de la fiche existe.
    assert data['planned_cost'] == 0 and data['priced_count'] == 0
    assert data['has_budget'] is True
    _priced_item(event_a, 'Traiteur', '9000')
    assert client.get(f'/api/sponsorship-net-budget/?event={event_a.id}').data['planned_cost'] == 9000


def test_scenario_impact(event_a, org_a, event_b, organizer_a, organizer_b):
    scenario = Scenario.objects.create(event=event_a, name='S1')
    make_deal(event_a, make_sponsor(org_a, 'A'), 'signed', '3000', signed_at=date.today())
    make_deal(event_a, make_sponsor(org_a, 'B'), 'negotiating', '2000', probability_percent=50)
    client = api_client(organizer_a)
    base = client.get(f'/api/sponsorship-scenario-impact/?scenario={scenario.id}').data
    assert base['total_revenue'] == 3000 and base['weighted_pipeline'] == 0
    full = client.get(f'/api/sponsorship-scenario-impact/?scenario={scenario.id}&include_weighted=1').data
    assert full['total_revenue'] == 4000
    assert api_client(organizer_b).get(f'/api/sponsorship-scenario-impact/?scenario={scenario.id}').status_code == 404
    assert client.get('/api/sponsorship-scenario-impact/').status_code == 400
