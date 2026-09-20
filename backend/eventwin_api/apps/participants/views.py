from rest_framework import viewsets

from .models import EventParticipant, Participant, ParticipantConstraint, ParticipantPreference
from .serializers import (
    EventParticipantSerializer,
    ParticipantConstraintSerializer,
    ParticipantPreferenceSerializer,
    ParticipantSerializer,
)


class ParticipantViewSet(viewsets.ModelViewSet):
    queryset = Participant.objects.select_related('organization').all().order_by('full_name')
    serializer_class = ParticipantSerializer


class EventParticipantViewSet(viewsets.ModelViewSet):
    queryset = EventParticipant.objects.select_related('event', 'participant').all().order_by('-created_at')
    serializer_class = EventParticipantSerializer


class ParticipantPreferenceViewSet(viewsets.ModelViewSet):
    queryset = ParticipantPreference.objects.select_related('participant').all().order_by('preference_type')
    serializer_class = ParticipantPreferenceSerializer


class ParticipantConstraintViewSet(viewsets.ModelViewSet):
    queryset = ParticipantConstraint.objects.select_related('participant').all().order_by('constraint_type')
    serializer_class = ParticipantConstraintSerializer