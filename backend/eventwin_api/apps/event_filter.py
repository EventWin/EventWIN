class EventFilterMixin:
    """Lets list endpoints be scoped to one event with ?event=<uuid>."""

    event_lookup = 'event'

    def get_queryset(self):
        queryset = super().get_queryset()
        event_id = self.request.query_params.get('event')
        if event_id:
            queryset = queryset.filter(**{self.event_lookup: event_id})
        return queryset
