from django.db import models

from apps.base_models import UUIDTimestampedModel


class Participant(UUIDTimestampedModel):
    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='participants',
    )
    full_name = models.CharField(max_length=255)
    email = models.EmailField(blank=True, null=True)
    role = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=50, default='active')

    def __str__(self):
        return self.full_name


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
