from rest_framework import serializers

from .models import TransportAvailabilitySnapshot, TransportCatalogOption, TransportEvaluation


class TransportCatalogOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransportCatalogOption
        fields = [
            'id',
            'name',
            'mode',
            'provider_name',
            'operator_code',
            'seated_capacity',
            'standing_capacity',
            'wheelchair_spaces',
            'luggage_volume_litres',
            'accessible',
            'co2e_g_per_km_estimate',
            'active',
            'notes',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class TransportAvailabilitySnapshotSerializer(serializers.ModelSerializer):
    catalog_option_name = serializers.CharField(source='catalog_option.name', read_only=True)

    class Meta:
        model = TransportAvailabilitySnapshot
        fields = [
            'id',
            'event',
            'catalog_option',
            'catalog_option_name',
            'origin_label',
            'destination_label',
            'departure_at',
            'arrival_at',
            'available_seats',
            'occupancy_percentage',
            'capacity_status',
            'capacity_confidence',
            'reservation_required',
            'total_cost_estimate',
            'currency',
            'source_provider',
            'source_record_id',
            'valid_until',
            'raw_payload',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class TransportEvaluationSerializer(serializers.ModelSerializer):
    snapshot_capacity_status = serializers.CharField(source='snapshot.capacity_status', read_only=True)

    class Meta:
        model = TransportEvaluation
        fields = [
            'id',
            'event',
            'snapshot',
            'snapshot_capacity_status',
            'option_label',
            'feasible',
            'hard_constraint_failures',
            'estimated_total_cost',
            'estimated_arrival_reliability',
            'score',
            'explanation',
            'evaluated_at',
            'created_at',
        ]
        read_only_fields = ['id', 'evaluated_at', 'created_at']
