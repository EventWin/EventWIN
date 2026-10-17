import json
from datetime import date

import pytest
from django.core import mail
from django.core import signing

from apps.sponsors import services
from apps.sponsors.models import SponsorDeliverable, SponsorPayment, SponsorshipActivity
from apps.sponsors.tests.conftest import api_client
from apps.sponsors.tests.test_services import make_deal, make_package, make_sponsor

pytestmark = pytest.mark.django_db


@pytest.fixture
def signed_deal(event_a, org_a, organizer_a):
    pkg = make_package(event_a, 'Or')
    deal = make_deal(
        event_a, make_sponsor(org_a, 'Acme'), 'signed', '5000', package=pkg,
        signed_at=date.today(), owner=organizer_a, notes='NOTE INTERNE CONFIDENTIELLE', probability_percent=100,
    )
    SponsorDeliverable.objects.create(deal=deal, title='Logo', deliverable_type='logo_placement')
    SponsorPayment.objects.create(deal=deal, label='Acompte', amount=1500, due_date=date.today())
    return deal


def link_for(deal, client):
    return client.post(f'/api/sponsorship-deals/{deal.id}/portal-link/', {}, format='json')


def test_portal_link_requires_signed_deal(event_a, org_a, organizer_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'negotiating')
    assert link_for(deal, api_client(organizer_a)).status_code == 400


def test_portal_link_requires_organizer(signed_deal, attendee):
    assert link_for(signed_deal, api_client(attendee)).status_code == 403
    assert link_for(signed_deal, api_client()).status_code == 403


def test_portal_link_other_org_hidden(signed_deal, organizer_b):
    assert link_for(signed_deal, api_client(organizer_b)).status_code == 404


def test_portal_read_without_any_credentials(signed_deal, organizer_a):
    token = link_for(signed_deal, api_client(organizer_a)).data['token']
    res = api_client().get(f'/api/sponsor-portal/{token}/')
    assert res.status_code == 200
    assert res.data['sponsor_name'] == 'Acme' and res.data['package_name'] == 'Or'
    assert len(res.data['deliverables']) == 1 and len(res.data['payments']) == 1


def test_portal_never_leaks_internal_data(signed_deal, organizer_a, org_a, event_a):
    make_deal(event_a, make_sponsor(org_a, 'Concurrent secret'), 'lead', '9999')
    token = link_for(signed_deal, api_client(organizer_a)).data['token']
    raw = json.dumps(api_client().get(f'/api/sponsor-portal/{token}/').json())
    for forbidden in ('NOTE INTERNE', 'probability', 'owner', 'Concurrent secret', 'notes', 'created_by', 'activities', 'contact_email'):
        assert forbidden not in raw


def test_portal_invalid_token():
    assert api_client().get('/api/sponsor-portal/garbage-token/').status_code == 404


def test_portal_token_signed_with_other_salt_is_rejected(signed_deal):
    forged = signing.dumps({'deal': str(signed_deal.id)}, salt='another.salt')
    assert api_client().get(f'/api/sponsor-portal/{forged}/').status_code == 404


def test_portal_expired_token(signed_deal, monkeypatch):
    token = services.make_portal_token(signed_deal)
    monkeypatch.setenv('SPONSORS_PORTAL_TTL_DAYS', '0')
    res = api_client().get(f'/api/sponsor-portal/{token}/')
    assert res.status_code == 410 and 'expiré' in res.data['detail']


def test_portal_closed_for_lost_deal(signed_deal):
    token = services.make_portal_token(signed_deal)
    signed_deal.status = 'lost'
    signed_deal.save()
    assert api_client().get(f'/api/sponsor-portal/{token}/').status_code == 404


