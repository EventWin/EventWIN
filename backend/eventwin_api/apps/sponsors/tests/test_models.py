from decimal import Decimal

import pytest
from django.db import IntegrityError

from apps.sponsors.models import (
    DEAL_STATUS_DEFAULT_PROBABILITY,
    Sponsor,
    SponsorshipDeal,
    SponsorshipPackage,
)
@pytest.mark.django_db(transaction=True)
def test_sponsor_inherits_uuid_and_unique_per_organization(org_a, org_b, organizer_a):
    first = Sponsor.objects.create(
        organization=org_a,
        created_by=organizer_a,
        name='Acme',
        contact_name='Ada',
        contact_email='ada@acme.test',
    )
    assert first.id
    assert first.created_at
    Sponsor.objects.create(
        organization=org_b,
        name='Acme',
        contact_name='Bob',
        contact_email='bob@acme.test',
    )
    with pytest.raises(IntegrityError):
        Sponsor.objects.create(
            organization=org_a,
            name='Acme',
            contact_name='Cara',
            contact_email='cara@acme.test',
        )


@pytest.mark.django_db(transaction=True)
def test_deal_unique_per_event_and_default_probability(org_a, event_a, organizer_a):
    sponsor = Sponsor.objects.create(
        organization=org_a,
        created_by=organizer_a,
        name='Nordic Bank',
        industry='finance',
        contact_name='Léa',
        contact_email='lea@nordic.test',
    )
    deal = SponsorshipDeal.objects.create(
        event=event_a,
        sponsor=sponsor,
        owner=organizer_a,
        cash_amount=Decimal('5000.00'),
        status='lead',
        probability_percent=DEAL_STATUS_DEFAULT_PROBABILITY['lead'],
    )
    assert deal.currency == 'EUR'
    with pytest.raises(IntegrityError):
        SponsorshipDeal.objects.create(event=event_a, sponsor=sponsor)


@pytest.mark.django_db
def test_package_slots_and_price_defaults(event_a):
    package = SponsorshipPackage.objects.create(event=event_a, name='Or', tier_rank=1)
    assert package.price == Decimal('0.00')
    assert package.slots_total == 0
    assert package.benefits == []
    assert package.active is True
