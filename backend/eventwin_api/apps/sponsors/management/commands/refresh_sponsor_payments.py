from django.core.management.base import BaseCommand

from apps.sponsors.services import refresh_overdue_payments


class Command(BaseCommand):
    help = "Passe en « overdue » les paiements sponsors non réglés dont l'échéance est dépassée."

    def handle(self, *args, **options):
        count = refresh_overdue_payments()
        self.stdout.write(self.style.SUCCESS(f'{count} paiement(s) passé(s) en retard.'))
