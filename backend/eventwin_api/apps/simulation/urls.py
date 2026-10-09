from rest_framework.routers import DefaultRouter

from .views import ScenarioResultViewSet, ScenarioViewSet


router = DefaultRouter()
router.register(r'scenarios', ScenarioViewSet, basename='scenario')
router.register(r'scenario-results', ScenarioResultViewSet, basename='scenario-result')

urlpatterns = router.urls