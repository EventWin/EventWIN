from django.db import models


class AIRecommendation(models.Model):
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title


class ParticipantFitAnalysis(models.Model):
    """Analyse IA de l'adéquation d'un participant à un ensemble d'événements.

    Mise en cache par ``input_hash`` (profil + événements + version du prompt +
    modèle) : tant que ni le profil ni les événements ne changent, la même
    analyse est resservie sans nouvel appel à Gemini.
    """

    participant = models.ForeignKey(
        'participants.Participant', on_delete=models.CASCADE, related_name='fit_analyses'
    )
    input_hash = models.CharField(max_length=64, db_index=True)
    model_name = models.CharField(max_length=100)
    # Résultat déjà validé et scoré côté serveur (voir apps.ai.fit).
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['participant', 'input_hash'], name='unique_participant_fit_input'
            ),
        ]
