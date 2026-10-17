import pytest
from rest_framework import status

from apps.sponsors.models import Sponsor
from apps.sponsors.tests.conftest import api_client
from apps.sponsors.tests.test_api import _sponsor_payload


@pytest.mark.django_db
def test_missing_header_is_forbidden():
    response = api_client(None).get('/api/sponsors/')
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert 'organisateur' in str(response.json()).lower() or 'administrat' in str(response.json()).lower()


@pytest.mark.django_db
def test_participant_role_is_forbidden(attendee):
    response = api_client(attendee).get('/api/sponsors/')
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert api_client(attendee).post('/api/sponsors/', _sponsor_payload(), format='json').status_code == 403


@pytest.mark.django_db
def test_invalid_participant_header_is_forbidden(organizer_a):
    client = api_client(None)
    client.credentials(HTTP_X_PARTICIPANT_ID='00000000-0000-0000-0000-000000000000')
    assert client.get('/api/sponsors/').status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_organizer_cannot_read_foreign_deal(organizer_a, organizer_b, event_b, org_b):
    sponsor = Sponsor.objects.create(
        organization=org_b,
        created_by=organizer_b,
        name='Secret',
        contact_name='S',
        contact_email='s@b.test',
    )
    from apps.sponsors.models import SponsorshipDeal
    deal = SponsorshipDeal.objects.create(event=event_b, sponsor=sponsor, owner=organizer_b)
    response = api_client(organizer_a).get(f'/api/sponsorship-deals/{deal.id}/')
    assert response.status_code == status.HTTP_404_NOT_FOUND
