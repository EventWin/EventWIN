from django.urls import path
from rest_framework.routers import DefaultRouter

from .dashboard import dashboard
from .views import EventScheduleItemViewSet, EventViewSet, ResourceViewSet


router = DefaultRouter()
router.register(r'events', EventViewSet, basename='event')
router.register(r'event-schedule-items', EventScheduleItemViewSet, basename='event-schedule-item')
router.register(r'resources', ResourceViewSet, basename='resource')

urlpatterns = [
    path('dashboard/', dashboard, name='dashboard'),
] + router.urls
