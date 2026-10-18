from rest_framework import serializers

from .models import EventParticipant, Participant, ParticipantConstraint, ParticipantPreference


class ParticipantSerializer(serializers.ModelSerializer):
    first_name = serializers.SerializerMethodField()
    last_name = serializers.SerializerMethodField()
    full_name = serializers.SerializerMethodField()
    email = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()
    preferences = serializers.SerializerMethodField()
    constraints = serializers.SerializerMethodField()
    
    class Meta:
        model = Participant
        fields = ['id', 'organization', 'organization_name', 'first_name', 'last_name', 'full_name', 'email', 'role', 'status', 'phone', 'photo', 'created_at', 'preferences', 'constraints']
        read_only_fields = ['id', 'created_at']
        
    def get_first_name(self, obj):
        return obj.user.first_name if obj.user else ''

    def get_last_name(self, obj):
        return obj.user.last_name if obj.user else ''

    def get_full_name(self, obj):
        if not obj.user:
            return 'Inconnu'
        full = f"{obj.user.first_name} {obj.user.last_name}".strip()
        return full if full else obj.user.username

    def get_organization_name(self, obj):
        return obj.organization.name if obj.organization else ''
        
    def get_email(self, obj):
        return obj.user.email if obj.user else ''
        
    def get_preferences(self, obj):
        return [{'id': p.id, 'type': p.preference_type, 'value': p.value} for p in obj.preferences.all()]

    def get_constraints(self, obj):
        return [{'id': c.id, 'type': c.constraint_type, 'value': c.value, 'is_hard': c.is_hard_constraint} for c in obj.constraints.all()]


class EventParticipantSerializer(serializers.ModelSerializer):
    event_name = serializers.CharField(source='event.name', read_only=True)
    event_location = serializers.CharField(source='event.location', read_only=True)
    event_start_date = serializers.DateField(source='event.start_date', read_only=True)
    event_end_date = serializers.DateField(source='event.end_date', read_only=True)

    class Meta:
        model = EventParticipant
        fields = [
            'id', 'event', 'participant', 'attendance_status', 'satisfaction_score',
            'event_name', 'event_location', 'event_start_date', 'event_end_date', 'created_at'
        ]
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