from django.db import models
from apps.base_models import UUIDTimestampedModel
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver


class UserRole(models.TextChoices):
    """
    Énumération stricte des rôles applicatifs pour tous les types d'utilisateurs.
    """
    ADMIN = 'admin', 'Administrateur'
    ORGANIZER = 'organizer', 'Organisateur'
    PARTICIPANT = 'participant', 'Participant'


class BaseUserProfile(UUIDTimestampedModel):
    """
    Modèle de base abstrait regroupant tous les attributs communs 
    aux 3 types d'utilisateurs (Admin, Organisateur, Participant).
    """
    user = models.OneToOneField(
        User, 
        on_delete=models.CASCADE, 
        related_name='profile', 
        null=True
    )
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='participants',
        null=True, 
        blank=True
    )
    role = models.CharField(
        max_length=50, 
        choices=UserRole.choices, 
        default=UserRole.PARTICIPANT,
        verbose_name="Rôle utilisateur"
    )
    status = models.CharField(max_length=50, default='active', verbose_name="Statut du compte")
    phone = models.CharField(max_length=50, blank=True, default='', verbose_name="Numéro de téléphone")
    photo = models.TextField(blank=True, default='', verbose_name="Photo de profil / Avatar")

    class Meta:
        abstract = True

    def __str__(self):
        return self.user.username if self.user else str(self.id)

    def delete(self, *args, **kwargs):
        user_to_delete = self.user
        super().delete(*args, **kwargs)
        if user_to_delete:
            user_to_delete.delete()

    @property
    def is_admin(self):
        return self.role == UserRole.ADMIN

    @property
    def is_organizer(self):
        return self.role == UserRole.ORGANIZER

    @property
    def is_participant(self):
        return self.role == UserRole.PARTICIPANT

    @property
    def email(self):
        return self.user.email if self.user else ''

    @property
    def full_name(self):
        if not self.user:
            return 'Inconnu'
        full = f"{self.user.first_name} {self.user.last_name}".strip()
        return full if full else self.user.username


class Participant(BaseUserProfile):
    """
    Table concrète représentant le profil utilisateur dans le système,
    enrichie des relations spécifiques au participant (pass, préférences, contraintes, présences).
    """
    class Meta:
        verbose_name = 'Participant'
        verbose_name_plural = 'Participants'


# Alias pour requêter la table commune des utilisateurs indifféremment de leur rôle
UserProfile = Participant


class OrganizerManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(role=UserRole.ORGANIZER)


class Organizer(Participant):
    """
    Modèle spécialisé pour les Organisateurs.
    Garantit l'attribution du rôle ORGANIZER et dispose de son propre manager.
    """
    objects = OrganizerManager()
    all_objects = models.Manager()

    class Meta:
        proxy = True
        verbose_name = 'Organisateur'
        verbose_name_plural = 'Organisateurs'

    def save(self, *args, **kwargs):
        self.role = UserRole.ORGANIZER
        super().save(*args, **kwargs)


class AdminProfileManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(role=UserRole.ADMIN)


class AdminProfile(Participant):
    """
    Modèle spécialisé pour les Administrateurs.
    Garantit l'attribution du rôle ADMIN et dispose de son propre manager.
    """
    objects = AdminProfileManager()
    all_objects = models.Manager()

    class Meta:
        proxy = True
        verbose_name = 'Administrateur'
        verbose_name_plural = 'Administrateurs'

    def save(self, *args, **kwargs):
        self.role = UserRole.ADMIN
        super().save(*args, **kwargs)


class EventParticipant(UUIDTimestampedModel):
    """
    Liaison entre un Événement et un Participant (inscription, émargement, satisfaction).
    """
    event = models.ForeignKey('events.Event', on_delete=models.CASCADE, related_name='event_participants')
    participant = models.ForeignKey(Participant, on_delete=models.CASCADE, related_name='event_participations')
    attendance_status = models.CharField(max_length=50, blank=True)
    satisfaction_score = models.DecimalField(max_digits=5, decimal_places=2, default=0)


class ParticipantPreference(UUIDTimestampedModel):
    """
    Préférences spécifiques au participant (restauration, calme, transport, etc.).
    """
    participant = models.ForeignKey(Participant, on_delete=models.CASCADE, related_name='preferences')
    preference_type = models.CharField(max_length=100)
    value = models.CharField(max_length=255)
    weight = models.IntegerField(default=1)


class ParticipantConstraint(UUIDTimestampedModel):
    """
    Contraintes logistiques fortes ou faibles du participant (PMR, allergies, dates).
    """
    participant = models.ForeignKey(Participant, on_delete=models.CASCADE, related_name='constraints')
    constraint_type = models.CharField(max_length=100)
    value = models.CharField(max_length=255)
    is_hard_constraint = models.BooleanField(default=False)


@receiver(post_save, sender=User)
def sync_user_participant_profile(sender, instance, created, **kwargs):
    """
    Synchronise automatiquement le profil utilisateur avec son rôle selon les droits Django.
    """
    role = UserRole.PARTICIPANT
    if instance.is_superuser:
        role = UserRole.ADMIN
    elif instance.is_staff:
        role = UserRole.ORGANIZER
        
    try:
        from apps.organizations.models import Organization
        org = Organization.objects.first()
    except Exception:
        org = None

    p, _ = Participant.objects.get_or_create(
        user=instance, 
        defaults={'role': role, 'status': 'active', 'organization': org}
    )
    if p.role != role and (instance.is_superuser or instance.is_staff):
        p.role = role
        p.save()
