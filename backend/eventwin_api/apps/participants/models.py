import uuid
from django.db import models
from django.contrib.auth.models import AbstractUser, UserManager
from apps.base_models import UUIDTimestampedModel


class UserRole(models.TextChoices):
    """
    Énumération stricte des rôles applicatifs.
    """
    ADMIN = 'admin', 'Administrateur'
    ORGANIZER = 'organizer', 'Organisateur'
    PARTICIPANT = 'participant', 'Participant'


class User(AbstractUser):
    """
    TABLE PRINCIPALE COMMUNE (GÉNÉRALISATION UML)
    Regroupe TOUS les attributs communs aux 3 types d'utilisateurs.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.CharField(
        max_length=20,
        choices=UserRole.choices,
        default=UserRole.PARTICIPANT,
        verbose_name="Rôle applicatif"
    )
    phone = models.CharField(
        max_length=50, 
        blank=True, 
        default='', 
        verbose_name="Numéro de téléphone"
    )
    photo = models.TextField(
        blank=True, 
        default='', 
        verbose_name="Photo de profil / Avatar"
    )
    status = models.CharField(
        max_length=50, 
        default='active', 
        verbose_name="Statut du compte"
    )
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='users',
        verbose_name="Organisation / Entreprise"
    )

    objects = UserManager()

    class Meta:
        db_table = 'user'
        verbose_name = 'Utilisateur'
        verbose_name_plural = 'Utilisateurs'

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"

    @property
    def is_admin_role(self):
        return self.role == UserRole.ADMIN or self.is_superuser

    @property
    def is_organizer_role(self):
        return self.role == UserRole.ORGANIZER or self.is_staff

    @property
    def is_participant_role(self):
        return self.role == UserRole.PARTICIPANT

    @property
    def full_name(self):
        full = f"{self.first_name} {self.last_name}".strip()
        return full if full else self.username

    @property
    def user(self):
        """Rétrocompatibilité : renvoie self."""
        return self

    @property
    def profile(self):
        """Rétrocompatibilité : renvoie le profil participant ou self."""
        return getattr(self, 'participant', self)


class Participant(User):
    """
    SOUS-CLASSE PARTICIPANT (SPÉCIALISATION UML PAR HÉRITAGE)
    Hérite directement de tous les attributs de la table User.
    Contient les données spécifiques aux participants (badge, contraintes, préférences).
    """
    badge_code = models.CharField(
        max_length=100, 
        blank=True, 
        default='', 
        verbose_name="Code badge / QR"
    )

    class Meta:
        db_table = 'participant'
        verbose_name = 'Participant'
        verbose_name_plural = 'Participants'

    def save(self, *args, **kwargs):
        if not self.role:
            self.role = UserRole.PARTICIPANT
        super().save(*args, **kwargs)


class Organizer(User):
    """
    SOUS-CLASSE ORGANISATEUR (SPÉCIALISATION UML PAR HÉRITAGE)
    Hérite directement de User avec rôle Organisateur et accès staff.
    """
    license_type = models.CharField(
        max_length=50, 
        blank=True, 
        default='standard', 
        verbose_name="Licence organisateur"
    )

    class Meta:
        db_table = 'organizer'
        verbose_name = 'Organisateur'
        verbose_name_plural = 'Organisateurs'

    def save(self, *args, **kwargs):
        if not self.role or self.role == UserRole.PARTICIPANT:
            self.role = UserRole.ORGANIZER
        self.is_staff = True
        super().save(*args, **kwargs)


# Alias pour rétrocompatibilité (l'admin est un User avec role=ADMIN, pas de sous-table distincte)
UserProfile = User
AdminProfile = User


class EventParticipant(UUIDTimestampedModel):
    """
    Liaison d'un participant avec un événement.
    """
    event = models.ForeignKey(
        'events.Event', 
        on_delete=models.CASCADE, 
        related_name='event_participants'
    )
    participant = models.ForeignKey(
        Participant, 
        on_delete=models.CASCADE, 
        related_name='event_participations'
    )
    attendance_status = models.CharField(max_length=50, blank=True)
    satisfaction_score = models.DecimalField(max_digits=5, decimal_places=2, default=0)


class ParticipantPreference(UUIDTimestampedModel):
    """
    Préférences spécifiques au participant (repas, calme, transport, etc.).
    """
    participant = models.ForeignKey(
        Participant, 
        on_delete=models.CASCADE, 
        related_name='preferences'
    )
    preference_type = models.CharField(max_length=100)
    value = models.CharField(max_length=255)
    weight = models.IntegerField(default=1)


class ParticipantConstraint(UUIDTimestampedModel):
    """
    Contraintes spécifiques au participant (PMR, allergies, dates).
    """
    participant = models.ForeignKey(
        Participant, 
        on_delete=models.CASCADE, 
        related_name='constraints'
    )
    constraint_type = models.CharField(max_length=100)
    value = models.CharField(max_length=255)
    is_hard_constraint = models.BooleanField(default=False)
