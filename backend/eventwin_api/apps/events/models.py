from django.db import models

from apps.base_models import UUIDTimestampedModel


class Event(UUIDTimestampedModel):
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='events',
    )
    name = models.CharField(max_length=255)
    status = models.CharField(max_length=50, default='draft')
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    location = models.CharField(max_length=255, blank=True)
    target_budget = models.DecimalField(max_digits=12, decimal_places=2, default=0)

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
