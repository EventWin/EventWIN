from rest_framework import serializers

from .models import (
    EventParticipant,
    EventQuiz,
    OrganizerInvitation,
    Participant,
    ParticipantConstraint,
    ParticipantPreference,
    QuizAnswer,
    QuizQuestion,
)


class ParticipantSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    email = serializers.SerializerMethodField()
    preferences = serializers.SerializerMethodField()
    constraints = serializers.SerializerMethodField()
    
    class Meta:
        model = Participant
        fields = ['id', 'organization', 'full_name', 'email', 'role', 'status', 'created_at', 'preferences', 'constraints']
        read_only_fields = ['id', 'created_at']
        
    def get_full_name(self, obj):
        return obj.user.username if obj.user else 'Inconnu'
        
    def get_email(self, obj):
        return obj.user.email if obj.user else ''
        
    def get_preferences(self, obj):
        return [{'id': p.id, 'type': p.preference_type, 'value': p.value} for p in obj.preferences.all()]

    def get_constraints(self, obj):
        return [{'id': c.id, 'type': c.constraint_type, 'value': c.value, 'is_hard': c.is_hard_constraint} for c in obj.constraints.all()]


class EventParticipantSerializer(serializers.ModelSerializer):
    participant_name = serializers.SerializerMethodField()
    event_name = serializers.SerializerMethodField()

    class Meta:
        model = EventParticipant
        fields = ['id', 'event', 'event_name', 'participant', 'participant_name',
                  'attendance_status', 'satisfaction_score', 'created_at']
        read_only_fields = ['id', 'created_at']

    def get_participant_name(self, obj):
        return obj.participant.user.username if obj.participant and obj.participant.user else ''

    def get_event_name(self, obj):
        return obj.event.name if obj.event else ''


class ParticipantPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ParticipantPreference
        fields = ['id', 'participant', 'preference_type', 'value', 'weight', 'created_at']
        read_only_fields = ['id', 'created_at']


class ParticipantConstraintSerializer(serializers.ModelSerializer):
    class Meta:
        model = ParticipantConstraint
        fields = ['id', 'participant', 'constraint_type', 'value', 'is_hard_constraint', 'created_at']
        read_only_fields = ['id', 'created_at']


class OrganizerInvitationSerializer(serializers.ModelSerializer):
    """Invitation organisateur : expose le **statut calculé**, jamais le jeton."""

    status = serializers.SerializerMethodField()
    organizer_name = serializers.SerializerMethodField()

    class Meta:
        model = OrganizerInvitation
        fields = [
            'id', 'email', 'full_name', 'user', 'organizer_name', 'status',
            'created_by', 'organization', 'expires_at', 'used_at', 'revoked_at',
            'email_sent', 'email_error', 'last_sent_at', 'created_at',
        ]
        read_only_fields = fields

    def get_status(self, obj):
        return obj.status()

    def get_organizer_name(self, obj):
        return obj.user.username if obj.user else ''


# --- Quiz --------------------------------------------------------------------


class QuizQuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizQuestion
        fields = ['id', 'prompt', 'kind', 'options', 'is_required', 'position']
        read_only_fields = ['id']


class EventQuizSerializer(serializers.ModelSerializer):
    """Quiz d'un événement, avec ses questions triées."""

    questions = QuizQuestionSerializer(many=True, read_only=True)
    event_name = serializers.CharField(source='event.name', read_only=True)

    class Meta:
        model = EventQuiz
        fields = ['id', 'event', 'event_name', 'title', 'description',
                  'is_active', 'questions', 'created_at']
        read_only_fields = ['id', 'created_at']


class QuizAnswerSerializer(serializers.ModelSerializer):
    """Réponse : ``value=null`` signifie « non répondu », jamais « aucune »."""

    question_kind = serializers.CharField(source='question.kind', read_only=True)
    question_prompt = serializers.CharField(source='question.prompt', read_only=True)
    is_answered = serializers.BooleanField(read_only=True)

    class Meta:
        model = QuizAnswer
        fields = ['id', 'registration', 'question', 'question_kind',
                  'question_prompt', 'value', 'is_answered', 'created_at']
        read_only_fields = ['id', 'created_at', 'is_answered']