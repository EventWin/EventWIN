from rest_framework.routers import DefaultRouter

from .views import (
    SponsorDeliverableViewSet,
    SponsorFitEvaluationViewSet,
    SponsorPaymentViewSet,
    SponsorViewSet,
    SponsorshipActivityViewSet,
    SponsorshipDealViewSet,
    SponsorshipPackageViewSet,
)


router = DefaultRouter()
router.register(r'sponsors', SponsorViewSet, basename='sponsor')
router.register(r'sponsorship-packages', SponsorshipPackageViewSet, basename='sponsorship-package')
router.register(r'sponsorship-deals', SponsorshipDealViewSet, basename='sponsorship-deal')
router.register(r'sponsorship-activities', SponsorshipActivityViewSet, basename='sponsorship-activity')
router.register(r'sponsor-deliverables', SponsorDeliverableViewSet, basename='sponsor-deliverable')
router.register(r'sponsor-payments', SponsorPaymentViewSet, basename='sponsor-payment')
router.register(r'sponsor-fit-evaluations', SponsorFitEvaluationViewSet, basename='sponsor-fit-evaluation')

urlpatterns = router.urls
