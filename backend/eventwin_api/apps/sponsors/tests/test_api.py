from datetime import date, timedelta
from decimal import Decimal

import pytest
from rest_framework import status

from apps.sponsors.models import (
    Sponsor,
    SponsorDeliverable,
    SponsorPayment,
    SponsorshipActivity,
    SponsorshipDeal,
    SponsorshipPackage,
)
from apps.sponsors.tests.conftest import api_client


def _sponsor_payload(**overrides):
    data = {
        'name': 'Acme SAS',
        'industry': 'tech',
        'contact_name': 'Ada Lovelace',
        'contact_email': 'ada@acme.test',
        'website': 'https://www.acme.test',
        'relationship_status': 'prospect',
    }
    data.update(overrides)
    return data


@pytest.mark.django_db
def test_create_sponsor_sets_created_by_and_organization(organizer_a, org_a, org_b):
    client = api_client(organizer_a)
    response = client.post(
        '/api/sponsors/',
        _sponsor_payload(organization=str(org_b.id), created_by='ignored'),
        format='json',
    )
    assert response.status_code == status.HTTP_201_CREATED
    body = response.json()
    assert body['organization'] == str(org_a.id)
    assert body['created_by'] == str(organizer_a.id)
    assert body['created_by_name'] == 'orga-a'
    assert Sponsor.objects.get(id=body['id']).organization_id == org_a.id


@pytest.mark.django_db
def test_organizer_cannot_force_created_by(organizer_a, organizer_b, org_a):
    client = api_client(organizer_a)
    response = client.post(
        '/api/sponsors/',
        _sponsor_payload(created_by=str(organizer_b.id)),
        format='json',
    )
    assert response.status_code == status.HTTP_201_CREATED
    assert response.json()['created_by'] == str(organizer_a.id)


@pytest.mark.django_db
def test_list_sponsors_is_scoped_to_organization(organizer_a, organizer_b, org_a, org_b):
    Sponsor.objects.create(
        organization=org_a, created_by=organizer_a, name='Alpha Co',
        contact_name='A', contact_email='a@a.test',
    )
    Sponsor.objects.create(
        organization=org_b, created_by=organizer_b, name='Beta Co',
        contact_name='B', contact_email='b@b.test',
    )
    response = api_client(organizer_a).get('/api/sponsors/')
    assert response.status_code == status.HTTP_200_OK
    names = {row['name'] for row in response.json()}
    assert names == {'Alpha Co'}


@pytest.mark.django_db
def test_admin_sees_all_sponsors(admin_user, organizer_a, organizer_b, org_a, org_b):
    Sponsor.objects.create(
        organization=org_a, created_by=organizer_a, name='Alpha Co',
        contact_name='A', contact_email='a@a.test',
    )
    Sponsor.objects.create(
        organization=org_b, created_by=organizer_b, name='Beta Co',
        contact_name='B', contact_email='b@b.test',
    )
    response = api_client(admin_user).get('/api/sponsors/')
    names = {row['name'] for row in response.json()}
    assert names == {'Alpha Co', 'Beta Co'}


@pytest.mark.django_db
def test_admin_can_set_organization(admin_user, org_b):
    response = api_client(admin_user).post(
        '/api/sponsors/',
        _sponsor_payload(name='Admin Corp', organization=str(org_b.id)),
        format='json',
    )
    assert response.status_code == status.HTTP_201_CREATED
    assert response.json()['organization'] == str(org_b.id)


@pytest.mark.django_db
def test_duplicate_sponsor_returns_409_then_force_creates(organizer_a):
    client = api_client(organizer_a)
    first = client.post('/api/sponsors/', _sponsor_payload(), format='json')
    assert first.status_code == status.HTTP_201_CREATED
    duplicate = client.post('/api/sponsors/', _sponsor_payload(name='Acme'), format='json')
    assert duplicate.status_code == status.HTTP_409_CONFLICT
    assert duplicate.json()['duplicates']
    forced = client.post('/api/sponsors/?force=true', _sponsor_payload(name='Acme'), format='json')
    assert forced.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
def test_package_and_deal_crud_filtered_by_event(organizer_a, event_a, event_b, org_a):
    client = api_client(organizer_a)
    sponsor_res = client.post('/api/sponsors/', _sponsor_payload(name='Lumière'), format='json')
    sponsor_id = sponsor_res.json()['id']
    pkg = client.post(
        '/api/sponsorship-packages/',
        {
            'event': str(event_a.id),
            'name': 'Or',
            'tier_rank': 1,
            'price': '8000.00',
            'slots_total': 2,
            'exclusive_industry': True,
            'benefits': [{'type': 'logo_placement', 'title': 'Logo', 'offset_days': -30}],
            'active': True,
        },
        format='json',
    )
    assert pkg.status_code == status.HTTP_201_CREATED
    deal = client.post(
        '/api/sponsorship-deals/',
        {
            'event': str(event_a.id),
            'sponsor': sponsor_id,
            'package': pkg.json()['id'],
            'status': 'lead',
            'cash_amount': '8000.00',
        },
        format='json',
    )
    assert deal.status_code == status.HTTP_201_CREATED
    body = deal.json()
    assert body['owner'] == str(organizer_a.id)
    assert body['owner_name'] == 'orga-a'
    assert body['probability_percent'] == 10
    assert SponsorshipActivity.objects.filter(deal_id=body['id'], action='created').exists()

    listed = client.get(f'/api/sponsorship-deals/?event={event_a.id}')
    assert len(listed.json()) == 1
    empty = client.get(f'/api/sponsorship-deals/?event={event_b.id}')
    assert empty.json() == []

    packages = client.get(f'/api/sponsorship-packages/?event={event_a.id}')
    assert len(packages.json()) == 1


