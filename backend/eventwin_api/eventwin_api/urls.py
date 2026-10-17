from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def healthcheck(request):
    return JsonResponse({'status': 'ok', 'service': 'eventwin-api'})


def home(request):
    return JsonResponse(
        {
            'status': 'ok',
            'service': 'eventwin-api',
            'message': 'EventTwin API is running',
            'health': '/api/health/',
        }
    )


urlpatterns = [
    path('admin/', admin.site.urls),
    path('', home, name='home'),
    path('api/health/', healthcheck, name='healthcheck'),
    path('api/', include('apps.organizations.urls')),
    path('api/', include('apps.events.urls')),
    path('api/', include('apps.participants.urls')),
    path('api/', include('apps.budgets.urls')),
    path('api/', include('apps.simulation.urls')),
    path('api/', include('apps.transport.urls')),
    path('api/', include('apps.sponsors.urls')),
]
