from rest_framework import viewsets

from .models import Scenario, ScenarioResult
from .serializers import ScenarioResultSerializer, ScenarioSerializer


class ScenarioViewSet(viewsets.ModelViewSet):
    queryset = Scenario.objects.select_related('event', 'source_scenario').all().order_by('-created_at')
    serializer_class = ScenarioSerializer


class ScenarioResultViewSet(viewsets.ModelViewSet):
    queryset = ScenarioResult.objects.select_related('scenario').all().order_by('-calculated_at')
    serializer_class = ScenarioResultSerializer