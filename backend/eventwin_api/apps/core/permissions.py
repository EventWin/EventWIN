"""Rôles, portées et permissions RBAC — source unique de vérité.

Règles appliquées à **chaque** endpoint sensible (rôle + propriété) :

- super-administrateur : accès complet (organisateurs, tous événements,
  participants globaux, statistiques) ;
- organisateur : uniquement les événements qu'il possède ou ceux de son
  organisation, et leurs données (budgets, ressources, inscriptions, quiz) ;
- participant : son propre compte, ses inscriptions, ses réponses de quiz, et
  la consultation des événements publiés.

Le rôle est **toujours** lu côté serveur (profil ``Participant`` ou
``is_superuser``) : jamais reçu du client. Le masquage d'interface n'est pas
une protection : ces permissions sont la seule barrière.
"""
from django.db.models import Q
from rest_framework.permissions import BasePermission

from apps.participants.models import Participant


# --- Lecture du rôle ---------------------------------------------------------

def profile_of(user):
    """Profil ``Participant`` de l'utilisateur, ou ``None``."""
    if not user or not user.is_authenticated:
        return None
    return Participant.objects.filter(user=user).first()


def is_super_admin(user) -> bool:
    """Super-administrateur Django (seule porte d'entrée du rôle admin)."""
    return bool(user and user.is_authenticated and user.is_superuser)


def is_organizer(user) -> bool:
    """Organisateur actif (ou super-administrateur, qui englobe tous les rôles)."""
    if is_super_admin(user):
        return True
    profile = profile_of(user)
    return bool(profile and profile.is_organizer)


# --- Portée des événements ---------------------------------------------------

def events_manageable(user):
    """Événements que l'utilisateur **administre** (écriture)."""
    from apps.events.models import Event

    if is_super_admin(user):
        return Event.objects.all()
    profile = profile_of(user)
    if profile and profile.is_organizer:
        owned = Q(owner=user)
        if profile.organization_id:
            owned |= Q(organization_id=profile.organization_id)
        return Event.objects.filter(owned)
    return Event.objects.none()


def events_visible(user):
    """Événements **consultables** (lecture)."""
    from apps.events.models import Event

    if is_super_admin(user):
        return Event.objects.all()
    profile = profile_of(user)
    if profile and profile.is_organizer:
        return Event.objects.filter(
            Q(pk__in=events_manageable(user).values('pk')) | Q(status='published')
        ).distinct()
    if profile:
        # Participant : événements publiés + ceux auxquels il est inscrit
        # (pour retrouver ses inscriptions même si l'événement est passé).
        return Event.objects.filter(
            Q(status='published') | Q(event_participants__participant=profile)
        ).distinct()
    return Event.objects.filter(status='published')


def can_manage_event(user, event) -> bool:
    """Contrôle de propriété **objet par objet** (anti-IDOR)."""
    if is_super_admin(user):
        return True
    return events_manageable(user).filter(pk=event.pk).exists()


# --- Permissions DRF ---------------------------------------------------------

class IsSuperAdmin(BasePermission):
    """Réservé au super-administrateur Django."""

    message = 'Accès réservé au super-administrateur.'

    def has_permission(self, request, view):
        return is_super_admin(request.user)


class IsOrganizer(BasePermission):
    """Organisateur actif (ou super-administrateur)."""

    message = 'Accès réservé aux organisateurs.'

    def has_permission(self, request, view):
        return is_organizer(request.user)


class IsSuperAdminOrReadOnly(IsSuperAdmin):
    """Lecture ouverte aux utilisateurs authentifiés, écriture admin seule."""

    def has_permission(self, request, view):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return bool(request.user and request.user.is_authenticated)
        return super().has_permission(request, view)


class IsEventManager(BasePermission):
    """Écriture (update/destroy) sur un événement : propriétaire ou admin."""

    message = 'Vous ne pouvez modifier que vos propres événements.'

    def has_object_permission(self, request, view, obj):
        return can_manage_event(request.user, obj)


class IsSelfOrManager(BasePermission):
    """Objet accessible à son propriétaire (participant connecté) ou à un manager.

    Attend un objet avec un attribut ``participant`` (ou un ``Participant``).
    """

    message = 'Accès refusé : cette donnée ne vous appartient pas.'

    def has_object_permission(self, request, view, obj):
        if is_super_admin(request.user):
            return True
        if is_organizer(request.user):
            # Un organisateur ne touche qu'aux participants de son périmètre.
            profile = profile_of(request.user)
            target = getattr(obj, 'participant', obj)
            if target is None:
                return False
            if target.pk == (profile.pk if profile else None):
                return True
            if profile and profile.organization_id and target.organization_id == profile.organization_id:
                return True
            # Un organisateur administre aussi les inscriptions à SES événements.
            event = getattr(obj, 'event', None)
            if event is not None and can_manage_event(request.user, event):
                return True
            return False
        profile = profile_of(request.user)
        target = getattr(obj, 'participant', obj)
        return bool(profile and target and profile.pk == target.pk)


class EventScopedQuerysetMixin:
    """Restreint un queryset porté sur un événement à la portée de l'utilisateur.

    Attributs de classe :
      - ``event_field`` : nom du champ ForeignKey vers l'événement.
    """

    event_field = 'event'

    def get_queryset(self):
        queryset = super().get_queryset()
        visible = events_visible(self.request.user)
        return queryset.filter(**{f'{self.event_field}__in': visible})
