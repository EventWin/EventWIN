import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.events.models import Event
from apps.organizations.models import Organization
from apps.participants.models import Participant, UserRole

User = get_user_model()


@pytest.fixture
def org_a(db):
    return Organization.objects.create(name='Org Alpha', legal_name='Org Alpha SAS')


@pytest.fixture
def org_b(db):
    return Organization.objects.create(name='Org Beta', legal_name='Org Beta SAS')


def _participant(username, email, role, organization=None, is_superuser=False):
    p = Participant.objects.create_user(
        username=username,
        email=email,
        password='pass1234',
        is_superuser=is_superuser,
        is_staff=(role in [UserRole.ORGANIZER, UserRole.ADMIN] or is_superuser),
        role=role,
        organization=organization,
        status='active'
    )
    return p


@pytest.fixture
def organizer_a(org_a):
    return _participant('orga-a', 'orga-a@test.local', 'organizer', org_a)


@pytest.fixture
def organizer_b(org_b):
    return _participant('orga-b', 'orga-b@test.local', 'organizer', org_b)


@pytest.fixture
def organizer_no_org(db):
    return _participant('orga-none', 'orga-none@test.local', 'organizer', None)


@pytest.fixture
def attendee(org_a):
    return _participant('guest', 'guest@test.local', 'participant', org_a)


@pytest.fixture
def admin_user(org_a):
    return _participant('admin', 'admin@test.local', 'admin', org_a, is_superuser=True)


@pytest.fixture
def event_a(org_a):
    return Event.objects.create(
        organization=org_a,
        name='Sommet Alpha',
        status='confirmed',
        start_date='2026-06-01',
        end_date='2026-06-03',
        target_budget='20000.00',
        participant_expected=200,
    )


@pytest.fixture
def event_b(org_b):
    return Event.objects.create(
        organization=org_b,
        name='Forum Beta',
        status='confirmed',
        start_date='2026-09-01',
        end_date='2026-09-02',
        target_budget='8000.00',
        participant_expected=80,
    )


def api_client(participant=None):
    client = APIClient()
    if participant is not None:
        client.credentials(HTTP_X_PARTICIPANT_ID=str(participant.id))
    return client
