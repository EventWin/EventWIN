from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError

from apps.events.models import Event
from apps.participants.models import Participant
from apps.sponsors import services
from apps.sponsors.models import Sponsor, SponsorDeliverable, SponsorshipActivity, SponsorshipDeal, SponsorshipPackage

PACKAGES = [
    {'name': 'Or', 'tier_rank': 1, 'price': '8000', 'slots_total': 2, 'exclusive_industry': True, 'visibility_weight': '2.00',
     'description': 'Visibilité maximale.', 'benefits': [
         {'type': 'naming', 'title': 'Naming de la soirée', 'offset_days': 0},
         {'type': 'speaking_slot', 'title': 'Prise de parole de 10 minutes', 'offset_days': 0},
         {'type': 'logo_placement', 'title': 'Logo sur tous les supports', 'offset_days': -21}]},
    {'name': 'Argent', 'tier_rank': 2, 'price': '4000', 'slots_total': 4, 'exclusive_industry': False, 'visibility_weight': '1.20',
     'description': 'Présence sur site.', 'benefits': [
         {'type': 'booth', 'title': 'Stand de 6 m²', 'offset_days': 0},
         {'type': 'logo_placement', 'title': 'Logo sur le site web', 'offset_days': -14}]},
    {'name': 'Bronze', 'tier_rank': 3, 'price': '1500', 'slots_total': 6, 'exclusive_industry': False, 'visibility_weight': '1.00',
     'description': 'Soutien visible.', 'benefits': [
         {'type': 'social_post', 'title': 'Publication remerciement', 'offset_days': 7},
         {'type': 'goodies', 'title': 'Goodies dans le sac participant', 'offset_days': -3}]},
]

SPONSORS = [
    ('Banque Horizon', 'finance', 'Claire Martin', 'France'),
    ('NovaTech Solutions', 'tech', 'Ahmed Benali', 'France'),
    ('Maison Dupont Traiteur', 'food_beverage', 'Luc Dupont', 'France'),
    ('AutoNord', 'automotive', 'Sophie Leroy', 'Belgique'),
    ('Lumière Média', 'media', 'Inès Garcia', 'France'),
    ('GreenWatt Énergie', 'energy', 'Paul Verdier', 'France'),
    ('Santé+ Labs', 'health', 'Dr Nadia Roy', 'France'),
    ('Boutique Alma', 'retail', 'Alma Costa', 'Portugal'),
]

# (sponsor, package, cash, parcours de statuts, probabilité finale éventuelle)
DEALS = [
    ('Banque Horizon', 'Or', '8000', ['contacted', 'proposal_sent', 'negotiating', 'signed'], None),
    ('NovaTech Solutions', 'Argent', '4000', ['contacted', 'proposal_sent', 'negotiating', 'signed', 'paid'], None),
    ('Maison Dupont Traiteur', 'Bronze', '1500', ['contacted', 'proposal_sent', 'negotiating'], 60),
    ('AutoNord', 'Or', '8000', ['contacted', 'proposal_sent'], 40),
    ('Lumière Média', 'Argent', '4000', ['contacted'], 25),
    ('GreenWatt Énergie', None, '2500', ['contacted', 'lost'], None),
]


class Command(BaseCommand):
    help = "Crée des données de démonstration de sponsoring (idempotent) sur un événement existant."

    def add_arguments(self, parser):
        parser.add_argument('--event', help="UUID de l'événement (par défaut : le premier événement d'une organisation avec organisateur).")

    def handle(self, *args, **options):
        organizer = (
            Participant.objects.filter(role='organizer', organization__isnull=False).select_related('organization').first()
            or Participant.objects.filter(role='admin', organization__isnull=False).select_related('organization').first()
        )
        if organizer is None:
            raise CommandError("Aucun organisateur rattaché à une organisation : créez-en un d'abord.")
        organization = organizer.organization
        events = Event.objects.filter(organization=organization)
        event = events.filter(pk=options['event']).first() if options.get('event') else events.order_by('start_date').first()
        if event is None:
            raise CommandError("Aucun événement trouvé pour l'organisation de l'organisateur.")

        packages = {}
        for spec in PACKAGES:
            package, _ = SponsorshipPackage.objects.get_or_create(
                event=event, name=spec['name'],
                defaults={
                    'tier_rank': spec['tier_rank'], 'price': Decimal(spec['price']), 'slots_total': spec['slots_total'],
                    'exclusive_industry': spec['exclusive_industry'], 'visibility_weight': Decimal(spec['visibility_weight']),
                    'description': spec['description'], 'benefits': spec['benefits'],
                },
            )
            packages[spec['name']] = package

        sponsors = {}
        for name, industry, contact, country in SPONSORS:
            slug = ''.join(c for c in name.lower() if c.isalnum())
            sponsor, _ = Sponsor.objects.get_or_create(
                organization=organization, name=name,
                defaults={
                    'industry': industry, 'contact_name': contact, 'contact_email': f'contact@{slug}.example',
                    'website': f'https://www.{slug}.example', 'country': country, 'created_by': organizer,
                    'relationship_status': 'prospect',
                },
            )
            sponsors[name] = sponsor

        created = 0
        for name, package_name, cash, path, probability in DEALS:
            sponsor = sponsors[name]
            if SponsorshipDeal.objects.filter(event=event, sponsor=sponsor).exists():
                continue
            deal = SponsorshipDeal.objects.create(
                event=event, sponsor=sponsor, owner=organizer, package=packages.get(package_name),
                cash_amount=Decimal(cash), status='lead', probability_percent=10,
            )
            services.log_activity(deal, organizer, 'created', message='Dossier créé (démo)', to_status='lead')
            for step in path:
                kwargs = {}
                if step == 'lost':
                    kwargs['lost_reason'] = 'Budget marketing gelé cette année'
                services.transition_deal(deal, step, actor=organizer, **kwargs)
            if probability is not None:
                deal.probability_percent = probability
                deal.save(update_fields=['probability_percent'])
            if deal.status in ('signed', 'paid'):
                first = deal.deliverables.order_by('title').first()
                if first:
                    first.status = 'delivered'
                    first.delivered_at = date.today()
                    first.save(update_fields=['status', 'delivered_at'])
            created += 1
        for sponsor in Sponsor.objects.filter(organization=organization, deals__status__in=('signed', 'paid')).distinct():
            Sponsor.objects.filter(pk=sponsor.pk).update(relationship_status='active')
        self.stdout.write(self.style.SUCCESS(
            f'Démo sponsors prête sur « {event.name} » : {created} deal(s) créé(s), {len(sponsors)} sponsors, {len(packages)} packages.'
        ))