def test_submit_asset_updates_deliverable_and_logs(signed_deal):
    token = services.make_portal_token(signed_deal)
    item = signed_deal.deliverables.first()
    res = api_client().post(
        f'/api/sponsor-portal/{token}/deliverables/{item.id}/submit-asset/',
        {'asset_url': 'https://cdn.acme.io/logo.svg'}, format='json',
    )
    assert res.status_code == 200
    item.refresh_from_db()
    assert item.asset_url == 'https://cdn.acme.io/logo.svg' and item.status == 'in_progress'
    log = SponsorshipActivity.objects.get(deal=signed_deal, action='asset_submitted')
    assert log.actor is None


@pytest.mark.parametrize('bad', ['', 'not a url', 'javascript:alert(1)', 'ftp://x.io/a'])
def test_submit_asset_rejects_bad_urls(signed_deal, bad):
    token = services.make_portal_token(signed_deal)
    item = signed_deal.deliverables.first()
    res = api_client().post(f'/api/sponsor-portal/{token}/deliverables/{item.id}/submit-asset/', {'asset_url': bad}, format='json')
    assert res.status_code == 400
    item.refresh_from_db()
    assert item.asset_url == ''


def test_submit_asset_for_foreign_deliverable_is_refused(signed_deal, event_a, org_a):
    other = make_deal(event_a, make_sponsor(org_a, 'Other'), 'signed', '1', signed_at=date.today())
    foreign = SponsorDeliverable.objects.create(deal=other, title='Autre')
    token = services.make_portal_token(signed_deal)
    res = api_client().post(f'/api/sponsor-portal/{token}/deliverables/{foreign.id}/submit-asset/', {'asset_url': 'https://x.io/a'}, format='json')
    assert res.status_code == 404
    foreign.refresh_from_db()
    assert foreign.asset_url == ''


def test_submit_asset_on_delivered_item_refused(signed_deal):
    item = signed_deal.deliverables.first()
    item.status = 'delivered'
    item.save()
    token = services.make_portal_token(signed_deal)
    res = api_client().post(f'/api/sponsor-portal/{token}/deliverables/{item.id}/submit-asset/', {'asset_url': 'https://x.io/a'}, format='json')
    assert res.status_code == 400


def test_submit_asset_invalid_token(signed_deal):
    item = signed_deal.deliverables.first()
    assert api_client().post(f'/api/sponsor-portal/xxx/deliverables/{item.id}/submit-asset/', {'asset_url': 'https://x.io'}, format='json').status_code == 404


def test_portal_link_email_is_sent_with_link(signed_deal, organizer_a):
    res = api_client(organizer_a).post(
        f'/api/sponsorship-deals/{signed_deal.id}/portal-link/', {'send_email': True}, format='json',
    )
    assert res.status_code == 200
    assert res.data['email_sent'] is True and res.data['sent_to'] == signed_deal.sponsor.contact_email
    assert len(mail.outbox) == 1
    assert res.data['url'] in mail.outbox[0].alternatives[0][0]
    assert SponsorshipActivity.objects.filter(deal=signed_deal, action='portal_link_sent').exists()


def test_portal_link_email_custom_and_invalid_recipient(signed_deal, organizer_a):
    client = api_client(organizer_a)
    ok = client.post(f'/api/sponsorship-deals/{signed_deal.id}/portal-link/', {'send_email': True, 'to_email': 'cfo@acme.io'}, format='json')
    assert ok.data['sent_to'] == 'cfo@acme.io'
    bad = client.post(f'/api/sponsorship-deals/{signed_deal.id}/portal-link/', {'send_email': True, 'to_email': 'nope'}, format='json')
    assert bad.status_code == 400


def test_portal_throttling(signed_deal, monkeypatch):
    from django.core.cache import cache
    from apps.sponsors.views import PortalRateThrottle
    cache.clear()
    monkeypatch.setattr(PortalRateThrottle, 'THROTTLE_RATES', {'sponsor_portal': '3/min'})
    client = api_client()
    codes = [client.get('/api/sponsor-portal/abc/').status_code for _ in range(5)]
    assert codes[:3] == [404, 404, 404] and 429 in codes[3:]
    cache.clear()
