from rest_framework import serializers

from .models import EventParticipant, Participant, ParticipantConstraint, ParticipantPreference


class ParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Participant
        fields = ['id', 'organization', 'full_name', 'email', 'role', 'status', 'created_at']
        read_only_fields = ['id', 'created_at']


class EventParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventParticipant
        fields = ['id', 'event', 'participant', 'attendance_status', 'satisfaction_score', 'created_at']
        read_only_fields = ['id', 'created_at']


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