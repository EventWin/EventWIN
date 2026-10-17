from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    SponsorDeliverableViewSet,
    SponsorFitEvaluateView,
    SponsorFitEvaluationViewSet,
    SponsorPaymentViewSet,
    SponsorPortalAssetView,
    SponsorPortalView,
    SponsorViewSet,
    SponsorshipActivityViewSet,
    SponsorshipAlertsView,
    SponsorshipConflictsView,
    SponsorshipDealViewSet,
    SponsorshipNetBudgetView,
    SponsorshipPackageViewSet,
    SponsorshipRecommendationsView,
    SponsorshipScenarioImpactView,
    SponsorshipSummaryView,
)


router = DefaultRouter()
router.register(r'sponsors', SponsorViewSet, basename='sponsor')
router.register(r'sponsorship-packages', SponsorshipPackageViewSet, basename='sponsorship-package')
router.register(r'sponsorship-deals', SponsorshipDealViewSet, basename='sponsorship-deal')
router.register(r'sponsorship-activities', SponsorshipActivityViewSet, basename='sponsorship-activity')
router.register(r'sponsor-deliverables', SponsorDeliverableViewSet, basename='sponsor-deliverable')
router.register(r'sponsor-payments', SponsorPaymentViewSet, basename='sponsor-payment')
router.register(r'sponsor-fit-evaluations', SponsorFitEvaluationViewSet, basename='sponsor-fit-evaluation')

urlpatterns = [
    path('sponsorship-summary/', SponsorshipSummaryView.as_view(), name='sponsorship-summary'),
    path('sponsorship-recommendations/', SponsorshipRecommendationsView.as_view(), name='sponsorship-recommendations'),
    path('sponsorship-conflicts/', SponsorshipConflictsView.as_view(), name='sponsorship-conflicts'),
    path('sponsorship-alerts/', SponsorshipAlertsView.as_view(), name='sponsorship-alerts'),
    path('sponsorship-net-budget/', SponsorshipNetBudgetView.as_view(), name='sponsorship-net-budget'),
    path('sponsorship-scenario-impact/', SponsorshipScenarioImpactView.as_view(), name='sponsorship-scenario-impact'),
    path('sponsor-fit/evaluate/', SponsorFitEvaluateView.as_view(), name='sponsor-fit-evaluate'),
    path('sponsor-portal/<str:token>/', SponsorPortalView.as_view(), name='sponsor-portal'),
    path(
        'sponsor-portal/<str:token>/deliverables/<uuid:deliverable_id>/submit-asset/',
        SponsorPortalAssetView.as_view(),
        name='sponsor-portal-submit-asset',
    ),
] + router.urls
