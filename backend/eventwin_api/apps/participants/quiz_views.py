"""Quiz — création de questions, réponses des participants, synthèse agrégée.

Règles appliquées :
- seuls l'organisateur de l'événement (ou le super-admin) configure le quiz ;
- un participant ne répond qu'aux quiz des événements auxquels il est inscrit,
  et uniquement via **sa propre inscription** (anti-IDOR) ;
- « non répondu » (``value=null``) reste strictement distingué de « aucune
  allergie » (une réponse explicite) : l'agrégat expose les deux compteurs ;
- la collecte est minimale : la synthèse transmise à l'IA est agrégée, sans
  donnée personnelle nominative.
"""
from django.db.models import Count, Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from rest_framework.permissions import IsAuthenticated

from apps.core.permissions import (
    IsOrganizer,
    can_manage_event,
    events_manageable,
    events_visible,
    is_super_admin,
    is_organizer,
    profile_of,
)

from .models import EventParticipant, EventQuiz, QuizAnswer, QuizQuestion
from .serializers import (
    EventQuizSerializer,
    QuizAnswerSerializer,
    QuizQuestionSerializer,
)


def _registration_of(user, event):
    """Inscription du participant connecté à l'événement, ou ``None``."""
    profile = profile_of(user)
    if profile is None:
        return None
    return EventParticipant.objects.filter(event=event, participant=profile).first()


class EventQuizViewSet(viewsets.ModelViewSet):
    """Quiz d'un événement : lecture ouverte au périmètre, écriture organisateur.

    - ``GET`` : le participant voit son quiz (et l'organisateur le sien) ;
    - ``POST/PATCH/DELETE`` : organisateur de l'événement seul.
    """

    queryset = EventQuiz.objects.select_related('event').prefetch_related('questions').all()
    serializer_class = EventQuizSerializer

    def get_permissions(self):
        # L'écriture exige un organisateur ; la lecture reste ouverte au
        # périmètre (participant inscrit ou organisateur). Ce contrôle précède
        # la validation du sérialiseur : un participant reçoit 403, jamais 400.
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsOrganizer()]
        return [IsAuthenticated()]

    def get_queryset(self):
        queryset = EventQuiz.objects.select_related('event').prefetch_related(
            'questions'
        ).all()
        user = self.request.user
        if is_super_admin(user):
            return queryset
        # Visible si l'utilisateur administre l'événement ou y est inscrit.
        managed = events_manageable(user)
        visible = events_visible(user)
        profile = profile_of(user)
        mine = Q(event__event_participants__participant=profile) if profile else Q(pk__isnull=True)
        return queryset.filter(
            Q(event__in=managed) | Q(event__in=visible) | mine
        ).distinct()

    def perform_create(self, serializer):
        event = serializer.validated_data['event']
        if not can_manage_event(self.request.user, event):
            raise PermissionDenied('Seul l’organisateur de l’événement peut créer un quiz.')
        # Un quiz par événement : la contrainte OneToOne protège la base.
        serializer.save()

    def perform_update(self, serializer):
        event = serializer.instance.event
        if not can_manage_event(self.request.user, event):
            raise PermissionDenied('Seul l’organisateur de l’événement peut modifier ce quiz.')
        serializer.save()

    def perform_destroy(self, instance):
        if not can_manage_event(self.request.user, instance.event):
            raise PermissionDenied('Seul l’organisateur de l’événement peut supprimer ce quiz.')
        instance.delete()

    # ---- Réponses (participant) ---------------------------------------------

    @action(detail=True, methods=['get', 'post'], url_path='answers')
    def answers(self, request, pk=None):
        """Mes réponses au quiz (GET) / sauvegarde partielle (POST).

        Le POST accepte une liste ``[{question, value}]`` ; ``value=null`` est
        accepté pour « je ne réponds pas », mais n'est jamais converti en
        « aucune ». La reprise d'un quiz inachevé fonctionne car les réponses
        existantes sont mises à jour par l'unicité (inscription, question).
        """
        quiz = self.get_object()
        profile = profile_of(request.user)
        if profile is None:
            raise PermissionDenied('Compte participant requis.')

        registration = _registration_of(request.user, quiz.event)
        if registration is None and not is_organizer(request.user):
            raise PermissionDenied('Inscription requise pour répondre à ce quiz.')

        if request.method == 'GET':
            qs = QuizAnswer.objects.filter(registration=registration).select_related('question')
            return Response(QuizAnswerSerializer(qs, many=True).data)

        # POST : sauvegarde des réponses (reprise incluse).
        payload = request.data if isinstance(request.data, list) else request.data.get('answers', [])
        valid_question_ids = set(quiz.questions.values_list('id', flat=True))
        saved = []
        for entry in payload:
            question_id = str(entry.get('question'))
            if question_id not in {str(q) for q in valid_question_ids}:
                return Response(
                    {'error': f'Question {question_id} n’appartient pas à ce quiz.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            answer, _ = QuizAnswer.objects.get_or_create(
                registration=registration, question_id=question_id
            )
            # ``value`` conservé tel quel (null = non répondu).
            answer.value = entry.get('value')
            answer.save(update_fields=['value'])
            saved.append(answer)
        return Response(QuizAnswerSerializer(saved, many=True).data)


class QuizQuestionViewSet(viewsets.ModelViewSet):
    """Questions d'un quiz : écrites par l'organisateur de l'événement seul."""

    queryset = QuizQuestion.objects.select_related('quiz', 'quiz__event').all().order_by('position')
    serializer_class = QuizQuestionSerializer

    def get_permissions(self):
        # Écriture réservée aux organisateurs ; lecture au périmètre. Le
        # contrôle précède la validation (403, jamais 400, pour un participant).
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsOrganizer()]
        return [IsAuthenticated()]

    def get_queryset(self):
        queryset = QuizQuestion.objects.select_related('quiz', 'quiz__event').all().order_by('position')
        user = self.request.user
        if is_super_admin(user):
            return queryset
        return queryset.filter(quiz__event__in=events_manageable(user))

    def perform_create(self, serializer):
        quiz = serializer.validated_data['quiz']
        if not can_manage_event(self.request.user, quiz.event):
            raise PermissionDenied('Seul l’organisateur de l’événement peut ajouter des questions.')
        serializer.save()

    def perform_update(self, serializer):
        quiz = serializer.instance.quiz
        if not can_manage_event(self.request.user, quiz.event):
            raise PermissionDenied('Seul l’organisateur de l’événement peut modifier cette question.')
        serializer.save()

    def perform_destroy(self, instance):
        if not can_manage_event(self.request.user, instance.quiz.event):
            raise PermissionDenied('Seul l’organisateur de l’événement peut supprimer cette question.')
        instance.delete()


