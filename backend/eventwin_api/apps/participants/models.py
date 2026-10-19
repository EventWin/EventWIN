from django.db import models

from apps.base_models import UUIDTimestampedModel


from django.contrib.auth.models import User

# --- Rôles et statuts --------------------------------------------------------
# Rôles imposés côté serveur. Un client ne peut jamais choisir son rôle :
# l'inscription crée toujours un « participant » ; seul le super-administrateur
# peut créer un organisateur (via invitation).
def display_name(user) -> str:
    """Nom affichable d'un compte : prénom + nom, à défaut l'identifiant."""
    if user is None:
        return ''
    return user.get_full_name().strip() or user.username


def split_full_name(full_name: str) -> tuple[str, str]:
    """« Jeanne Marie Dupont » → (« Jeanne Marie », « Dupont »)."""
    parts = (full_name or '').split()
    if len(parts) < 2:
        return (parts[0] if parts else ''), ''
    return ' '.join(parts[:-1])[:150], parts[-1][:150]


ROLE_CHOICES = [
    ('participant', 'Participant'),
    ('organizer', 'Organisateur'),
]

# Statut du profil : « invited » = compte créé par invitation mais mot de passe
# encore indéfini (cf. apps.participants.invitations).
PARTICIPANT_STATUS_CHOICES = [
    ('active', 'Actif'),
    ('invited', 'Invité'),
    ('disabled', 'Désactivé'),
]


class Participant(UUIDTimestampedModel):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile', null=True)
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='participants',
        null=True, blank=True
    )
    role = models.CharField(max_length=100, choices=ROLE_CHOICES, default='participant')
    status = models.CharField(max_length=50, choices=PARTICIPANT_STATUS_CHOICES, default='active')

    def __str__(self):
        return self.user.username if self.user else str(self.id)

    # --- Aides de rôle (utilisées par les permissions) -----------------------
    @property
    def is_organizer(self) -> bool:
        return self.role == 'organizer' and self.status == 'active'

    @property
    def is_active_account(self) -> bool:
        return self.status == 'active'
        
    def delete(self, *args, **kwargs):
        # Sauvegarder la référence à l'utilisateur avant la suppression
        user_to_delete = self.user
        # Supprimer d'abord le Participant
        super().delete(*args, **kwargs)
        # Supprimer ensuite l'utilisateur lié
        if user_to_delete:
            user_to_delete.delete()


class EventParticipant(UUIDTimestampedModel):
    event = models.ForeignKey('events.Event', on_delete=models.CASCADE, related_name='event_participants')
    participant = models.ForeignKey(Participant, on_delete=models.CASCADE, related_name='event_participations')
    attendance_status = models.CharField(max_length=50, blank=True)
    satisfaction_score = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    class Meta:
        # Un participant ne peut avoir qu'une inscription par événement.
        # La protection contre la concurrence (requêtes simultanées) se fait
        # côté vues via ``get_or_create`` ; cette contrainte garantit l'état
        # final même si deux requêtes passent entre les verrous.
        constraints = [
            models.UniqueConstraint(
                fields=['event', 'participant'],
                name='unique_event_participant',
            )
        ]


# --- Jetons de sécurité ------------------------------------------------------
# Seul le **hachage** (SHA-256 hex) est stocké en base : une fuite de la base
# ne donne aucun jeton utilisable. Les jetons sont à usage unique et expirés.

def hash_token(raw_token: str) -> str:
    """Hachage déterministe d'un jeton, seul état persistant accepté."""
    import hashlib

    return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()


class PasswordResetToken(UUIDTimestampedModel):
    """Jeton temporaire à usage unique pour la réinitialisation de mot de passe."""

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='password_reset_tokens'
    )
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    def is_valid(self) -> bool:
        from django.utils import timezone

        return self.used_at is None and timezone.now() <= self.expires_at

    def mark_used(self) -> None:
        from django.utils import timezone

        self.used_at = timezone.now()
        self.save(update_fields=['used_at'])


