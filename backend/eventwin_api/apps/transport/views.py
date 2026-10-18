from rest_framework import viewsets

from apps.core.permissions import IsSuperAdminOrReadOnly, events_manageable

from .models import TransportAvailabilitySnapshot, TransportCatalogOption, TransportEvaluation
from .serializers import (
    TransportAvailabilitySnapshotSerializer,
    TransportCatalogOptionSerializer,
    TransportEvaluationSerializer,
)


class TransportCatalogOptionViewSet(viewsets.ModelViewSet):
    """Catalogue transport (données de référence) : lecture auth, écriture admin."""

    queryset = TransportCatalogOption.objects.all().order_by('mode', 'name')
    serializer_class = TransportCatalogOptionSerializer
    permission_classes = [IsSuperAdminOrReadOnly]


class TransportAvailabilitySnapshotViewSet(viewsets.ModelViewSet):
    """Disponibilités transport — bornées aux événements administrés."""

    queryset = (
        TransportAvailabilitySnapshot.objects
        .select_related('event', 'catalog_option')
        .all()
        .order_by('-created_at')
    )
    serializer_class = TransportAvailabilitySnapshotSerializer

    def get_queryset(self):
        return (
            TransportAvailabilitySnapshot.objects
            .filter(event__in=events_manageable(self.request.user))
            .select_related('event', 'catalog_option')
            .order_by('-created_at')
        )


class TransportEvaluationViewSet(viewsets.ModelViewSet):
    """Évaluations transport — bornées aux événements administrés."""

    queryset = (
        TransportEvaluation.objects
        .select_related('event', 'snapshot')
        .all()
        .order_by('-evaluated_at')
    )
    serializer_class = TransportEvaluationSerializer

    def get_queryset(self):
        return (
            TransportEvaluation.objects
            .filter(event__in=events_manageable(self.request.user))
            .select_related('event', 'snapshot')
            .order_by('-evaluated_at')
        )
