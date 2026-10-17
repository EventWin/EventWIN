from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.base_models import UUIDTimestampedModel


DEAL_STATUS_DEFAULT_PROBABILITY = {
    'lead': 10,
    'contacted': 25,
    'proposal_sent': 40,
    'negotiating': 60,
    'signed': 100,
    'paid': 100,
    'lost': 0,
}


class Sponsor(UUIDTimestampedModel):
    INDUSTRY_CHOICES = [
        ('finance', 'Finance'),
        ('tech', 'Tech'),
        ('retail', 'Retail'),
        ('food_beverage', 'Food & beverage'),
        ('automotive', 'Automotive'),
        ('health', 'Health'),
        ('media', 'Media'),
        ('energy', 'Energy'),
        ('other', 'Other'),
    ]
    RELATIONSHIP_CHOICES = [
        ('prospect', 'Prospect'),
        ('contacted', 'Contacted'),
        ('negotiating', 'Negotiating'),
        ('active', 'Active'),
        ('inactive', 'Inactive'),
    ]

    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.CASCADE,
        related_name='sponsors',
    )
    created_by = models.ForeignKey(
        'participants.Participant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_sponsors',
    )
    name = models.CharField(max_length=255)
    legal_name = models.CharField(max_length=255, blank=True)
    industry = models.CharField(max_length=50, choices=INDUSTRY_CHOICES, default='other')
    website = models.URLField(blank=True)
    logo_url = models.URLField(blank=True)
    contact_name = models.CharField(max_length=255)
    contact_email = models.EmailField()
    contact_phone = models.CharField(max_length=50, blank=True)
    country = models.CharField(max_length=100, blank=True)
    relationship_status = models.CharField(
        max_length=20,
        choices=RELATIONSHIP_CHOICES,
        default='prospect',
    )
    notes = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['organization', 'name'], name='uniq_sponsor_org_name'),
        ]

    def __str__(self):
        return self.name


class SponsorshipPackage(UUIDTimestampedModel):
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='sponsorship_packages',
    )
    name = models.CharField(max_length=255)
    tier_rank = models.IntegerField(default=1)
    price = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0.00'))],
    )
    slots_total = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    exclusive_industry = models.BooleanField(default=False)
    visibility_weight = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=Decimal('1.00'),
        validators=[MinValueValidator(Decimal('0.00'))],
    )
    description = models.TextField(blank=True)
    benefits = models.JSONField(default=list, blank=True)
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class SponsorshipDeal(UUIDTimestampedModel):
    STATUS_CHOICES = [
        ('lead', 'Lead'),
        ('contacted', 'Contacted'),
        ('proposal_sent', 'Proposal sent'),
        ('negotiating', 'Negotiating'),
        ('signed', 'Signed'),
        ('paid', 'Paid'),
        ('lost', 'Lost'),
    ]

    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='sponsorship_deals',
    )
    sponsor = models.ForeignKey(
        Sponsor,
        on_delete=models.CASCADE,
        related_name='deals',
    )
    owner = models.ForeignKey(
        'participants.Participant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='owned_deals',
    )
    package = models.ForeignKey(
        SponsorshipPackage,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deals',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='lead')
    cash_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0.00'))],
    )
    in_kind_value = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0.00'))],
    )
    in_kind_description = models.TextField(blank=True)
    currency = models.CharField(max_length=10, default='EUR')
    probability_percent = models.IntegerField(
        default=10,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    signed_at = models.DateField(null=True, blank=True)
    lost_reason = models.TextField(blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['event', 'sponsor'], name='uniq_deal_event_sponsor'),
        ]

    def __str__(self):
        return f'{self.sponsor} / {self.event}'


class SponsorshipActivity(UUIDTimestampedModel):
    ACTION_CHOICES = [
        ('created', 'Created'),
        ('status_changed', 'Status changed'),
        ('amount_changed', 'Amount changed'),
        ('owner_changed', 'Owner changed'),
        ('note', 'Note'),
        ('portal_link_sent', 'Portal link sent'),
        ('asset_submitted', 'Asset submitted'),
        ('payment_updated', 'Payment updated'),
    ]

    deal = models.ForeignKey(
        SponsorshipDeal,
        on_delete=models.CASCADE,
        related_name='activities',
    )
    actor = models.ForeignKey(
        'participants.Participant',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sponsorship_activities',
    )
    action = models.CharField(max_length=30, choices=ACTION_CHOICES)
    from_status = models.CharField(max_length=20, blank=True)
    to_status = models.CharField(max_length=20, blank=True)
    message = models.TextField(blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.action} ({self.deal_id})'


class SponsorDeliverable(UUIDTimestampedModel):
    TYPE_CHOICES = [
        ('logo_placement', 'Logo placement'),
        ('booth', 'Booth'),
        ('speaking_slot', 'Speaking slot'),
        ('naming', 'Naming'),
        ('social_post', 'Social post'),
        ('goodies', 'Goodies'),
        ('attendee_data', 'Attendee data'),
        ('other', 'Other'),
    ]
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('in_progress', 'In progress'),
        ('delivered', 'Delivered'),
        ('at_risk', 'At risk'),
    ]

    deal = models.ForeignKey(
        SponsorshipDeal,
        on_delete=models.CASCADE,
        related_name='deliverables',
    )
    title = models.CharField(max_length=255)
    deliverable_type = models.CharField(max_length=30, choices=TYPE_CHOICES, default='other')
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    schedule_item = models.ForeignKey(
        'events.EventScheduleItem',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sponsor_deliverables',
    )
    resource = models.ForeignKey(
        'events.Resource',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='sponsor_deliverables',
    )
    asset_url = models.URLField(blank=True)
    delivered_at = models.DateField(null=True, blank=True)

    def __str__(self):
        return self.title


class SponsorPayment(UUIDTimestampedModel):
    STATUS_CHOICES = [
        ('planned', 'Planned'),
        ('invoiced', 'Invoiced'),
        ('paid', 'Paid'),
        ('overdue', 'Overdue'),
    ]

    deal = models.ForeignKey(
        SponsorshipDeal,
        on_delete=models.CASCADE,
        related_name='payments',
    )
    label = models.CharField(max_length=255)
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0.00'))],
    )
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='planned')
    invoice_ref = models.CharField(max_length=100, blank=True)
    paid_at = models.DateField(null=True, blank=True)

    def __str__(self):
        return self.label


class SponsorFitEvaluation(UUIDTimestampedModel):
    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='sponsor_fit_evaluations',
    )
    sponsor = models.ForeignKey(
        Sponsor,
        on_delete=models.CASCADE,
        related_name='fit_evaluations',
    )
    fit_score = models.IntegerField(
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    audience_match_count = models.IntegerField(default=0)
    industry_match = models.BooleanField(default=False)
    budget_fit = models.BooleanField(default=False)
    estimated_roi = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )
    hard_constraint_failures = models.JSONField(default=list, blank=True)
    breakdown = models.JSONField(default=list, blank=True)
    explanation = models.TextField(blank=True)
    evaluated_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.sponsor} @ {self.event} ({self.fit_score})'
