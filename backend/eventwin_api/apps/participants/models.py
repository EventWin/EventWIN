from django.db import models

from apps.base_models import UUIDTimestampedModel


from django.contrib.auth.models import User

class Participant(UUIDTimestampedModel):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile', null=True)
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='participants',
        null=True, blank=True
    )
    role = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=50, default='active')
    phone = models.CharField(max_length=50, blank=True, default='')
    photo = models.TextField(blank=True, default='')

    def __str__(self):
        return self.user.username if self.user else str(self.id)
        
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

class Organizer(Participant):
    class Meta:
        proxy = True
        verbose_name = 'Organisateur'
        verbose_name_plural = 'Organisateurs'


from django.db.models.signals import post_save
from django.dispatch import receiver

@receiver(post_save, sender=User)
def sync_user_participant_profile(sender, instance, created, **kwargs):
    role = 'participant'
    if instance.is_superuser:
        role = 'admin'
    elif instance.is_staff:
        role = 'organizer'
        
    try:
        from apps.organizations.models import Organization
        org = Organization.objects.first()
    except Exception:
        org = None

    p, _ = Participant.objects.get_or_create(user=instance, defaults={'role': role, 'status': 'active', 'organization': org})
    if p.role != role and (instance.is_superuser or instance.is_staff):
        p.role = role
        p.save()
