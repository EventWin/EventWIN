from datetime import timedelta
from decimal import Decimal

from rest_framework import serializers

from .models import (
    DEAL_STATUS_DEFAULT_PROBABILITY,
    Sponsor,
    SponsorDeliverable,
    SponsorFitEvaluation,
    SponsorPayment,
    SponsorshipActivity,
    SponsorshipDeal,
    SponsorshipPackage,
)


def _non_negative(value, field_name):
    if value is None:
        return
    if Decimal(str(value)) < 0:
        raise serializers.ValidationError({field_name: 'Le montant doit être supérieur ou égal à 0.'})


class SponsorSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Sponsor
        fields = [
            'id',
            'organization',
            'created_by',
            'created_by_name',
            'name',
            'legal_name',
            'industry',
            'website',
            'logo_url',
            'contact_name',
            'contact_email',
            'contact_phone',
            'country',
            'relationship_status',
            'notes',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'created_by']

    def get_created_by_name(self, obj):
        if obj.created_by and obj.created_by.user:
            return obj.created_by.user.username
        return ''


class SponsorshipPackageSerializer(serializers.ModelSerializer):
    class Meta:
        model = SponsorshipPackage
        fields = [
            'id',
            'event',
            'name',
            'tier_rank',
            'price',
            'slots_total',
            'exclusive_industry',
            'visibility_weight',
            'description',
            'benefits',
            'active',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate_slots_total(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Le nombre de places doit être supérieur ou égal à 0.')
        return value

    def validate_price(self, value):
        _non_negative(value, 'price')
        return value

    def validate_benefits(self, value):
        if value in (None, ''):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError('Les contreparties doivent être une liste.')
        return value


class SponsorshipDealSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    deliverables_done = serializers.SerializerMethodField()
    deliverables_total = serializers.SerializerMethodField()
    paid_amount = serializers.SerializerMethodField()

    class Meta:
        model = SponsorshipDeal
        fields = [
            'id',
            'event',
            'sponsor',
            'owner',
            'owner_name',
            'created_by_name',
            'package',
            'status',
            'cash_amount',
            'in_kind_value',
            'in_kind_description',
            'currency',
            'probability_percent',
            'signed_at',
            'lost_reason',
            'notes',
            'deliverables_done',
            'deliverables_total',
            'paid_amount',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_owner_name(self, obj):
        if obj.owner and obj.owner.user:
            return obj.owner.user.username
        return ''

    def get_created_by_name(self, obj):
        return self.get_owner_name(obj)

    def get_deliverables_done(self, obj):
        deliverables = getattr(obj, '_prefetched_objects_cache', {}).get('deliverables')
        if deliverables is not None:
            return sum(1 for item in deliverables if item.status == 'delivered')
        return obj.deliverables.filter(status='delivered').count()

    def get_deliverables_total(self, obj):
        deliverables = getattr(obj, '_prefetched_objects_cache', {}).get('deliverables')
        if deliverables is not None:
            return len(deliverables)
        return obj.deliverables.count()

    def get_paid_amount(self, obj):
        payments = getattr(obj, '_prefetched_objects_cache', {}).get('payments')
        if payments is not None:
            total = sum((p.amount for p in payments if p.status == 'paid'), Decimal('0.00'))
            return str(total)
        from django.db.models import Sum
        total = obj.payments.filter(status='paid').aggregate(total=Sum('amount'))['total']
        return str(total or Decimal('0.00'))

    def validate_probability_percent(self, value):
        if value is not None and (value < 0 or value > 100):
            raise serializers.ValidationError('La probabilité doit être comprise entre 0 et 100.')
        return value

    def validate_cash_amount(self, value):
        _non_negative(value, 'cash_amount')
        return value

    def validate_in_kind_value(self, value):
        _non_negative(value, 'in_kind_value')
        return value

    def validate(self, attrs):
        event = attrs.get('event') or getattr(self.instance, 'event', None)
        sponsor = attrs.get('sponsor') or getattr(self.instance, 'sponsor', None)
        if event and sponsor and sponsor.organization_id != event.organization_id:
            raise serializers.ValidationError({
                'sponsor': "Le sponsor n'appartient pas à l'organisation de l'événement.",
            })
        status_value = attrs.get('status', getattr(self.instance, 'status', 'lead'))
        signed_at = attrs.get('signed_at', getattr(self.instance, 'signed_at', None))
        if status_value in ('signed', 'paid') and not signed_at:
            raise serializers.ValidationError({
                'signed_at': 'La date de signature est obligatoire pour un deal signé ou payé.',
            })
        if self.instance is None and 'probability_percent' not in attrs:
            attrs['probability_percent'] = DEAL_STATUS_DEFAULT_PROBABILITY.get(status_value, 10)
        return attrs


class SponsorshipActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = SponsorshipActivity
        fields = [
            'id',
            'deal',
            'actor',
            'action',
            'from_status',
            'to_status',
            'message',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class SponsorDeliverableSerializer(serializers.ModelSerializer):
    warnings = serializers.SerializerMethodField()

    class Meta:
        model = SponsorDeliverable
        fields = [
            'id',
            'deal',
            'title',
            'deliverable_type',
            'due_date',
            'status',
            'schedule_item',
            'resource',
            'asset_url',
            'delivered_at',
            'warnings',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_warnings(self, obj):
        return getattr(obj, '_warnings', [])

    def validate(self, attrs):
        warnings = []
        deal = attrs.get('deal') or getattr(self.instance, 'deal', None)
        due = attrs.get('due_date', getattr(self.instance, 'due_date', None))
        event = deal.event if deal is not None else None
        if event and event.start_date and due:
            earliest = event.start_date - timedelta(days=90)
            if due < earliest:
                warnings.append(
                    "L'échéance est antérieure à 90 jours avant le début de l'événement "
                    f'({event.start_date}).'
                )
        attrs['_warnings'] = warnings
        return attrs

    def create(self, validated_data):
        warnings = validated_data.pop('_warnings', [])
        instance = super().create(validated_data)
        instance._warnings = warnings
        return instance

    def update(self, instance, validated_data):
        warnings = validated_data.pop('_warnings', [])
        instance = super().update(instance, validated_data)
        instance._warnings = warnings
        return instance


class SponsorPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SponsorPayment
        fields = [
            'id',
            'deal',
            'label',
            'amount',
            'due_date',
            'status',
            'invoice_ref',
            'paid_at',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate_amount(self, value):
        _non_negative(value, 'amount')
        return value


class SponsorFitEvaluationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SponsorFitEvaluation
        fields = [
            'id',
            'event',
            'sponsor',
            'fit_score',
            'audience_match_count',
            'industry_match',
            'budget_fit',
            'estimated_roi',
            'hard_constraint_failures',
            'explanation',
            'evaluated_at',
            'created_at',
        ]
        read_only_fields = ['id', 'evaluated_at', 'created_at']
