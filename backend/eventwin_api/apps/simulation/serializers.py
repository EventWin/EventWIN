from rest_framework import serializers

from .models import Scenario, ScenarioResult


class ScenarioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Scenario
        fields = ['id', 'event', 'name', 'status', 'source_scenario', 'description', 'created_at']
        read_only_fields = ['id', 'created_at']


class ScenarioResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScenarioResult
        fields = ['id', 'scenario', 'predicted_cost', 'predicted_satisfaction', 'notes', 'calculated_at', 'created_at']
        read_only_fields = ['id', 'calculated_at', 'created_at']