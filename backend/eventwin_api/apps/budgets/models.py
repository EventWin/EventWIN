from django.db import models

from apps.base_models import UUIDTimestampedModel


class Budget(UUIDTimestampedModel):
    event = models.ForeignKey('events.Event', on_delete=models.CASCADE, related_name='budgets')
    name = models.CharField(max_length=255)
    total_budget = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=10, default='EUR')

    def __str__(self):
        return self.name


class BudgetCategory(UUIDTimestampedModel):
    budget = models.ForeignKey(Budget, on_delete=models.CASCADE, related_name='categories')
    name = models.CharField(max_length=255)
    planned_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    actual_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)


class CostItem(UUIDTimestampedModel):
    budget_category = models.ForeignKey(BudgetCategory, on_delete=models.CASCADE, related_name='cost_items')
    name = models.CharField(max_length=255)
    planned_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    actual_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    booked_at = models.DateField(null=True, blank=True)
