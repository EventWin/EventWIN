from django.contrib import admin
from django.urls import path
from django.http import JsonResponse


def healthcheck(request):
    return JsonResponse({'status': 'ok', 'service': 'eventwin-api'})


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', healthcheck, name='healthcheck'),
]
