from rest_framework import serializers

from .models import Event, EventScheduleItem, Resource


class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = ['id', 'organization', 'name', 'status', 'start_date', 'end_date', 'location', 'target_budget', 'created_at']
        read_only_fields = ['id', 'created_at']


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