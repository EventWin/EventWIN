from django.db import models

from apps.base_models import UUIDTimestampedModel


class Event(UUIDTimestampedModel):
    EVENT_TYPES = [
        ('conference', 'Conference'),
        ('workshop', 'Workshop'),
        ('road_trip', 'Road trip'),
        ('retreat', 'Retreat'),
        ('gala', 'Gala'),
        ('product_launch', 'Product launch'),
        ('internal_meeting', 'Internal meeting'),
        ('other', 'Other'),
    ]

    EVENT_FORMATS = [
        ('onsite', 'On-site'),
        ('hybrid', 'Hybrid'),
        ('remote', 'Remote'),
        ('mobile', 'Mobile / road-based'),
        ('multi_site', 'Multi-site'),
    ]

    AUDIENCE_TYPES = [
        ('internal', 'Internal'),
        ('external', 'External'),
        ('mixed', 'Mixed'),
    ]

    MOBILITY_LEVELS = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
    ]

    ACCESSIBILITY_LEVELS = [
        ('standard', 'Standard'),
        ('enhanced', 'Enhanced'),
        ('strict', 'Strict'),
    ]

    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='events',
    )
    name = models.CharField(max_length=255)
    event_type = models.CharField(max_length=50, choices=EVENT_TYPES, default='other')
    event_format = models.CharField(max_length=50, choices=EVENT_FORMATS, default='onsite')
    objective = models.CharField(max_length=255, blank=True)
    audience_type = models.CharField(max_length=50, choices=AUDIENCE_TYPES, default='mixed')
    mobility_level = models.CharField(max_length=50, choices=MOBILITY_LEVELS, default='medium')
    accommodation_required = models.BooleanField(default=False)
    accessibility_level = models.CharField(max_length=50, choices=ACCESSIBILITY_LEVELS, default='standard')
    route_or_logistics_notes = models.TextField(blank=True)
    status = models.CharField(max_length=50, default='draft')
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    location = models.CharField(max_length=255, blank=True)
    target_budget = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    participant_target = models.IntegerField(default=0)
    participant_expected = models.IntegerField(default=0)
    bus_standard_count = models.IntegerField(default=0)
    bus_standard_capacity = models.IntegerField(default=50)
    bus_mini_count = models.IntegerField(default=0)
    bus_mini_capacity = models.IntegerField(default=30)
    bus_vip_count = models.IntegerField(default=0)
    bus_vip_capacity = models.IntegerField(default=20)

    def __str__(self):
        return self.name


class EventScheduleItem(UUIDTimestampedModel):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='schedule_items')
    title = models.CharField(max_length=255)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    category = models.CharField(max_length=100, blank=True)
    location = models.CharField(max_length=255, blank=True)


class Resource(UUIDTimestampedModel):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='resources')
    resource_type = models.CharField(max_length=100)
    name = models.CharField(max_length=255)
    capacity = models.IntegerField(default=0)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
