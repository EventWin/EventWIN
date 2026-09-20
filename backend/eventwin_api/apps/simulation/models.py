from django.db import models

from apps.base_models import UUIDTimestampedModel


class Scenario(UUIDTimestampedModel):
    event = models.ForeignKey('events.Event', on_delete=models.CASCADE, related_name='scenarios')
    name = models.CharField(max_length=255)
    status = models.CharField(max_length=50, default='draft')
    source_scenario = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='derived_scenarios',
    )
    description = models.TextField(blank=True)

    def __str__(self):
        return self.name


class ScenarioResult(UUIDTimestampedModel):
    scenario = models.ForeignKey(Scenario, on_delete=models.CASCADE, related_name='results')
    predicted_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    predicted_satisfaction = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    notes = models.TextField(blank=True)
    calculated_at = models.DateTimeField(auto_now_add=True)