@pytest.mark.django_db
def test_deal_with_foreign_sponsor_is_rejected(organizer_a, organizer_b, event_a, org_b):
    foreign = Sponsor.objects.create(
        organization=org_b,
        created_by=organizer_b,
        name='Foreign',
        contact_name='F',
        contact_email='f@b.test',
    )
    response = api_client(organizer_a).post(
        '/api/sponsorship-deals/',
        {'event': str(event_a.id), 'sponsor': str(foreign.id), 'cash_amount': '100.00'},
        format='json',
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert 'sponsor' in response.json()


@pytest.mark.django_db
def test_validations_probability_amounts_signed_at(organizer_a, event_a):
    client = api_client(organizer_a)
    sponsor_id = client.post('/api/sponsors/', _sponsor_payload(name='Valide'), format='json').json()['id']
    bad_prob = client.post(
        '/api/sponsorship-deals/',
        {
            'event': str(event_a.id),
            'sponsor': sponsor_id,
            'probability_percent': 150,
            'cash_amount': '10.00',
        },
        format='json',
    )
    assert bad_prob.status_code == status.HTTP_400_BAD_REQUEST

    bad_amount = client.post(
        '/api/sponsorship-deals/',
        {
            'event': str(event_a.id),
            'sponsor': sponsor_id,
            'cash_amount': '-1.00',
        },
        format='json',
    )
    assert bad_amount.status_code == status.HTTP_400_BAD_REQUEST

    unsigned = client.post(
        '/api/sponsorship-deals/',
        {
            'event': str(event_a.id),
            'sponsor': sponsor_id,
            'status': 'signed',
            'cash_amount': '10.00',
        },
        format='json',
    )
    assert unsigned.status_code == status.HTTP_400_BAD_REQUEST
    assert 'signed_at' in unsigned.json()

    ok = client.post(
        '/api/sponsorship-deals/',
        {
            'event': str(event_a.id),
            'sponsor': sponsor_id,
            'status': 'signed',
            'signed_at': '2026-01-15',
            'cash_amount': '10.00',
        },
        format='json',
    )
    assert ok.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
def test_package_negative_slots_rejected(organizer_a, event_a):
    response = api_client(organizer_a).post(
        '/api/sponsorship-packages/',
        {'event': str(event_a.id), 'name': 'Argent', 'slots_total': -1, 'price': '1000.00'},
        format='json',
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_deliverable_early_due_date_is_warning_not_error(organizer_a, event_a):
    client = api_client(organizer_a)
    sponsor_id = client.post('/api/sponsors/', _sponsor_payload(name='Early'), format='json').json()['id']
    deal_id = client.post(
        '/api/sponsorship-deals/',
        {'event': str(event_a.id), 'sponsor': sponsor_id, 'cash_amount': '1.00'},
        format='json',
    ).json()['id']
    too_early = date.fromisoformat(str(event_a.start_date)) - timedelta(days=120)
    response = client.post(
        '/api/sponsor-deliverables/',
        {
            'deal': deal_id,
            'title': 'Logo',
            'deliverable_type': 'logo_placement',
            'due_date': too_early.isoformat(),
        },
        format='json',
    )
    assert response.status_code == status.HTTP_201_CREATED
    assert response.json()['warnings']


@pytest.mark.django_db
def test_activity_journal_is_append_only(organizer_a, event_a):
    client = api_client(organizer_a)
    sponsor_id = client.post('/api/sponsors/', _sponsor_payload(name='Journal'), format='json').json()['id']
    deal_id = client.post(
        '/api/sponsorship-deals/',
        {'event': str(event_a.id), 'sponsor': sponsor_id},
        format='json',
    ).json()['id']
    activity = SponsorshipActivity.objects.get(deal_id=deal_id, action='created')
    url = f'/api/sponsorship-activities/{activity.id}/'
    assert client.patch(url, {'message': 'hack'}, format='json').status_code == status.HTTP_405_METHOD_NOT_ALLOWED
    assert client.delete(url).status_code == status.HTTP_405_METHOD_NOT_ALLOWED


@pytest.mark.django_db
def test_computed_deal_fields(organizer_a, event_a):
    client = api_client(organizer_a)
    sponsor_id = client.post('/api/sponsors/', _sponsor_payload(name='Compute'), format='json').json()['id']
    deal_id = client.post(
        '/api/sponsorship-deals/',
        {'event': str(event_a.id), 'sponsor': sponsor_id, 'cash_amount': '1000.00'},
        format='json',
    ).json()['id']
    SponsorDeliverable.objects.create(deal_id=deal_id, title='A', status='delivered')
    SponsorDeliverable.objects.create(deal_id=deal_id, title='B', status='pending')
    SponsorPayment.objects.create(deal_id=deal_id, label='Acompte', amount=Decimal('400.00'), status='paid')
    SponsorPayment.objects.create(deal_id=deal_id, label='Solde', amount=Decimal('600.00'), status='planned')
    body = client.get(f'/api/sponsorship-deals/{deal_id}/').json()
    assert body['deliverables_done'] == 1
    assert body['deliverables_total'] == 2
    assert Decimal(body['paid_amount']) == Decimal('400.00')


@pytest.mark.django_db
def test_organizer_without_organization_cannot_create(organizer_no_org):
    response = api_client(organizer_no_org).post('/api/sponsors/', _sponsor_payload(), format='json')
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert api_client(organizer_no_org).get('/api/sponsors/').json() == []
