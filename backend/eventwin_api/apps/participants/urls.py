from rest_framework.routers import DefaultRouter

from .quiz_views import (
    EventQuizViewSet,
    QuizQuestionViewSet,
    QuizSummaryViewSet,
)
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
router.register(r'quizzes', EventQuizViewSet, basename='quiz')
router.register(r'quiz-questions', QuizQuestionViewSet, basename='quiz-question')
router.register(r'quiz-summary', QuizSummaryViewSet, basename='quiz-summary')

urlpatterns = router.urls