class OrganizerInvitation(UUIDTimestampedModel):
    """Invitation d'un organisateur par le super-administrateur.

    Cycle : le super-admin saisit l'e-mail → compte créé (rôle organisateur,
    statut « invited ») + jeton → e-mail avec lien d'activation →
    l'organisateur définit son mot de passe → compte actif, jeton consommé.
    Aucun mot de passe n'est stocké ou transmis en clair.
    """

    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=255)
    # Compte créé en attente (Participant.status = 'invited').
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='organizer_invitations',
        null=True, blank=True,
    )
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name='sent_invitations'
    )
    organization = models.ForeignKey(
        'organizations.Organization', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='invitations',
    )
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    # Honnêteté d'envoi : ``False`` si le serveur SMTP a échoué. L'interface
    # affiche l'échec ; jamais un envoi présumé.
    email_sent = models.BooleanField(default=False)
    email_error = models.TextField(blank=True)
    last_sent_at = models.DateTimeField(null=True, blank=True)

    def is_revoked(self) -> bool:
        return self.revoked_at is not None

    def is_used(self) -> bool:
        return self.used_at is not None

    def is_valid(self) -> bool:
        from django.utils import timezone

        return (
            not self.is_revoked()
            and not self.is_used()
            and timezone.now() <= self.expires_at
        )

    def status(self) -> str:
        if self.is_revoked():
            return 'revoked'
        if self.is_used():
            return 'accepted'
        from django.utils import timezone

        if timezone.now() > self.expires_at:
            return 'expired'
        return 'pending'

    def mark_used(self) -> None:
        from django.utils import timezone

        self.used_at = timezone.now()
        self.save(update_fields=['used_at'])


class ParticipantPreference(UUIDTimestampedModel):
    participant = models.ForeignKey(Participant, on_delete=models.CASCADE, related_name='preferences')
    preference_type = models.CharField(max_length=100)
    value = models.CharField(max_length=255)
    weight = models.IntegerField(default=1)


class ParticipantConstraint(UUIDTimestampedModel):
    participant = models.ForeignKey(Participant, on_delete=models.CASCADE, related_name='constraints')
    constraint_type = models.CharField(max_length=100)
    value = models.CharField(max_length=255)
    is_hard_constraint = models.BooleanField(default=False)


# --- Quiz --------------------------------------------------------------------
# Les tables ``participants_eventquiz``, ``participants_quizquestion`` et
# ``participants_quizanswer`` **existaient déjà** en base (schéma d'un ancien
# état du projet, tables vides) sans modèle correspondant. On réutilise ce
# schéma plutôt que de le dupliquer : les modèles déclarent les mêmes colonnes
# et la migration associée les adopte (aucune suppression, aucun doublon).


class EventQuiz(UUIDTimestampedModel):
    """Questionnaire rattaché à un événement (un par événement, contrainte UNIQUE)."""

    event = models.OneToOneField(
        'events.Event', on_delete=models.CASCADE, related_name='quiz'
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f'{self.title} ({self.event.name})'


class QuizQuestion(UUIDTimestampedModel):
    """Question configurable par l'organisateur.

    ``kind`` :
      - ``single``  : choix unique parmi ``options`` ;
      - ``multiple``: choix multiples parmi ``options`` ;
      - ``boolean`` : oui/non (servant notamment à « aucune allergie ») ;
      - ``text``    : question libre.
    Une question sans réponse est distinguée d'une réponse « aucune » : le
    simple fait de ne pas répondre n'est jamais interprété comme « aucune ».
    """

    KIND_CHOICES = [
        ('single', 'Choix unique'),
        ('multiple', 'Choix multiples'),
        ('boolean', 'Oui / Non'),
        ('text', 'Question libre'),
    ]

    quiz = models.ForeignKey(EventQuiz, on_delete=models.CASCADE, related_name='questions')
    prompt = models.CharField(max_length=255)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default='single')
    # Liste des propositions (JSON) pour les questions à choix.
    options = models.JSONField(default=list, blank=True)
    is_required = models.BooleanField(default=False)
    position = models.IntegerField(default=0)

    class Meta:
        ordering = ['position', 'created_at']
        constraints = [
            models.CheckConstraint(
                condition=models.Q(position__gte=0),
                name='quiz_question_position_nonnegative',
            ),
        ]

    def __str__(self):
        return self.prompt


class QuizAnswer(UUIDTimestampedModel):
    """Réponse d'un participant à une question, liée à son inscription.

    ``value`` est ``null`` tant que le participant n'a **pas** répondu : cette
    distinction « non répondu » vs « répondu (y compris 'aucune') » est
    préservée telle quelle, jamais aplanie.
    """

    registration = models.ForeignKey(
        EventParticipant, on_delete=models.CASCADE, related_name='quiz_answers'
    )
    question = models.ForeignKey(
        QuizQuestion, on_delete=models.CASCADE, related_name='answers'
    )
    value = models.JSONField(null=True, blank=True)

    class Meta:
        # Une seule réponse par question et par inscription (reprise incluse).
        constraints = [
            models.UniqueConstraint(
                fields=['registration', 'question'],
                name='unique_answer_per_question',
            )
        ]

    @property
    def is_answered(self) -> bool:
        return self.value is not None

class Organizer(Participant):
    class Meta:
        proxy = True
        verbose_name = 'Organisateur'
        verbose_name_plural = 'Organisateurs'
