from rest_framework.routers import DefaultRouter

from .views import (
    TransportAvailabilitySnapshotViewSet,
    TransportCatalogOptionViewSet,
    TransportEvaluationViewSet,
)


router = DefaultRouter()
router.register(r'transport-catalog-options', TransportCatalogOptionViewSet, basename='transport-catalog-option')
router.register(r'transport-availability-snapshots', TransportAvailabilitySnapshotViewSet, basename='transport-availability-snapshot')
router.register(r'transport-evaluations', TransportEvaluationViewSet, basename='transport-evaluation')

urlpatterns = router.urls
