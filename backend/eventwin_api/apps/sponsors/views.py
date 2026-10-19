import json
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.http import HttpResponse
from django.utils.text import slugify
from rest_framework import status, viewsets

from apps.participants.models import display_name
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from apps.event_filter import EventFilterMixin
from apps.participants.models import Participant

from . import services
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
    as_participant,
    get_acting_participant,
    is_admin,
    is_organizer_or_admin,
    scoped_event_or_error,
    scoped_scenario_or_error,
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

MAX_IMPORT_BYTES = 2 * 1024 * 1024


def _truthy(value):
    return str(value or '').lower() in ('1', 'true', 'yes')


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
        target = getattr(serializer, 'child', serializer)  # ListSerializer when many=True
        actor = get_acting_participant(self.request)
        if actor is not None and not is_admin(actor) and 'organization' in target.fields:
            target.fields['organization'].read_only = True
        return serializer

    def create(self, request, *args, **kwargs):
        actor = get_acting_participant(request)
        force = _truthy(request.query_params.get('force'))
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
        serializer.save(created_by=as_participant(actor), organization=organization)

    @action(detail=False, methods=['post'], url_path='quick-create')
    def quick_create(self, request):
        """Crée un sponsor et, si demandé, son deal en une seule transaction."""
        actor = get_acting_participant(request)
        sponsor_data = dict(request.data.get('sponsor') or {})
        deal_data = request.data.get('deal') or None
        if not sponsor_data:
            raise ValidationError({'sponsor': 'Les informations du sponsor sont obligatoires.'})
        extra_org = sponsor_data.get('organization') if is_admin(actor) else None
        organization = self.organization_for_create(extra_organization=extra_org)

        if not _truthy(request.query_params.get('force')):
            duplicates = find_duplicate_sponsors(organization, sponsor_data.get('name', ''), sponsor_data.get('website', ''))
            if duplicates:
                return Response(
                    {'duplicates': SponsorSerializer(duplicates, many=True).data},
                    status=status.HTTP_409_CONFLICT,
                )
        if deal_data:
            event = scoped_event_or_error(request, deal_data.get('event'))
            if event.organization_id != organization.id:
                raise ValidationError({'deal': "L'événement n'appartient pas à l'organisation du sponsor."})

        sponsor_data['organization'] = str(organization.id)
        with transaction.atomic():
            sponsor_serializer = SponsorSerializer(data=sponsor_data, context=self.get_serializer_context())
            sponsor_serializer.is_valid(raise_exception=True)
            sponsor = sponsor_serializer.save(created_by=as_participant(actor), organization=organization)
            deal = None
            if deal_data:
                deal_serializer = SponsorshipDealSerializer(
                    data={**deal_data, 'sponsor': str(sponsor.id)}, context=self.get_serializer_context(),
                )
                deal_serializer.is_valid(raise_exception=True)
                deal = deal_serializer.save(owner=as_participant(actor))
                log_activity(deal, actor, 'created', message='Dossier créé', to_status=deal.status)
        return Response(
            {
                'sponsor': SponsorSerializer(sponsor).data,
                'deal': SponsorshipDealSerializer(deal).data if deal else None,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=['post'], url_path='import', parser_classes=[MultiPartParser, FormParser, JSONParser])
    def import_csv(self, request):
        """Import CSV : colonnes name, industry, contact_name, contact_email, website, country."""
        actor = get_acting_participant(request)
        extra_org = request.data.get('organization') if is_admin(actor) else None
        organization = self.organization_for_create(extra_organization=extra_org)
        upload = request.FILES.get('file')
        if upload is not None:
            if upload.size > MAX_IMPORT_BYTES:
                raise ValidationError({'file': 'Fichier trop volumineux (2 Mo maximum).'})
            raw = upload.read()
            try:
                text = raw.decode('utf-8-sig')
            except UnicodeDecodeError:
                text = raw.decode('latin-1')
        else:
            text = request.data.get('csv') or ''
        if not text.strip():
            raise ValidationError({'file': 'Aucun contenu CSV fourni.'})
        return Response(services.import_sponsors_csv(organization, actor, text))


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

    def destroy(self, request, *args, **kwargs):
        package = self.get_object()
        if package.deals.filter(status__in=services.COMMITTED_STATUSES).exists():
            raise ValidationError({'detail': 'Ce package a des deals signés : suppression impossible.'})
        return super().destroy(request, *args, **kwargs)


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

    def get_queryset(self):
        queryset = super().get_queryset()
        if _truthy(self.request.query_params.get('mine')):
            queryset = queryset.filter(owner=as_participant(get_acting_participant(self.request)))
        return queryset

    def perform_create(self, serializer):
        actor = get_acting_participant(self.request)
        owner = serializer.validated_data.get('owner') or as_participant(actor)
        deal = serializer.save(owner=owner)
        log_activity(deal, actor, 'created', message='Dossier créé', to_status=deal.status)

    def perform_update(self, serializer):
        instance = serializer.instance
        new_status = serializer.validated_data.get('status')
        if new_status is not None and new_status != instance.status:
            raise ValidationError({'status': 'Utilisez /transition/ pour changer le statut d\'un dossier.'})
        old_cash, old_owner = instance.cash_amount, instance.owner_id
        actor = get_acting_participant(self.request)
        deal = serializer.save()
        if deal.cash_amount != old_cash:
            log_activity(deal, actor, 'amount_changed', message=f'Montant : {old_cash} → {deal.cash_amount} {deal.currency}')
        if deal.owner_id != old_owner:
            log_activity(deal, actor, 'owner_changed', message='Responsable modifié')

    def _fresh(self, deal):
        return self.get_queryset().get(pk=deal.pk)

    @action(detail=True, methods=['post'])
    def transition(self, request, pk=None):
        deal = self.get_object()
        probability = request.data.get('probability_percent')
        if probability in ('', None):
            probability = None
        else:
            try:
                probability = int(probability)
            except (TypeError, ValueError):
                raise ValidationError({'probability_percent': 'Valeur invalide.'})
        try:
            services.transition_deal(
                deal,
                request.data.get('status'),
                actor=get_acting_participant(request),
                probability_percent=probability,
                lost_reason=request.data.get('lost_reason'),
            )
        except services.TransitionError as exc:
            return Response({'detail': exc.message, 'conflicts': exc.conflicts}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(self._fresh(deal)).data)

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        deal = self.get_object()
        actor = get_acting_participant(request)
        if not is_admin(actor) and deal.owner_id not in (None, actor.id):
            return Response({'detail': 'Seul le responsable actuel ou un admin peut réassigner ce dossier.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            new_owner = Participant.objects.filter(pk=request.data.get('owner')).select_related('user').first()
        except (ValueError, TypeError, Exception):  # identifiant invalide
            new_owner = None
        if new_owner is None or not is_organizer_or_admin(new_owner):
            raise ValidationError({'owner': 'Le nouveau responsable doit être un organisateur existant.'})
        if not is_admin(actor) and new_owner.organization_id != deal.event.organization_id:
            raise ValidationError({'owner': "Le responsable doit appartenir à l'organisation de l'événement."})
        deal.owner = new_owner
        deal.save(update_fields=['owner'])
        name = display_name(new_owner.user) if new_owner.user else str(new_owner.id)
        log_activity(deal, actor, 'owner_changed', message=f'Nouveau responsable : {name}')
        return Response(self.get_serializer(self._fresh(deal)).data)

    @action(detail=True, methods=['post'], url_path='portal-link')
    def portal_link(self, request, pk=None):
        deal = self.get_object()
        if deal.status not in services.COMMITTED_STATUSES:
            raise ValidationError({'detail': "Le portail n'est disponible qu'une fois le dossier signé."})
        token = services.make_portal_token(deal)
        link = services.portal_link(token)
        body = {
            'token': token,
            'url': link,
            'expires_in_days': services.portal_ttl_days(),
            'email_sent': False,
        }
        if _truthy(request.data.get('send_email')):
            try:
                recipient = services.send_portal_email(deal, link, to_email=request.data.get('to_email'))
                body.update(email_sent=True, sent_to=recipient)
                log_activity(deal, get_acting_participant(request), 'portal_link_sent', message=f'Lien envoyé à {recipient}')
            except services.PortalError as exc:
                raise ValidationError({'to_email': exc.message})
            except Exception as exc:  # noqa: BLE001 - SMTP indisponible : le lien reste utilisable
                body['email_error'] = f"L'envoi a échoué : {exc}"
        return Response(body)

    @action(detail=True, methods=['get'])
    def report(self, request, pk=None):
        return Response(services.deal_report(self.get_object()))

    @action(detail=True, methods=['get'], url_path='report-csv')
    def report_csv(self, request, pk=None):
        deal = self.get_object()
        response = HttpResponse('\ufeff' + services.deal_report_csv(deal), content_type='text/csv; charset=utf-8')
        filename = slugify(f'rapport-{deal.sponsor.name}-{deal.event.name}') or 'rapport-sponsor'
        response['Content-Disposition'] = f'attachment; filename="{filename}.csv"'
        return response


class SponsorshipActivityViewSet(OrganizationScopedMixin, EventFilterMixin, viewsets.ModelViewSet):
    permission_classes = [IsOrganizerOrAdmin]
    organization_lookup = 'deal__event__organization'
    event_lookup = 'deal__event'
    http_method_names = ['get', 'post', 'head', 'options']
    queryset = (
        SponsorshipActivity.objects
        .select_related("deal", "deal__event", "actor", "actor__user")
        .all()
        .order_by('-created_at')
    )
    serializer_class = SponsorshipActivitySerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        deal_id = self.request.query_params.get('deal')
        if deal_id:
            queryset = queryset.filter(deal_id=deal_id)
        return queryset

    def perform_create(self, serializer):
        actor = get_acting_participant(self.request)
        if serializer.validated_data.get('actor') is None:
            serializer.save(actor=as_participant(actor))
        else:
            serializer.save()


class SponsorDeliverableViewSet(OrganizationScopedMixin, EventFilterMixin, viewsets.ModelViewSet):
    permission_classes = [IsOrganizerOrAdmin]
    organization_lookup = 'deal__event__organization'
    event_lookup = 'deal__event'
    queryset = (
        SponsorDeliverable.objects
        .select_related('deal', 'deal__event', 'deal__sponsor', 'schedule_item', 'resource')
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
        .select_related('deal', 'deal__event', 'deal__sponsor')
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


# ---------------------------------------------------------------------------
# Endpoints d'analyse (lecture) : tous protégés et cloisonnés par organisation
# ---------------------------------------------------------------------------

class OrganizerAPIView(APIView):
    permission_classes = [IsOrganizerOrAdmin]


class SponsorshipSummaryView(OrganizerAPIView):
    def get(self, request):
        event = scoped_event_or_error(request, request.query_params.get('event'))
        return Response({
            'event': {'id': str(event.id), 'name': event.name, 'organization': str(event.organization_id)},
            'summary': services.pipeline_summary(event),
            'conflicts': services.detect_conflicts(event),
            'alerts': services.build_alerts(event),
        })


class SponsorshipRecommendationsView(OrganizerAPIView):
    def get(self, request):
        event = scoped_event_or_error(request, request.query_params.get('event'))
        gap = request.query_params.get('gap')
        if gap not in (None, ''):
            try:
                gap = Decimal(gap)
            except InvalidOperation:
                raise ValidationError({'gap': 'Montant invalide.'})
            if gap < 0:
                raise ValidationError({'gap': 'Le montant doit être positif.'})
        else:
            gap = None
        proposals = services.recommend_packages(event, gap=gap)
        return Response({
            'gap': gap if gap is not None else services.pipeline_summary(event)['funding_gap'],
            'proposals': proposals,
        })


class SponsorshipConflictsView(OrganizerAPIView):
    def get(self, request):
        event = scoped_event_or_error(request, request.query_params.get('event'))
        return Response(services.detect_conflicts(event))


class SponsorshipAlertsView(OrganizerAPIView):
    def get(self, request):
        event = scoped_event_or_error(request, request.query_params.get('event'))
        return Response(services.build_alerts(event))


class SponsorshipNetBudgetView(OrganizerAPIView):
    def get(self, request):
        event = scoped_event_or_error(request, request.query_params.get('event'))
        try:
            return Response(services.net_budget(event, budget_id=request.query_params.get('budget')))
        except Exception as exc:  # identifiant de budget invalide
            if exc.__class__.__name__ == 'ValidationError':
                raise ValidationError({'budget': 'Identifiant invalide.'})
            raise


class SponsorshipScenarioImpactView(OrganizerAPIView):
    def get(self, request):
        scenario = scoped_scenario_or_error(request, request.query_params.get('scenario'))
        include = _truthy(request.query_params.get('include_weighted'))
        return Response(services.sponsorship_impact_for_scenario(scenario, include_weighted=include))


class SponsorFitEvaluateView(OrganizerAPIView):
    def post(self, request):
        event = scoped_event_or_error(request, request.data.get('event'))
        sponsors = Sponsor.objects.filter(organization=event.organization).order_by('name')
        ids = request.data.get('sponsor_ids')
        if ids:
            if not isinstance(ids, list):
                raise ValidationError({'sponsor_ids': 'Une liste d\'identifiants est attendue.'})
            try:
                sponsors = sponsors.filter(pk__in=ids)
                list(sponsors[:0])
            except Exception:
                raise ValidationError({'sponsor_ids': 'Identifiants invalides.'})
        results = []
        for sponsor in sponsors:
            scored = services.score_sponsor_fit(event, sponsor)
            results.append({
                'evaluation_id': str(scored['evaluation'].id),
                'sponsor': str(sponsor.id),
                'sponsor_name': sponsor.name,
                'industry': sponsor.industry,
                'fit_score': scored['fit_score'],
                'audience_match_count': scored['audience_match_count'],
                'industry_match': scored['industry_match'],
                'budget_fit': scored['budget_fit'],
                'estimated_roi': scored['estimated_roi'],
                'hard_constraint_failures': scored['hard_constraint_failures'],
                'breakdown': scored['breakdown'],
                'explanation': scored['explanation'],
            })
        results.sort(key=lambda r: r['fit_score'], reverse=True)
        return Response(results)


# ---------------------------------------------------------------------------
# Portail sponsor : accès par jeton signé uniquement, sans compte
# ---------------------------------------------------------------------------

class PortalRateThrottle(AnonRateThrottle):
    scope = 'sponsor_portal'
    THROTTLE_RATES = {'sponsor_portal': '60/min'}


class PortalAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PortalRateThrottle]

    @staticmethod
    def error(exc):
        return Response({'detail': exc.message}, status=exc.status_code)


class SponsorPortalView(PortalAPIView):
    def get(self, request, token):
        try:
            deal = services.read_portal_token(token)
        except services.PortalError as exc:
            return self.error(exc)
        return Response(services.portal_payload(deal))


class SponsorPortalAssetView(PortalAPIView):
    def post(self, request, token, deliverable_id):
        try:
            deal = services.read_portal_token(token)
            services.submit_portal_asset(deal, deliverable_id, request.data.get('asset_url'))
        except services.PortalError as exc:
            return self.error(exc)
        return Response(services.portal_payload(deal))
