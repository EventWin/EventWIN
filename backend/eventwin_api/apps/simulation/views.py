from rest_framework import viewsets

from apps.core.permissions import EventBoundWriteMixin, events_manageable
from apps.event_filter import EventFilterMixin

from .models import Scenario, ScenarioResult
from .serializers import ScenarioResultSerializer, ScenarioSerializer


class ScenarioViewSet(EventBoundWriteMixin, EventFilterMixin, viewsets.ModelViewSet):
    """Scénarios du jumeau numérique — bornés aux événements administrés.

    Un scénario est une donnée d'organisation (simulation, hypothèses) :
    un participant ne doit pas lire ou écrire les scénarios d'autrui.
    """

    queryset = Scenario.objects.select_related('event', 'source_scenario').all().order_by('-created_at')
    serializer_class = ScenarioSerializer

    def get_queryset(self):
        return (
            Scenario.objects
            .filter(event__in=events_manageable(self.request.user))
            .select_related('event', 'source_scenario')
            .order_by('-created_at')
        )


class ScenarioResultViewSet(EventBoundWriteMixin, viewsets.ModelViewSet):
    """Résultats de simulation — bornés aux scénarios des événements administrés."""

    queryset = ScenarioResult.objects.select_related('scenario').all().order_by('-calculated_at')
    serializer_class = ScenarioResultSerializer

    def get_queryset(self):
        return (
            ScenarioResult.objects
            .filter(scenario__event__in=events_manageable(self.request.user))
            .select_related('scenario')
            .order_by('-calculated_at')
        )
