import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.sponsors.models import Sponsor, SponsorshipDeal
from apps.sponsors.tests.conftest import api_client
from apps.sponsors.tests.test_api import _sponsor_payload

DENIED = (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)


@pytest.mark.django_db
def test_anonymous_is_denied():
    assert api_client(None).get('/api/sponsors/').status_code in DENIED


@pytest.mark.django_db
def test_participant_role_is_forbidden(attendee):
    response = api_client(attendee).get('/api/sponsors/')
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert api_client(attendee).post('/api/sponsors/', _sponsor_payload(), format='json').status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize('header', ['1', 'abc', 'not-a-uuid'])
def test_legacy_participant_header_is_ignored(organizer_a, header):
    # L'ancien en-tête X-Participant-Id était falsifiable : il n'est plus lu.
    # Même l'identifiant d'un vrai organisateur ne donne aucun accès.
    for value in (header, str(organizer_a.id)):
        response = APIClient().get('/api/sponsors/', HTTP_X_PARTICIPANT_ID=value)
        assert response.status_code in DENIED


@pytest.mark.django_db
def test_disabled_organizer_is_forbidden(organizer_a):
    organizer_a.status = 'disabled'
    organizer_a.save()
    assert api_client(organizer_a).get('/api/sponsors/').status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_superadmin_without_profile_sees_everything(superadmin_no_profile, organizer_b, event_b, org_b):
    sponsor = Sponsor.objects.create(organization=org_b, created_by=organizer_b, name='Global',
                                     contact_name='G', contact_email='g@b.test')
    SponsorshipDeal.objects.create(event=event_b, sponsor=sponsor, owner=organizer_b)
    client = api_client(superadmin_no_profile)
    assert client.get('/api/sponsors/').status_code == status.HTTP_200_OK
    assert len(client.get('/api/sponsorship-deals/').json()) == 1


@pytest.mark.django_db
def test_organizer_cannot_read_foreign_deal(organizer_a, organizer_b, event_b, org_b):
    sponsor = Sponsor.objects.create(
        organization=org_b,
        created_by=organizer_b,
        name='Secret',
        contact_name='S',
        contact_email='s@b.test',
    )
    deal = SponsorshipDeal.objects.create(event=event_b, sponsor=sponsor, owner=organizer_b)
    response = api_client(organizer_a).get(f'/api/sponsorship-deals/{deal.id}/')
    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_real_token_authentication_is_accepted(organizer_a):
    # Chemin réel du front : jeton DRF dans l'en-tête Authorization
    # (force_authenticate contournerait la configuration d'authentification).
    from rest_framework.authtoken.models import Token
    token = Token.objects.create(user=organizer_a.user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')
    assert client.get('/api/sponsors/').status_code == status.HTTP_200_OK
