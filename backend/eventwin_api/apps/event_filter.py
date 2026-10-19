import uuid


class EventFilterMixin:
    """Lets list endpoints be scoped to one event with ?event=<uuid>.

    Un identifiant illisible produit une liste **vide**, jamais une erreur 500 :
    ``ModelSerializer``/``QuerySet.filter()`` lèvent une ``ValidationError``
    UUID qui traverserait DRF. C'est le même comportement que
    ``BudgetItemViewSet.get_queryset``.
    """

    event_lookup = 'event'

    def get_queryset(self):
        queryset = super().get_queryset()
        event_id = self.request.query_params.get(self.event_lookup)
        if event_id:
            try:
                parsed = uuid.UUID(str(event_id))
            except (ValueError, TypeError, AttributeError):
                # Requête malformée (ex. ``?event=None``) : aucun résultat,
                # aucune 500.
                return queryset.none()
            queryset = queryset.filter(**{self.event_lookup: parsed})
        return queryset
