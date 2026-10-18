from django.db.models import Q
from rest_framework import viewsets

from apps.core.permissions import (
    EventBoundWriteMixin,
    EventScopedQuerysetMixin,
    IsEventManager,
    IsOrganizer,
    can_manage_event,
    events_manageable,
    events_visible,
    is_super_admin,
    profile_of,
)
from apps.event_filter import EventFilterMixin

from .models import Event, EventScheduleItem, Resource
from .serializers import EventSerializer, EventScheduleItemSerializer, ResourceSerializer


class EventViewSet(viewsets.ModelViewSet):
    """Événements : lecture selon publication/inscription, écriture par propriétaire.

    - super-administrateur : tous les événements ;
    - organisateur : ses événements + ceux de son organisation ;
    - participant : événements publiés (et ses propres inscriptions).
    """

    queryset = Event.objects.select_related('organization', 'owner').all().order_by('-created_at')
    serializer_class = EventSerializer

    def get_permissions(self):
        if self.action in ('update', 'partial_update', 'destroy'):
            return [IsEventManager()]
        if self.action == 'create':
            # Un organisateur crée **ses** événements : ``perform_create``
            # impose le propriétaire (utilisateur authentifié) et l'organisation
            # de son profil, jamais celle d'un tiers. Restreindre ``create`` au
            # super-admin (comme pour les organisations) interdisait aux
            # organisateurs de créer le moindre événement — le parcours central
            # de l'application était bloqué. ``IsOrganizer`` englobe le
            # super-administrateur ; un participant reste refusé.
            return [IsOrganizer()]
        return super().get_permissions()

    def get_queryset(self):
        return events_visible(self.request.user).select_related(
            'organization', 'owner'
        ).order_by('-created_at')

    def perform_create(self, serializer):
        # Le propriétaire est **toujours** l'utilisateur authentifié : aucun
        # ownership falsifiable depuis le payload. L'organisation est celle du
        # profil de l'organisateur (le super-admin peut préciser la sienne).
        user = self.request.user
        profile = profile_of(user)
        if is_super_admin(user):
            organization = serializer.validated_data.get('organization') or (
                profile.organization if profile else None
            )
        else:
            organization = profile.organization if profile else None
        serializer.save(owner=user, organization=organization)

    def perform_update(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        super().perform_destroy(instance)


class EventScheduleItemViewSet(EventBoundWriteMixin, EventFilterMixin, viewsets.ModelViewSet):
    """Planning : borné aux événements consultables par l'utilisateur."""

    queryset = EventScheduleItem.objects.select_related('event').all().order_by('starts_at')
    serializer_class = EventScheduleItemSerializer

    def get_queryset(self):
        return EventScheduleItem.objects.filter(
            event__in=events_visible(self.request.user)
        ).select_related('event').order_by('starts_at')


class ResourceViewSet(EventBoundWriteMixin, EventFilterMixin, viewsets.ModelViewSet):
    """Ressources (hors budget) : bornées aux événements consultables."""

    queryset = Resource.objects.select_related('event').all().order_by('name')
    serializer_class = ResourceSerializer

    def get_queryset(self):
        return Resource.objects.filter(
            event__in=events_visible(self.request.user)
        ).select_related('event').order_by('name')
