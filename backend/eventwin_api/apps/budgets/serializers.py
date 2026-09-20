from rest_framework import serializers

from .models import Budget, BudgetCategory, CostItem


class BudgetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Budget
        fields = ['id', 'event', 'name', 'total_budget', 'currency', 'created_at']
        read_only_fields = ['id', 'created_at']


class BudgetCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = BudgetCategory
        fields = ['id', 'budget', 'name', 'planned_amount', 'actual_amount', 'created_at']
        read_only_fields = ['id', 'created_at']


class CostItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = CostItem
        fields = ['id', 'budget_category', 'name', 'planned_cost', 'actual_cost', 'booked_at', 'created_at']
        read_only_fields = ['id', 'created_at']