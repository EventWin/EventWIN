from rest_framework import status, viewsets
from rest_framework.response import Response

from apps.event_filter import EventFilterMixin

from .models import (
    Sponsor,
    SponsorDeliverable,
    SponsorFitEvaluation,
    SponsorPayment,
    SponsorshipActivity,
    SponsorshipDeal,
    SponsorshipPackage,
)
from .permissions import (
    IsOrganizerOrAdmin,
    OrganizationScopedMixin,
    get_acting_participant,
    is_admin,
)
from .serializers import (
    SponsorDeliverableSerializer,
    SponsorFitEvaluationSerializer,
    SponsorPaymentSerializer,
    SponsorSerializer,
    SponsorshipActivitySerializer,
    SponsorshipDealSerializer,
    SponsorshipPackageSerializer,
)
from .services import find_duplicate_sponsors, log_activity


class SponsorViewSet(OrganizationScopedMixin, EventFilterMixin, viewsets.ModelViewSet):
    permission_classes = [IsOrganizerOrAdmin]
    organization_lookup = 'organization'
    event_lookup = 'deals__event'
    queryset = (
        Sponsor.objects
        .select_related('organization', 'created_by', 'created_by__user')
        .all()
        .order_by('name')
    )
    serializer_class = SponsorSerializer

    def get_serializer(self, *args, **kwargs):
        serializer = super().get_serializer(*args, **kwargs)
        actor = get_acting_participant(self.request)
        if actor is not None and not is_admin(actor) and 'organization' in serializer.fields:
            serializer.fields['organization'].read_only = True
        return serializer

    def create(self, request, *args, **kwargs):
        actor = get_acting_participant(request)
        force = str(request.query_params.get('force', '')).lower() in ('1', 'true', 'yes')
        extra_org = None
        if is_admin(actor) and request.data.get('organization'):
            extra_org = request.data.get('organization')
        organization = self.organization_for_create(extra_organization=extra_org)
        if not force:
            duplicates = find_duplicate_sponsors(
                organization,
                request.data.get('name', ''),
                request.data.get('website', ''),
            )
            if duplicates:
                return Response(
                    {'duplicates': SponsorSerializer(duplicates, many=True).data},
                    status=status.HTTP_409_CONFLICT,
                )
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        actor = get_acting_participant(self.request)
        extra_org = serializer.validated_data.get('organization') if is_admin(actor) else None
        organization = self.organization_for_create(extra_organization=extra_org)
        serializer.save(created_by=actor, organization=organization)


class SponsorshipPackageViewSet(OrganizationScopedMixin, EventFilterMixin, viewsets.ModelViewSet):
    permission_classes = [IsOrganizerOrAdmin]
    organization_lookup = 'event__organization'
    queryset = (
        SponsorshipPackage.objects
        .select_related('event', 'event__organization')
        .all()
        .order_by('tier_rank', 'name')
    )
    serializer_class = SponsorshipPackageSerializer


class SponsorshipDealViewSet(OrganizationScopedMixin, EventFilterMixin, viewsets.ModelViewSet):
    permission_classes = [IsOrganizerOrAdmin]
    organization_lookup = 'event__organization'
    queryset = (
        SponsorshipDeal.objects
        .select_related(
            'event',
            'event__organization',
            'sponsor',
            'owner',
            'owner__user',
            'package',
        )
        .prefetch_related('deliverables', 'payments')
        .all()
        .order_by('-created_at')
    )
    serializer_class = SponsorshipDealSerializer

    def perform_create(self, serializer):
        actor = get_acting_participant(self.request)
        owner = serializer.validated_data.get('owner') or actor
        deal = serializer.save(owner=owner)
        log_activity(deal, actor, 'created', message='Dossier créé', to_status=deal.status)


class SponsorshipActivityViewSet(OrganizationScopedMixin, EventFilterMixin, viewsets.ModelViewSet):
    permission_classes = [IsOrganizerOrAdmin]
    organization_lookup = 'deal__event__organization'
    event_lookup = 'deal__event'
    http_method_names = ['get', 'post', 'head', 'options']
    queryset = (
        SponsorshipActivity.objects
        .select_related('deal', 'deal__event', 'actor')
        .all()
        .order_by('-created_at')
    )
    serializer_class = SponsorshipActivitySerializer

    def perform_create(self, serializer):
        actor = get_acting_participant(self.request)
        if serializer.validated_data.get('actor') is None:
            serializer.save(actor=actor)
        else:
            serializer.save()


class SponsorDeliverableViewSet(OrganizationScopedMixin, EventFilterMixin, viewsets.ModelViewSet):
    permission_classes = [IsOrganizerOrAdmin]
    organization_lookup = 'deal__event__organization'
    event_lookup = 'deal__event'
    queryset = (
        SponsorDeliverable.objects
        .select_related('deal', 'deal__event', 'schedule_item', 'resource')
        .all()
        .order_by('due_date', 'title')
    )
    serializer_class = SponsorDeliverableSerializer


class SponsorPaymentViewSet(OrganizationScopedMixin, EventFilterMixin, viewsets.ModelViewSet):
    permission_classes = [IsOrganizerOrAdmin]
    organization_lookup = 'deal__event__organization'
    event_lookup = 'deal__event'
    queryset = (
        SponsorPayment.objects
        .select_related('deal', 'deal__event')
        .all()
        .order_by('due_date', 'label')
    )
    serializer_class = SponsorPaymentSerializer


class SponsorFitEvaluationViewSet(OrganizationScopedMixin, EventFilterMixin, viewsets.ModelViewSet):
    permission_classes = [IsOrganizerOrAdmin]
    organization_lookup = 'event__organization'
    queryset = (
        SponsorFitEvaluation.objects
        .select_related('event', 'sponsor')
        .all()
        .order_by('-evaluated_at')
    )
    serializer_class = SponsorFitEvaluationSerializer
