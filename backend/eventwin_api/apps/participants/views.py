"""Comptes, connexions et invitations — rôle et propriété vérifiés côté serveur.

Points d'attention :
- ``login`` crée une **vraie session** Django et un jeton DRF ; le rôle renvoyé
  vient du serveur (jamais du client) ;
- ``register`` force toujours ``role='participant'`` (aucune élévation
  possible depuis le client) ;
- les mots de passe ne sont **jamais** transmis en clair : invitations et
  réinitialisations passent par des jetons à usage unique (hachés en base) ;
- chaque échec d'envoi d'e-mail est enregistré et affiché.
"""
from django.conf import settings
from django.contrib.auth import login, logout
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from datetime import timedelta
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.authtoken.models import Token

from apps.core.permissions import (
    EventScopedQuerysetMixin,
    IsSelfOrManager,
    IsSuperAdmin,
    events_manageable,
    events_visible,
    is_organizer,
    is_super_admin,
    profile_of,
)
from apps.event_filter import EventFilterMixin
from . import invitations as invitation_service
from .mails import send_template_email
from .models import (
    EventParticipant,
    OrganizerInvitation,
    Participant,
    ParticipantConstraint,
    ParticipantPreference,
    PasswordResetToken,
    display_name,
    hash_token,
    split_full_name,
)
from .serializers import (
    EventParticipantSerializer,
    OrganizerInvitationSerializer,
    ParticipantConstraintSerializer,
    ParticipantPreferenceSerializer,
    ParticipantSerializer,
)


# --- Aides internes ----------------------------------------------------------

def _issue_token(user):
    """Jeton DRF unique par utilisateur (réutilisé s'il existe déjà)."""
    token, _ = Token.objects.get_or_create(user=user)
    return token.key


def _session_payload(request, user, participant):
    """Charge utile commune : identité + rôle + jeton."""
    profile = profile_of(user)
    role = 'admin' if user.is_superuser else getattr(profile, 'role', 'participant')
    return {
        'message': 'Connexion réussie',
        'token': _issue_token(user),
        'participant': {
            'id': str(profile.id) if profile else '',
            'email': user.email,
            'full_name': display_name(user),
            'role': role,
            'status': getattr(profile, 'status', 'active'),
        },
    }


def _authenticate(email, password):
    """Vérifie e-mail/mot de passe + état du profil. Retourne ``(user, erreur)``."""
    if not email or not password:
        return None, 'E-mail et mot de passe sont requis.'
    email = email.strip().lower()
    user = User.objects.filter(Q(email=email) | Q(username=email)).first()
    if not user or not user.check_password(password):
        return None, 'Identifiants incorrects.'
    profile = profile_of(user)
    if profile and profile.status == 'invited':
        return None, (
            'Ce compte attend encore l’activation : utilisez le lien reçu '
            'par e-mail pour définir votre mot de passe.'
        )
    if profile and profile.status == 'disabled':
        return None, 'Ce compte est désactivé. Contactez l’administrateur.'
    if not user.is_active:
        return None, 'Ce compte est désactivé.'
    return user, ''


