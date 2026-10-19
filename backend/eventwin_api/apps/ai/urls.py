from django.urls import path

from . import views


urlpatterns = [
    path('ai/participant-fit/', views.participant_fit, name='participant-fit'),
    path('ai/participant-fit/options/', views.participant_fit_options, name='participant-fit-options'),
    path('ai/participant-fit/event/<uuid:event_id>/', views.event_participant_fit, name='event-participant-fit'),
]
