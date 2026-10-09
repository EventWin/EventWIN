from rest_framework import viewsets

from .models import Budget, BudgetCategory, CostItem
from .serializers import BudgetCategorySerializer, BudgetSerializer, CostItemSerializer


class BudgetViewSet(viewsets.ModelViewSet):
    queryset = Budget.objects.select_related('event').all().order_by('-created_at')
    serializer_class = BudgetSerializer


class BudgetCategoryViewSet(viewsets.ModelViewSet):
    queryset = BudgetCategory.objects.select_related('budget').all().order_by('name')
    serializer_class = BudgetCategorySerializer


class CostItemViewSet(viewsets.ModelViewSet):
    queryset = CostItem.objects.select_related('budget_category').all().order_by('name')
    serializer_class = CostItemSerializer