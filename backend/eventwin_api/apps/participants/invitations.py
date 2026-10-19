"""Invitation des organisateurs — logique métier unique.

Cycle (aucun mot de passe en clair, jamais) :
1. le super-administrateur saisit un e-mail ;
2. le compte est créé (rôle organisateur, statut « invited ») et un jeton
   aléatoire est généré ; **seul son hachage** est stocké ;
3. un e-mail contient le lien d'activation ; si l'envoi échoue, l'échec est
   enregistré (``email_sent=False`` + raison) et affiché ;
4. l'organisateur choisit son mot de passe via le lien : le jeton est
   consommé (usage unique) et le compte devient actif ;
5. le super-administrateur peut renvoyer (nouveau jeton, révocable) ou révoquer.
"""
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from apps.organizations.models import Organization
from .mails import send_template_email
from .models import OrganizerInvitation, Participant, hash_token, split_full_name


def _new_token() -> str:
    """Jeton aléatoire non devinable (256 bits d'entropie)."""
    return secrets.token_urlsafe(32)


def _expiry():
    return timezone.now() + timedelta(hours=settings.INVITATION_TTL_HOURS)


@transaction.atomic
def create_invitation(email: str, full_name: str, created_by: User):
    """Crée le compte en attente + l'invitation. Retourne ``(invitation, jeton)``.

    Lève ``ValueError`` si l'e-mail est déjà utilisé (compte ou invitation
    en attente) — jamais de compte fantôme.
    """
    email = (email or '').strip().lower()
    full_name = (full_name or '').strip()
    if not email or not full_name:
        raise ValueError('E-mail et nom complet sont requis.')

    if User.objects.filter(email=email).exists():
        raise ValueError('Cet e-mail est déjà associé à un compte.')
    if OrganizerInvitation.objects.filter(email=email, used_at__isnull=True, revoked_at__isnull=True).exists():
        raise ValueError('Une invitation est déjà en attente pour cet e-mail.')

    organization = Organization.objects.order_by('created_at').first()

    raw_token = _new_token()
    with transaction.atomic():
        # Verrou sur le cas d'invitation en attente (concurrence).
        existing = (
            OrganizerInvitation.objects
            .select_for_update()
            .filter(email=email, used_at__isnull=True, revoked_at__isnull=True)
            .first()
        )
        if existing:
            raise ValueError('Une invitation est déjà en attente pour cet e-mail.')

        first_name, last_name = split_full_name(full_name)
        user = User.objects.create_user(
            username=email, email=email, password=None,
            first_name=first_name, last_name=last_name,
        )
        user.set_unusable_password()
        user.save()
        Participant.objects.create(
            user=user, organization=organization, role='organizer', status='invited'
        )
        invitation = OrganizerInvitation.objects.create(
            email=email,
            full_name=full_name,
            user=user,
            token_hash=hash_token(raw_token),
            created_by=created_by,
            organization=organization,
            expires_at=_expiry(),
        )
    return invitation, raw_token


@transaction.atomic
def resend_invitation(invitation: OrganizerInvitation):
    """Révoque le jeton précédent, en génère un nouveau, renvoie ``(invitation, jeton)``."""
    raw_token = _new_token()
    invitation.token_hash = hash_token(raw_token)
    invitation.expires_at = _expiry()
    invitation.revoked_at = None
    invitation.used_at = None
    invitation.save(update_fields=['token_hash', 'expires_at', 'revoked_at', 'used_at'])
    return invitation, raw_token


def revoke_invitation(invitation: OrganizerInvitation) -> None:
    """Révoque l'invitation et désactive le compte en attente associé."""
    invitation.revoked_at = timezone.now()
    invitation.save(update_fields=['revoked_at'])
    profile = Participant.objects.filter(user=invitation.user).first()
    if profile and profile.status == 'invited':
        profile.status = 'disabled'
        profile.save(update_fields=['status'])


def send_invitation_email(invitation: OrganizerInvitation, raw_token: str):
    """Envoie l'e-mail d'activation et **enregistre le résultat réel**."""
    activation_url = (
        f'{settings.FRONTEND_BASE_URL.rstrip("/")}/activate?token={raw_token}'
    )
    ok, error = send_template_email(
        subject='Invitation EventTwin — activez votre compte organisateur',
        template='emails/organizer_invite.html',
        context={
            'full_name': invitation.full_name,
            'email': invitation.email,
            'activation_url': activation_url,
            'expires_hours': settings.INVITATION_TTL_HOURS,
        },
        recipient=invitation.email,
    )
    invitation.email_sent = ok
    invitation.email_error = '' if ok else error
    if ok:
        invitation.last_sent_at = timezone.now()
    invitation.save(update_fields=['email_sent', 'email_error', 'last_sent_at'])
    return ok, error


@transaction.atomic
def accept_invitation(raw_token: str, password: str):
    """Active le compte avec le mot de passe choisi. Jeton à **usage unique**.

    Retourne ``(user, message_erreur)`` ; en cas d'échec l'utilisateur n'est
    pas modifié.
    """
    from django.contrib.auth.password_validation import validate_password

    invitation = OrganizerInvitation.objects.filter(
        token_hash=hash_token(raw_token or '')
    ).select_for_update().first()
    if invitation is None or not invitation.is_valid():
        return None, 'Lien d’invitation invalide, expiré ou déjà utilisé.'

    if not password or len(password) < 8:
        return None, 'Le mot de passe doit contenir au moins 8 caractères.'
    validate_password(password, user=invitation.user)

    # Le compte est normalement pré-créé (statut « invited ). Si l'invitation
    # n'a pas encore de user lié, on le materialise ici — jamais de compte
    # fantôme, le jeton reste la seule preuve.
    user = invitation.user
    if user is None:
        first_name, last_name = split_full_name(invitation.full_name)
        user = User.objects.create_user(
            username=invitation.email, email=invitation.email, password=None,
            first_name=first_name, last_name=last_name,
        )
        user.set_unusable_password()
        user.save()
        Participant.objects.get_or_create(
            user=user,
            defaults={
                'organization': invitation.organization,
                'role': 'organizer',
                'status': 'invited',
            },
        )
        invitation.user = user
        invitation.save(update_fields=['user'])
    user.set_password(password)
    user.save()
    profile = Participant.objects.filter(user=user).first()
    if profile:
        profile.status = 'active'
        profile.save(update_fields=['status'])
    invitation.mark_used()
    return user, ''