class QuizSummaryViewSet(viewsets.ViewSet):
    """Synthèse agrégée pour l'organisateur : GET /api/quiz-summary/?event=<uuid>.

    Par question : nombre de répondants, répartition des choix, et — pour les
    questions « aucune allergie » — le nombre explicite d'« aucune ». Les
    compteurs « non répondu » et « aucune » sont séparés : on n'aplanit jamais
    l'absence de réponse sur « aucune ».
    """

    def list(self, request):
        event_id = request.query_params.get('event')
        from apps.events.models import Event

        try:
            event = Event.objects.get(pk=event_id)
        except Exception:
            return Response({'error': 'Événement introuvable.'}, status=status.HTTP_400_BAD_REQUEST)

        if not can_manage_event(request.user, event):
            raise PermissionDenied('Accès réservé à l’organisateur de l’événement.')

        registrations = EventParticipant.objects.filter(event=event)
        total_registered = registrations.count()
        questions = QuizQuestion.objects.filter(quiz__event=event).order_by('position')

        summary = []
        for question in questions:
            answers = QuizAnswer.objects.filter(question=question, registration__event=event)
            answered = answers.exclude(value__isnull=True)
            answered_count = answered.count()
            # « Non répondu » = inscrits n'ayant **pas** de réponse effective.
            # Couvre à la fois l'absence de ligne et la ligne ``value=null`` :
            # un inscrit sans aucune ligne compte comme non répondu.
            unanswered = max(total_registered - answered_count, 0)

            entry = {
                'question': str(question.id),
                'prompt': question.prompt,
                'kind': question.kind,
                'total_registered': total_registered,
                'answered_count': answered_count,
                # Distinction stricte : non répondu ≠ « aucune ».
                'unanswered_count': unanswered,
            }

            if question.kind in ('single', 'multiple'):
                distribution = {}
                for answer in answered:
                    values = answer.value if isinstance(answer.value, list) else [answer.value]
                    for value in values:
                        distribution[str(value)] = distribution.get(str(value), 0) + 1
                entry['distribution'] = distribution
            elif question.kind == 'boolean':
                yes = answered.filter(value__in=[True, 'true', 'oui', 'Oui', 'yes']).count()
                no = answered.filter(value__in=[False, 'false', 'non', 'Non', 'no']).count()
                entry['yes_count'] = yes
                entry['no_count'] = no
            elif question.kind == 'text':
                entry['free_text_count'] = answered.count()

            summary.append(entry)

        return Response({
            'event': str(event.id),
            'total_registered': total_registered,
            'questions': summary,
        })
