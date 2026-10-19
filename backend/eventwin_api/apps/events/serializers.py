from rest_framework import serializers

from apps.organizations.models import Organization

from .models import Event, EventScheduleItem, Resource


class EventSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    owner_name = serializers.CharField(source='owner.username', read_only=True)
    # Compteur réellement calculé depuis les inscriptions — jamais stocké.
    registered_count = serializers.IntegerField(read_only=True)
    # ``True`` quand ``capacity`` pose une limite réelle (0 = illimité).
    has_capacity_limit = serializers.BooleanField(read_only=True)
    # L'organisation est fixée par la vue (profil de l'organisateur) : le
    # client ne peut pas rattacher un événement à une organisation étrangère.
    organization = serializers.PrimaryKeyRelatedField(
        queryset=Organization.objects.all(), required=False
    )

    class Meta:
        model = Event
        fields = [
            'id',
            'organization',
            'organization_name',
            'owner',
            'owner_name',
            'name',
            'event_type',
            'event_format',
            'objective',
            'audience_type',
            'mobility_level',
            'accommodation_required',
            'accessibility_level',
            'route_or_logistics_notes',
            'status',
            'capacity',
            'has_capacity_limit',
            'registered_count',
            'start_date',
            'end_date',
            'location',
            'target_budget',
            'participant_target',
            'participant_expected',
            'bus_standard_count',
            'bus_standard_capacity',
            'bus_mini_count',
            'bus_mini_capacity',
            'bus_vip_count',
            'bus_vip_capacity',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'owner', 'owner_name', 'registered_count']


class EventScheduleItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = EventScheduleItem
        fields = ['id', 'event', 'title', 'starts_at', 'ends_at', 'category', 'location', 'created_at']
        read_only_fields = ['id', 'created_at']


class ResourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Resource
        fields = ['id', 'event', 'resource_type', 'name', 'capacity', 'unit_cost', 'created_at']
        read_only_fields = ['id', 'created_at']