from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.permissions import BasePermission

from apps.participants.models import Participant

ORGANIZER_ROLES = ('organizer', 'admin')


def get_acting_participant(request):
    """Resolve the acting Participant from the provisional X-Participant-Id header."""
    raw = request.headers.get('X-Participant-Id') or request.META.get('HTTP_X_PARTICIPANT_ID')
    if not raw:
        return None
    try:
        return (
            Participant.objects
            .select_related('organization')
            .filter(pk=raw)
            .first()
        )
    except (ValueError, TypeError, DjangoValidationError):
        return None


def is_admin(participant):
    if participant is None:
        return False
    if participant.role == 'admin':
        return True
    user = getattr(participant, 'user', None)
    return bool(user is not None and user.is_superuser)


def is_organizer_or_admin(participant):
    if participant is None:
        return False
    if participant.role in ORGANIZER_ROLES:
        return True
    return is_admin(participant)


class IsOrganizerOrAdmin(BasePermission):
    message = 'Accès réservé aux organisateurs et administrateurs.'

    def has_permission(self, request, view):
        return is_organizer_or_admin(get_acting_participant(request))


class OrganizationScopedMixin:
    """Restrict querysets to the acting organizer's organization. Admins see everything."""

    organization_lookup = 'organization'

    def get_queryset(self):
        queryset = super().get_queryset()
        actor = get_acting_participant(self.request)
        if actor is None:
            return queryset.none()
        if is_admin(actor):
            return queryset
        if not actor.organization_id:
            return queryset.none()
        return queryset.filter(**{self.organization_lookup: actor.organization_id}).distinct()

    def organization_for_create(self, extra_organization=None):
        actor = get_acting_participant(self.request)
        if actor is None:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(detail=IsOrganizerOrAdmin.message)
        if is_admin(actor):
            org = extra_organization or actor.organization
            if org is None:
                from rest_framework.exceptions import ValidationError
                raise ValidationError({
                    'organization': "L'organisation est obligatoire pour un administrateur sans organisation rattachée.",
                })
            return org
        if not actor.organization_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({
                'organization': "Votre profil organisateur n'est rattaché à aucune organisation. Impossible de créer cette ressource.",
            })
        return actor.organization


def _scoped_object_or_404(request, model, pk, label, org_lookup):
    """Retourne l'objet demandé s'il appartient à l'organisation de l'acteur (admin : tout)."""
    from django.core.exceptions import ValidationError as DjangoValidationError
    from rest_framework.exceptions import NotFound, ValidationError

    if not pk:
        raise ValidationError({label: f'Le paramètre « {label} » est obligatoire.'})
    try:
        obj = model.objects.filter(pk=pk).first()
    except (DjangoValidationError, ValueError, TypeError):
        raise ValidationError({label: 'Identifiant invalide.'})
    actor = get_acting_participant(request)
    if obj is None:
        raise NotFound(f'{label} introuvable.')
    if not is_admin(actor):
        org_id = obj
        for part in org_lookup.split('__'):
            org_id = getattr(org_id, part)
        if not actor.organization_id or org_id != actor.organization_id:
            raise NotFound(f'{label} introuvable.')
    return obj


def scoped_event_or_error(request, event_id):
    from apps.events.models import Event

    return _scoped_object_or_404(request, Event, event_id, 'event', 'organization_id')


def scoped_scenario_or_error(request, scenario_id):
    from apps.simulation.models import Scenario

    return _scoped_object_or_404(request, Scenario, scenario_id, 'scenario', 'event__organization_id')
