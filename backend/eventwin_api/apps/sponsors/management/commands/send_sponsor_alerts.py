import json
import os
import urllib.request

from django.core.management.base import BaseCommand
from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone

from apps.sponsors.services import alerts_webhook_payload, refresh_overdue_payments


class Command(BaseCommand):
    help = (
        'Envoie les alertes de sponsoring vers le webhook SPONSORS_WEBHOOK_URL (compatible n8n). '
        "Sans variable d'environnement, les alertes sont seulement affichées."
    )

    def handle(self, *args, **options):
        refresh_overdue_payments()
        events = alerts_webhook_payload()
        if not events:
            self.stdout.write('Aucune alerte à envoyer.')
            return
        total = sum(len(e['alerts']) for e in events)
        url = os.getenv('SPONSORS_WEBHOOK_URL', '').strip()
        if not url:
            self.stdout.write(f'{total} alerte(s) détectée(s). SPONSORS_WEBHOOK_URL non défini : aucun envoi.')
            for event in events:
                for alert in event['alerts']:
                    self.stdout.write(f"  [{alert['severity']}] {event['event_name']} : {alert['message']}")
            return
        body = json.dumps(
            {'source': 'eventtwin-sponsors', 'generated_at': timezone.now(), 'events': events},
            cls=DjangoJSONEncoder,
        ).encode('utf-8')
        request = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                self.stdout.write(self.style.SUCCESS(f'{total} alerte(s) envoyée(s) (HTTP {response.status}).'))
        except Exception as exc:  # noqa: BLE001 - un webhook indisponible ne doit pas faire échouer le cron
            self.stderr.write(self.style.ERROR(f"Échec de l'envoi du webhook : {exc}"))
