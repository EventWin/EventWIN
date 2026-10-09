from rest_framework.routers import DefaultRouter

from .views import (
    EventParticipantViewSet,
    ParticipantConstraintViewSet,
    ParticipantPreferenceViewSet,
    ParticipantViewSet,
)


router = DefaultRouter()
router.register(r'participants', ParticipantViewSet, basename='participant')
router.register(r'event-participants', EventParticipantViewSet, basename='event-participant')
router.register(r'participant-preferences', ParticipantPreferenceViewSet, basename='participant-preference')
router.register(r'participant-constraints', ParticipantConstraintViewSet, basename='participant-constraint')

urlpatterns = router.urls