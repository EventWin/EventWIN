from rest_framework import viewsets

from apps.core.permissions import IsSuperAdminOrReadOnly

from .models import Organization
from .serializers import OrganizationSerializer


class OrganizationViewSet(viewsets.ModelViewSet):
    """Organisations : lecture pour les comptes authentifiés, écriture admin.

    La création d'événement rattache l'événement à l'organisation du profil :
    seuls les organisateurs concernés ont besoin de lire la liste.
    """

    queryset = Organization.objects.all().order_by('name')
    serializer_class = OrganizationSerializer
    permission_classes = [IsSuperAdminOrReadOnly]
