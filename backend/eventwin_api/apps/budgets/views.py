from rest_framework import viewsets

from apps.event_filter import EventFilterMixin

from .models import Budget, BudgetCategory, CostItem
from .serializers import BudgetCategorySerializer, BudgetSerializer, CostItemSerializer


class BudgetViewSet(EventFilterMixin, viewsets.ModelViewSet):
    queryset = Budget.objects.select_related('event').all().order_by('-created_at')
    serializer_class = BudgetSerializer


class BudgetCategoryViewSet(EventFilterMixin, viewsets.ModelViewSet):
    event_lookup = 'budget__event'
    queryset = BudgetCategory.objects.select_related('budget').all().order_by('name')
    serializer_class = BudgetCategorySerializer


class CostItemViewSet(viewsets.ModelViewSet):
    queryset = CostItem.objects.select_related('budget_category').all().order_by('name')
    serializer_class = CostItemSerializer