import json
from datetime import date, timedelta
from io import StringIO
from unittest import mock

import pytest
from django.core.management import call_command

from apps.sponsors.models import Sponsor, SponsorPayment, SponsorshipDeal
from apps.sponsors.tests.test_services import make_deal, make_sponsor

pytestmark = pytest.mark.django_db


def test_refresh_command(event_a, org_a):
    deal = make_deal(event_a, make_sponsor(org_a), 'signed', '100', signed_at=date.today())
    SponsorPayment.objects.create(deal=deal, label='L', amount=1, due_date=date.today() - timedelta(days=2))
    out = StringIO()
    call_command('refresh_sponsor_payments', stdout=out)
    assert '1' in out.getvalue()
    assert SponsorPayment.objects.get(label='L').status == 'overdue'


def test_send_alerts_without_webhook_logs_only(event_a, org_a, monkeypatch):
    monkeypatch.delenv('SPONSORS_WEBHOOK_URL', raising=False)
    deal = make_deal(event_a, make_sponsor(org_a), 'signed', '100', signed_at=date.today())
    SponsorPayment.objects.create(deal=deal, label='L', amount=1, due_date=date.today() - timedelta(days=2))
    out = StringIO()
    with mock.patch('urllib.request.urlopen') as urlopen:
        call_command('send_sponsor_alerts', stdout=out)
    urlopen.assert_not_called()
    assert 'SPONSORS_WEBHOOK_URL' in out.getvalue()


def test_send_alerts_posts_json_to_webhook(event_a, org_a, monkeypatch):
    monkeypatch.setenv('SPONSORS_WEBHOOK_URL', 'https://n8n.example/webhook/x')
    deal = make_deal(event_a, make_sponsor(org_a), 'signed', '100', signed_at=date.today())
    SponsorPayment.objects.create(deal=deal, label='L', amount=1, due_date=date.today() - timedelta(days=2))
    with mock.patch('urllib.request.urlopen') as urlopen:
        urlopen.return_value.__enter__.return_value.status = 200
        call_command('send_sponsor_alerts', stdout=StringIO())
    request = urlopen.call_args[0][0]
    body = json.loads(request.data)
    assert request.full_url == 'https://n8n.example/webhook/x'
    assert body['events'][0]['event_id'] == str(event_a.id)
    assert body['events'][0]['alerts'][0]['code'] == 'payment_overdue'


def test_send_alerts_silent_when_nothing_to_report(event_a, monkeypatch):
    monkeypatch.setenv('SPONSORS_WEBHOOK_URL', 'https://n8n.example/webhook/x')
    with mock.patch('urllib.request.urlopen') as urlopen:
        call_command('send_sponsor_alerts', stdout=StringIO())
    urlopen.assert_not_called()


def test_seed_command_is_idempotent(event_a, organizer_a):
    call_command('seed_sponsors', stdout=StringIO())
    first = (Sponsor.objects.count(), SponsorshipDeal.objects.count())
    call_command('seed_sponsors', stdout=StringIO())
    assert (Sponsor.objects.count(), SponsorshipDeal.objects.count()) == first
    assert first[0] == 8 and first[1] == 6
