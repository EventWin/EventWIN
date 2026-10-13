from django.db import models

from apps.base_models import UUIDTimestampedModel


class TransportCatalogOption(UUIDTimestampedModel):
    MODE_CHOICES = [
        ('car', 'Car'),
        ('van', 'Van'),
        ('minibus', 'Minibus'),
        ('coach', 'Coach'),
        ('train', 'Train'),
        ('scheduled_bus', 'Scheduled bus'),
        ('flight', 'Flight'),
        ('ferry', 'Ferry'),
    ]

    name = models.CharField(max_length=255)
    mode = models.CharField(max_length=50, choices=MODE_CHOICES)
    provider_name = models.CharField(max_length=255, blank=True)
    operator_code = models.CharField(max_length=100, blank=True)
    seated_capacity = models.IntegerField(default=0)
    standing_capacity = models.IntegerField(default=0)
    wheelchair_spaces = models.IntegerField(default=0)
    luggage_volume_litres = models.IntegerField(default=0)
    accessible = models.BooleanField(default=False)
    co2e_g_per_km_estimate = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    def __str__(self):
        return self.name


class TransportAvailabilitySnapshot(UUIDTimestampedModel):
    CAPACITY_STATUS_CHOICES = [
        ('unverified', 'Unverified'),
        ('estimated', 'Estimated'),
        ('reserved', 'Reserved'),
        ('confirmed', 'Confirmed'),
    ]

    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='transport_snapshots',
    )
    catalog_option = models.ForeignKey(
        TransportCatalogOption,
        on_delete=models.CASCADE,
        related_name='availability_snapshots',
    )
    origin_label = models.CharField(max_length=255)
    destination_label = models.CharField(max_length=255)
    departure_at = models.DateTimeField(null=True, blank=True)
    arrival_at = models.DateTimeField(null=True, blank=True)
    available_seats = models.IntegerField(null=True, blank=True)
    occupancy_percentage = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    capacity_status = models.CharField(max_length=20, choices=CAPACITY_STATUS_CHOICES, default='unverified')
    capacity_confidence = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    reservation_required = models.BooleanField(default=False)
    total_cost_estimate = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=10, default='EUR')
    source_provider = models.CharField(max_length=255, blank=True)
    source_record_id = models.CharField(max_length=255, blank=True)
    valid_until = models.DateTimeField(null=True, blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)


class TransportEvaluation(UUIDTimestampedModel):
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='transport_evaluations',
    )
    snapshot = models.ForeignKey(
        TransportAvailabilitySnapshot,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='evaluations',
    )
    option_label = models.CharField(max_length=255)
    feasible = models.BooleanField(default=False)
    hard_constraint_failures = models.JSONField(default=list, blank=True)
    estimated_total_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    estimated_arrival_reliability = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    score = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    explanation = models.TextField(blank=True)
    evaluated_at = models.DateTimeField(auto_now_add=True)