class ParticipantViewSet(viewsets.ModelViewSet):
    """Comptes : RBAC sur la liste/le détail, endpoints d'authentification.

    Portée de la liste :
      - super-administrateur : tous les comptes ;
      - organisateur : comptes de son organisation + inscrits à ses événements ;
      - participant : son propre compte uniquement.
    """
    queryset = (
        Participant.objects.select_related('organization', 'user')
        .prefetch_related('preferences', 'constraints')
        .all()
        .order_by('user__username')
    )
    serializer_class = ParticipantSerializer

    def get_permissions(self):
        if self.action in (
            'login', 'register', 'accept_invitation', 'request_password_reset',
            'confirm_password_reset',
        ):
            return [AllowAny()]
        # La création directe d'un compte (hors inscription publique
        # ``register``) est réservée au super-administrateur : le rôle ne peut
        # donc jamais être choisi par un client.
        if self.action in (
            'invite_organizer', 'resend_invitation', 'revoke_invitation',
            'list_invitations', 'get_organizers', 'create',
        ):
            return [IsSuperAdmin()]
        # Lecture/écriture/suppression d'un profil : soi-même (participant) ou
        # un manager de son périmètre (organisateur/admin). Le rôle restant en
        # lecture seule, aucune élévation n'est possible.
        if self.action in ('retrieve', 'update', 'partial_update', 'destroy'):
            return [IsAuthenticated(), IsSelfOrManager()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if is_super_admin(user):
            return queryset
        profile = profile_of(user)
        if profile is None:
            return queryset.none()
        if profile.is_organizer:
            managed_events = events_manageable(user)
            return queryset.filter(
                Q(organization_id=profile.organization_id)
                | Q(event_participations__event__in=managed_events)
            ).distinct()
        return queryset.filter(pk=profile.pk)

    # --- Connexion / déconnexion ---------------------------------------------

    @action(detail=False, methods=['post'])
    def login(self, request):
        """Connexion : session Django + jeton. Le rôle vient du serveur."""
        user, error = _authenticate(
            request.data.get('email'), request.data.get('password')
        )
        if user is None:
            return Response({'error': error}, status=status.HTTP_401_UNAUTHORIZED)
        # Session réelle (persistée par le navigateur) + jeton pour l'API.
        request.session.flush()
        login(request, user)
        return Response(_session_payload(request, user, None))

    @action(detail=False, methods=['post'])
    def logout(self, request):
        """Déconnexion : détruit le jeton courant et la session."""
        if request.user and request.user.is_authenticated:
            Token.objects.filter(user=request.user).delete()
            logout(request)
        return Response({'message': 'Déconnecté'})

    @action(detail=False, methods=['get'])
    def me(self, request):
        """Identité du compte connecté (persistance après actualisation)."""
        profile = profile_of(request.user)
        if profile is None:
            role = 'admin' if request.user.is_superuser else 'participant'
            return Response({
                'id': '',
                'email': request.user.email,
                'full_name': display_name(request.user),
                'role': role,
                'status': 'active',
            })
        return Response(ParticipantSerializer(profile).data)

    # --- Inscription participant ---------------------------------------------

    @action(detail=False, methods=['post'])
    def register(self, request):
        """Création de compte **participant** — le rôle est imposé par le serveur."""
        email = (request.data.get('email') or '').strip().lower()
        full_name = (request.data.get('full_name') or '').strip()
        password = request.data.get('password') or ''

        if not email or not full_name or not password:
            return Response(
                {'error': 'E-mail, nom complet et mot de passe sont requis.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if '@' not in email or '.' not in email.split('@')[-1]:
            return Response(
                {'error': 'Adresse e-mail invalide.'}, status=status.HTTP_400_BAD_REQUEST
            )
        if User.objects.filter(Q(email=email) | Q(username=email)).exists():
            return Response(
                {'error': 'Cet e-mail est déjà utilisé.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from django.contrib.auth.password_validation import validate_password
        try:
            validate_password(password)
        except Exception as exc:  # noqa: BLE001 — messages DRF exploitables
            return Response(
                {'error': ' '.join(exc.messages)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        organization = None
        from apps.organizations.models import Organization
        organization = Organization.objects.order_by('created_at').first()

        with transaction.atomic():
            first_name, last_name = split_full_name(full_name)
            user = User.objects.create_user(
                username=email, email=email, password=password,
                first_name=first_name, last_name=last_name,
            )
            # Rôle **forcé** côté serveur : aucune élévation possible.
            profile = Participant.objects.create(
                user=user, organization=organization, role='participant', status='active'
            )

        # E-mail de bienvenue : best-effort, résultat rapporté honnêtement.
        sent, send_error = send_template_email(
            subject='Bienvenue sur EventTwin',
            template='emails/welcome.html',
            context={'full_name': full_name},
            recipient=email,
        )
        login(request, user)
        payload = _session_payload(request, user, profile)
        payload['email_sent'] = sent
        if not sent:
            payload['email_error'] = (
                'Compte créé, mais l’e-mail de bienvenue n’a pas pu être envoyé : '
                f'{send_error}'
            )
        return Response(payload, status=status.HTTP_201_CREATED)

    # --- Mot de passe oublié (jeton temporaire, usage unique) ----------------

    @action(detail=False, methods=['post'])
    def request_password_reset(self, request):
        """Demande de réinitialisation : jeton à usage unique par e-mail.

        La réponse reste la même que l'e-mail existe ou non (anti-énumération) ;
        en cas d'échec SMTP réel, l'erreur est exposée (jamais d'envoi présumé).
        """
        email = (request.data.get('email') or '').strip().lower()
        generic = {
            'message': (
                'Si un compte est associé à cette adresse, un lien de '
                'réinitialisation vient d’être envoyé.'
            )
        }
        if not email:
            return Response({'error': 'L’e-mail est requis.'}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(Q(email=email) | Q(username=email)).first()
        if user is None:
            # Pas de fuite d'information : réponse identique, aucun e-mail.
            return Response(generic)

        raw_token = invitation_service._new_token()
        PasswordResetToken.objects.create(
            user=user,
            token_hash=hash_token(raw_token),
            expires_at=timezone.now() + timedelta(hours=settings.AUTH_TOKEN_TTL_HOURS),
        )
        reset_url = (
            f'{settings.FRONTEND_BASE_URL.rstrip("/")}/reset-password?token={raw_token}'
        )
        sent, error = send_template_email(
            subject='EventTwin — réinitialisation de votre mot de passe',
            template='emails/reset_password.html',
            context={
                'full_name': display_name(user),
                'reset_url': reset_url,
                'expires_hours': settings.AUTH_TOKEN_TTL_HOURS,
            },
            recipient=email,
        )
        if not sent:
            return Response(
                {
                    'error': (
                        'La demande a été enregistrée, mais l’e-mail n’a pas pu être '
                        f'envoyé : {error}'
                    ),
                    'email_sent': False,
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )
        generic['email_sent'] = True
        return Response(generic)

    @action(detail=False, methods=['post'])
    def confirm_password_reset(self, request):
        """Change le mot de passe avec un jeton valide, puis consomme le jeton."""
        raw_token = request.data.get('token') or ''
        new_password = request.data.get('password') or ''
        reset = PasswordResetToken.objects.filter(
            token_hash=hash_token(raw_token)
        ).select_for_update().first()
        if reset is None or not reset.is_valid():
            return Response(
                {'error': 'Lien invalide, expiré ou déjà utilisé.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = reset.user
        from django.contrib.auth.password_validation import validate_password
        try:
            validate_password(new_password, user=user)
        except Exception as exc:  # noqa: BLE001
            return Response(
                {'error': ' '.join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST
            )
        user.set_password(new_password)
        user.save()
        reset.mark_used()
        # Tous les autres jetons du même utilisateur deviennent inutilisables.
        PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(
            used_at=timezone.now()
        )
        Token.objects.filter(user=user).delete()
        return Response({'message': 'Mot de passe réinitialisé. Vous pouvez vous connecter.'})

    @action(detail=False, methods=['post'])
    def change_password(self, request):
        """Changement de mot de passe pour le compte connecté."""
        user = request.user
        current = request.data.get('current_password') or ''
        new_password = request.data.get('password') or ''
        if not user.check_password(current):
            return Response(
                {'error': 'Mot de passe actuel incorrect.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from django.contrib.auth.password_validation import validate_password
        try:
            validate_password(new_password, user=user)
        except Exception as exc:  # noqa: BLE001
            return Response(
                {'error': ' '.join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST
            )
        user.set_password(new_password)
        user.save()
        return Response({'message': 'Mot de passe modifié.'})

    # --- Invitations organisateurs (super-administrateur) --------------------

    @action(detail=False, methods=['post'])
    def invite_organizer(self, request):
        """Crée l'invitation + le compte en attente, envoie l'e-mail.

        Réponse honnête : ``email_sent`` reflète l'envoi réel ; l'échec SMTP
        est exposé avec sa raison, jamais masqué.
        """
        try:
            invitation, raw_token = invitation_service.create_invitation(
                request.data.get('email'),
                request.data.get('full_name'),
                created_by=request.user,
            )
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        sent, error = invitation_service.send_invitation_email(invitation, raw_token)
        payload = OrganizerInvitationSerializer(invitation).data
        payload['email_sent'] = sent
        if not sent:
            payload['email_error'] = (
                'Invitation créée, mais l’e-mail n’a pas pu être envoyé : '
                f'{error}. Utilisez « Renvoyer » une fois le serveur d’e-mail rétabli.'
            )
        return Response(payload, status=status.HTTP_201_CREATED)

    # Alias conservé pour les clients existants : la sémantique est désormais
    # celle d'une invitation (aucun mot de passe n'est plus généré ni envoyé).
    @action(detail=False, methods=['post'], url_path='create_organizer')
    def create_organizer(self, request):
        return self.invite_organizer(request)

    @action(detail=False, methods=['post'], url_path='invitations/(?P<invitation_id>[^/.]+)/resend')
    def resend_invitation(self, request, invitation_id=None):
        invitation = OrganizerInvitation.objects.filter(pk=invitation_id).first()
        if invitation is None:
            return Response({'error': 'Invitation introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        if invitation.is_used():
            return Response(
                {'error': 'Cette invitation a déjà été acceptée.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        invitation, raw_token = invitation_service.resend_invitation(invitation)
        sent, error = invitation_service.send_invitation_email(invitation, raw_token)
        payload = OrganizerInvitationSerializer(invitation).data
        payload['email_sent'] = sent
        if not sent:
            payload['email_error'] = f'Échec de l’envoi : {error}'
        return Response(payload)

    @action(detail=False, methods=['post'], url_path='invitations/(?P<invitation_id>[^/.]+)/revoke')
    def revoke_invitation(self, request, invitation_id=None):
        invitation = OrganizerInvitation.objects.filter(pk=invitation_id).first()
        if invitation is None:
            return Response({'error': 'Invitation introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        if invitation.is_used():
            return Response(
                {'error': 'Cette invitation a déjà été acceptée : utilisez la '
                          'désactivation du compte.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        invitation_service.revoke_invitation(invitation)
        return Response(OrganizerInvitationSerializer(invitation).data)

    @action(detail=False, methods=['get'], url_path='invitations')
    def list_invitations(self, request):
        invitations = OrganizerInvitation.objects.select_related(
            'user', 'created_by', 'organization'
        ).order_by('-created_at')
        return Response(OrganizerInvitationSerializer(invitations, many=True).data)

    @action(detail=False, methods=['post'])
    def accept_invitation(self, request):
        """Activation par lien : le participant choisit son mot de passe."""
        user, error = invitation_service.accept_invitation(
            request.data.get('token'), request.data.get('password')
        )
        if user is None:
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)
        request.session.flush()
        login(request, user)
        return Response(_session_payload(request, user, None))

    @action(detail=False, methods=['get'])
    def get_organizers(self, request):
        organizers = Participant.objects.filter(role='organizer').order_by('-created_at')
        return Response(ParticipantSerializer(organizers, many=True).data)


class EventParticipantViewSet(EventFilterMixin, viewsets.ModelViewSet):
    """Inscriptions : capacité, publication et doublons vérifiés côté serveur."""

    queryset = EventParticipant.objects.select_related(
        'event', 'participant', 'participant__user'
    ).all().order_by('-created_at')
    serializer_class = EventParticipantSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if is_super_admin(user):
            return queryset
        profile = profile_of(user)
        if profile is None:
            return queryset.none()
        if profile.is_organizer:
            return queryset.filter(
                Q(participant__organization_id=profile.organization_id)
                | Q(event__in=events_manageable(user))
            ).distinct()
        return queryset.filter(participant=profile)

    def create(self, request, *args, **kwargs):
        """Inscription : le backend vérifie identité, publication, capacité,
        doublons — jamais seulement un bouton côté client."""
        user = request.user
        profile = profile_of(user)

        event_id = request.data.get('event')
        from apps.events.models import Event
        event = events_visible(user).filter(pk=event_id).first()
        if event is None:
            return Response(
                {'error': 'Événement introuvable ou non accessible.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        if not event.is_published and not (is_super_admin(user) or (profile and profile.is_organizer and events_manageable(user).filter(pk=event.pk).exists())):
            return Response(
                {'error': 'Les inscriptions ne sont ouvertes que pour un événement publié.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Un événement terminé n'accepte plus d'inscription (fin, à défaut début).
        last_day = event.end_date or event.start_date
        if last_day and last_day < timezone.localdate():
            return Response(
                {'error': 'Cet événement est terminé : les inscriptions sont closes.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Le participant s'inscrit **lui-même** ; seul un organisateur du
        # périmètre peut inscrire un tiers.
        if is_super_admin(user) or (profile and profile.is_organizer and events_manageable(user).filter(pk=event.pk).exists()):
            participant_id = request.data.get('participant') or (profile.pk if profile else None)
        else:
            participant_id = profile.pk if profile else None
        participant = Participant.objects.filter(pk=participant_id).first()
        if participant is None:
            return Response(
                {'error': 'Participant introuvable.'}, status=status.HTTP_404_NOT_FOUND
            )

        # Doublon : la contrainte d'unicité DB garantit l'état final ;
        # ``get_or_create`` évite l'erreur 500 sur requêtes concurrentes.
        if EventParticipant.objects.filter(event=event, participant=participant).exists():
            return Response(
                {'error': 'Ce participant est déjà inscrit à cet événement.'},
                status=status.HTTP_409_CONFLICT,
            )

        # Capacité : verrou de verrouillage pour éviter le dépassement
        # concurrent (annulation de lignes entre le comptage et l'insertion).
        with transaction.atomic():
            locked_event = Event.objects.select_for_update().get(pk=event.pk)
            registered = locked_event.event_participants.count()
            # ``capacity=0`` signifie « illimité » (colonne NOT NULL historique).
            if locked_event.has_capacity_limit and registered >= locked_event.capacity:
                return Response(
                    {'error': 'Capacité maximale atteinte pour cet événement.'},
                    status=status.HTTP_409_CONFLICT,
                )
            serializer = self.get_serializer(data={
                'event': str(event.pk),
                'participant': str(participant.pk),
                'attendance_status': request.data.get('attendance_status', 'registered'),
            })
            serializer.is_valid(raise_exception=True)
            try:
                self.perform_create(serializer)
            except Exception:  # contrainte d'unicité gagnant la course
                return Response(
                    {'error': 'Ce participant est déjà inscrit à cet événement.'},
                    status=status.HTTP_409_CONFLICT,
                )
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_destroy(self, instance):
        user = self.request.user
        profile = profile_of(user)
        # Le participant se désinscrit ; l'organisateur du périmètre peut
        # aussi retirer une inscription de SES événements.
        own = bool(profile and instance.participant_id == profile.pk)
        managed = is_super_admin(user) or (
            profile and profile.is_organizer
            and events_manageable(user).filter(pk=instance.event_id).exists()
        )
        if not (own or managed):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Seul le participant concerné ou '
                                   'l’organisateur de l’événement peut annuler cette inscription.')
        super().perform_destroy(instance)


class ParticipantPreferenceViewSet(viewsets.ModelViewSet):
    """Préférences : accessibles à son propriétaire et aux managers du périmètre."""

    queryset = ParticipantPreference.objects.select_related('participant').all().order_by('preference_type')
    serializer_class = ParticipantPreferenceSerializer
    permission_classes = [IsSelfOrManager]

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if is_super_admin(user):
            return queryset
        profile = profile_of(user)
        if profile is None:
            return queryset.none()
        if profile.is_organizer:
            managed = events_manageable(user)
            return queryset.filter(
                Q(participant__organization_id=profile.organization_id)
                | Q(participant__event_participations__event__in=managed)
            ).distinct()
        return queryset.filter(participant=profile)

    def perform_create(self, serializer):
        profile = profile_of(self.request.user)
        # Un participant ne crée que sur **son propre** profil ; un manager
        # peut compléter les profils de son périmètre (participant fourni).
        requested = self.request.data.get('participant')
        if requested and requested != str(profile.pk if profile else ''):
            if not (is_super_admin(self.request.user) or is_organizer(self.request.user)):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Vous ne pouvez modifier que vos propres préférences.')
        serializer.save(participant=Participant.objects.filter(pk=requested or (profile.pk if profile else None)).first())


class ParticipantConstraintViewSet(viewsets.ModelViewSet):
    """Contraintes (allergies…) : mêmes règles de propriété que les préférences."""

    queryset = ParticipantConstraint.objects.select_related('participant').all().order_by('constraint_type')
    serializer_class = ParticipantConstraintSerializer
    permission_classes = [IsSelfOrManager]

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if is_super_admin(user):
            return queryset
        profile = profile_of(user)
        if profile is None:
            return queryset.none()
        if profile.is_organizer:
            managed = events_manageable(user)
            return queryset.filter(
                Q(participant__organization_id=profile.organization_id)
                | Q(participant__event_participations__event__in=managed)
            ).distinct()
        return queryset.filter(participant=profile)

    def perform_create(self, serializer):
        profile = profile_of(self.request.user)
        requested = self.request.data.get('participant')
        if requested and requested != str(profile.pk if profile else ''):
            if not (is_super_admin(self.request.user) or is_organizer(self.request.user)):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('Vous ne pouvez modifier que vos propres contraintes.')
        serializer.save(participant=Participant.objects.filter(pk=requested or (profile.pk if profile else None)).first())
