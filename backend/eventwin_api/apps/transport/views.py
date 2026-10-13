from rest_framework import viewsets

from .models import TransportAvailabilitySnapshot, TransportCatalogOption, TransportEvaluation
from .serializers import (
    TransportAvailabilitySnapshotSerializer,
    TransportCatalogOptionSerializer,
    TransportEvaluationSerializer,
)


class TransportCatalogOptionViewSet(viewsets.ModelViewSet):
    queryset = TransportCatalogOption.objects.all().order_by('mode', 'name')
    serializer_class = TransportCatalogOptionSerializer


class TransportAvailabilitySnapshotViewSet(viewsets.ModelViewSet):
    queryset = (
        TransportAvailabilitySnapshot.objects
        .select_related('event', 'catalog_option')
        .all()
        .order_by('-created_at')
    )
    serializer_class = TransportAvailabilitySnapshotSerializer


class TransportEvaluationViewSet(viewsets.ModelViewSet):
    queryset = (
        TransportEvaluation.objects
        .select_related('event', 'snapshot')
        .all()
        .order_by('-evaluated_at')
    )
    serializer_class = TransportEvaluationSerializer
