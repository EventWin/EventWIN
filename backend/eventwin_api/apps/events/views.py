from rest_framework import viewsets

from .models import Event, EventScheduleItem, Resource
from .serializers import EventSerializer, EventScheduleItemSerializer, ResourceSerializer


class EventViewSet(viewsets.ModelViewSet):
    queryset = Event.objects.select_related('organization').all().order_by('-created_at')
    serializer_class = EventSerializer


class EventScheduleItemViewSet(viewsets.ModelViewSet):
    queryset = EventScheduleItem.objects.select_related('event').all().order_by('starts_at')
    serializer_class = EventScheduleItemSerializer


class ResourceViewSet(viewsets.ModelViewSet):
    queryset = Resource.objects.select_related('event').all().order_by('name')
    serializer_class = ResourceSerializer