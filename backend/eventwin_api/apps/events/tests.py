from django.test import TestCase

from apps.events.models import Event
from apps.events.serializers import EventSerializer
from apps.organizations.models import Organization


class EventSerializerBudgetFieldsTests(TestCase):
    def test_serializer_exposes_only_single_total_budget_field(self):
        organization = Organization.objects.create(name='Test Org', legal_name='Test Org Ltd')
        Event.objects.create(
            organization=organization,
            name='Test Event',
            target_budget=1500,
        )

        serializer = EventSerializer()

        self.assertIn('target_budget', serializer.fields)
        self.assertNotIn('budget_venue', serializer.fields)
        self.assertNotIn('budget_transport', serializer.fields)
        self.assertNotIn('budget_catering', serializer.fields)
        self.assertNotIn('budget_accommodation', serializer.fields)
        self.assertNotIn('budget_staffing', serializer.fields)
        self.assertNotIn('budget_marketing', serializer.fields)
        self.assertNotIn('budget_contingency', serializer.fields)
