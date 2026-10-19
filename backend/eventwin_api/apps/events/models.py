from django.db import models
from django.core.validators import MinValueValidator

from apps.base_models import UUIDTimestampedModel


class Event(UUIDTimestampedModel):
    EVENT_TYPES = [
        ('conference', 'Conférence'),
        ('workshop', 'Atelier'),
        ('road_trip', 'Road trip'),
        ('retreat', 'Séminaire / retraite'),
        ('gala', 'Gala'),
        ('product_launch', 'Lancement produit'),
        ('internal_meeting', 'Réunion interne'),
        ('other', 'Autre'),
    ]

    # Statuts de publication : seuls les événements « published » sont visibles
    # et ouverts à l'inscription côté participants.
    EVENT_STATUSES = [
        ('draft', 'Brouillon'),
        ('published', 'Publié'),
        ('completed', 'Terminé'),
        ('cancelled', 'Annulé'),
    ]

    EVENT_FORMATS = [
        ('onsite', 'Sur site'),
        ('hybrid', 'Hybride'),
        ('remote', 'À distance'),
        ('mobile', 'Itinérant'),
        ('multi_site', 'Multi-sites'),
    ]

    AUDIENCE_TYPES = [
        ('internal', 'Interne'),
        ('external', 'Externe'),
        ('mixed', 'Mixte'),
    ]

    MOBILITY_LEVELS = [
        ('low', 'Faible'),
        ('medium', 'Moyenne'),
        ('high', 'Élevée'),
    ]

    ACCESSIBILITY_LEVELS = [
        ('standard', 'Standard'),
        ('enhanced', 'Renforcée'),
        ('strict', 'Stricte'),
    ]

    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='events',
    )
    # Organisateur **propriétaire** de l'événement. Un événement a toujours un
    # organisateur ; la colonne reste nullable uniquement pour permettre la
    # migration des données historiques (backfill en 0005), l'application
    # refuse toute création sans propriétaire authentifié.
    owner = models.ForeignKey(
        'auth.User',
        on_delete=models.PROTECT,
        related_name='owned_events',
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=255)
    event_type = models.CharField(max_length=50, choices=EVENT_TYPES, default='other')
    event_format = models.CharField(max_length=50, choices=EVENT_FORMATS, default='onsite')
    objective = models.CharField(max_length=255, blank=True)
    audience_type = models.CharField(max_length=50, choices=AUDIENCE_TYPES, default='mixed')
    mobility_level = models.CharField(max_length=50, choices=MOBILITY_LEVELS, default='medium')
    accommodation_required = models.BooleanField(default=False)
    accessibility_level = models.CharField(max_length=50, choices=ACCESSIBILITY_LEVELS, default='standard')
    route_or_logistics_notes = models.TextField(blank=True)
    status = models.CharField(max_length=50, choices=EVENT_STATUSES, default='draft')
    # Capacité maximale d'accueil. La colonne préexistante en base est
    # NOT NULL avec 0 pour « illimité » : le modèle reprend cette définition
    # pour éviter toute dérive de schéma (voir migration de réconciliation).
    capacity = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    location = models.CharField(max_length=255, blank=True)
    target_budget = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    participant_target = models.IntegerField(default=0)
    participant_expected = models.IntegerField(default=0)
    bus_standard_count = models.IntegerField(default=0)
    bus_standard_capacity = models.IntegerField(default=50)
    bus_mini_count = models.IntegerField(default=0)
    bus_mini_capacity = models.IntegerField(default=30)
    bus_vip_count = models.IntegerField(default=0)
    bus_vip_capacity = models.IntegerField(default=20)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(target_budget__gte=0),
                name='event_target_budget_nonnegative',
            ),
            models.CheckConstraint(
                condition=models.Q(participant_target__gte=0)
                & models.Q(participant_expected__gte=0),
                name='event_participant_targets_nonnegative',
            ),
            models.CheckConstraint(
                condition=models.Q(start_date__isnull=True)
                | models.Q(end_date__isnull=True)
                | models.Q(end_date__gte=models.F('start_date')),
                name='event_dates_ordered',
            ),
        ]

    def __str__(self):
        return self.name

    @property
    def is_published(self) -> bool:
        return self.status == 'published'

    @property
    def has_capacity_limit(self) -> bool:
        """``True`` si une capacité maximale réelle est imposée (0 = illimité)."""
        return bool(self.capacity)

    @property
    def registered_count(self) -> int:
        """Nombre réel d'inscriptions — calculé, jamais stocké."""
        return self.event_participants.count()


class EventScheduleItem(UUIDTimestampedModel):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='schedule_items')
    title = models.CharField(max_length=255)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    category = models.CharField(max_length=100, blank=True)
    location = models.CharField(max_length=255, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(ends_at__gte=models.F('starts_at')),
                name='schedule_item_times_ordered',
            ),
        ]


class Resource(UUIDTimestampedModel):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='resources')
    resource_type = models.CharField(max_length=100)
    name = models.CharField(max_length=255)
    capacity = models.IntegerField(default=0)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(capacity__gte=0),
                name='resource_capacity_nonnegative',
            ),
            models.CheckConstraint(
                condition=models.Q(unit_cost__gte=0),
                name='resource_unit_cost_nonnegative',
            ),
        ]
