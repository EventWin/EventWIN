"""Jeu de données de démonstration : organisation, organisateur, événements et
participants aux profils volontairement contrastés.

Les profils reprennent le vocabulaire du questionnaire d'onboarding
(« Alimentaire », « Accessibilité », « Objectif », « Intérêt Tech »…) pour que
les données de démo ressemblent à celles saisies par de vrais participants.
Les événements sont choisis pour que l'adéquation participant ↔ événement
varie nettement d'un événement à l'autre (accessibilité, rythme, régime,
nuitées, ambiance…).

Idempotent : relancer la commande met à jour les mêmes objets sans doublon.

    python manage.py seed_demo            # crée / met à jour
    python manage.py seed_demo --reset    # supprime puis recrée la démo
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.events.models import Event, EventScheduleItem
from apps.organizations.models import Organization
from apps.participants.models import (
    EventParticipant,
    Participant,
    ParticipantConstraint,
    ParticipantPreference,
)

DEMO_ORG = 'EventWIN Démo'
DEMO_PASSWORD = 'Demo1234!'
DEMO_DOMAIN = 'demo.eventwin.local'
ORGANIZER = ('organisateur', 'Claire', 'Vasseur')


# --- Événements --------------------------------------------------------------
# Chaque créneau : (jour relatif, début, fin, titre, catégorie, lieu).
EVENTS = [
    {
        'name': 'Sommet IA & Data Paris',
        'event_type': 'conference', 'event_format': 'onsite',
        'objective': 'Veille technologique et partage de retours d’expérience IA',
        'audience_type': 'mixed', 'mobility_level': 'low',
        'accommodation_required': False, 'accessibility_level': 'enhanced',
        'location': 'Palais des Congrès, Paris',
        'start': date(2026, 11, 18), 'days': 2,
        'capacity': 400, 'target_budget': Decimal('85000'),
        'participant_target': 350, 'participant_expected': 320,
        'notes': (
            'Salles accessibles PMR (rampes, ascenseurs, boucles magnétiques). '
            'Accès métro/RER direct, gares Saint-Lazare et Montparnasse à 20 min. '
            'Buffet midi avec option végétarienne ; pas de menu halal ni sans '
            'gluten garanti. Conférences en français, deux sessions en anglais '
            'avec sous-titres. Places assises dans toutes les salles.'
        ),
        'schedule': [
            (0, '08:30', '09:00', 'Accueil café', 'accueil', 'Hall A'),
            (0, '09:00', '12:30', 'Keynotes IA générative', 'conference', 'Grand amphithéâtre'),
            (0, '14:00', '17:30', 'Ateliers techniques MLOps / data', 'atelier', 'Salles 2xx'),
            (0, '19:00', '22:00', 'Cocktail networking (open bar)', 'social', 'Terrasse'),
            (1, '09:00', '16:00', 'Retours d’expérience et tables rondes', 'conference', 'Grand amphithéâtre'),
        ],
    },
    {
        'name': 'Road Trip Alpes – Team Building',
        'event_type': 'road_trip', 'event_format': 'mobile',
        'objective': 'Cohésion d’équipe par le défi sportif en montagne',
        'audience_type': 'internal', 'mobility_level': 'high',
        'accommodation_required': True, 'accessibility_level': 'standard',
        'location': 'Annecy → Chamonix → Val d’Isère',
        'start': date(2026, 12, 7), 'days': 4,
        'capacity': 40, 'target_budget': Decimal('62000'),
        'participant_target': 36, 'participant_expected': 32,
        'notes': (
            'Départ en autocar de Lyon (3 h de route par jour). Randonnées '
            'quotidiennes de 10 à 14 km avec dénivelé, raquettes, via ferrata. '
            'Nuits en chalets et refuges, chambres partagées de 4 à 6, '
            'sanitaires communs. Cuisine savoyarde (raclette, fondue, '
            'charcuterie) ; adaptations alimentaires limitées en refuge. '
            'Soirées festives jusqu’à minuit. Non accessible en fauteuil.'
        ),
        'schedule': [
            (0, '07:30', '11:00', 'Trajet en car Lyon → Annecy', 'transport', 'Autocar'),
            (0, '13:00', '18:00', 'Randonnée lac d’Annecy (12 km)', 'sport', 'Semnoz'),
            (1, '08:00', '16:00', 'Via ferrata et raquettes', 'sport', 'Chamonix'),
            (2, '09:00', '17:00', 'Randonnée glaciaire (14 km)', 'sport', 'Val d’Isère'),
            (2, '20:00', '23:59', 'Soirée raclette et karaoké', 'social', 'Refuge'),
            (3, '09:00', '13:00', 'Retour en car', 'transport', 'Autocar'),
        ],
    },
    {
        'name': 'Retraite Bien-être Luberon',
        'event_type': 'retreat', 'event_format': 'onsite',
        'objective': 'Prévention du stress et réflexion stratégique au calme',
        'audience_type': 'internal', 'mobility_level': 'medium',
        'accommodation_required': True, 'accessibility_level': 'standard',
        'location': 'Domaine de la Bastide, Gordes',
        'start': date(2027, 1, 20), 'days': 3,
        'capacity': 25, 'target_budget': Decimal('38000'),
        'participant_target': 22, 'participant_expected': 20,
        'notes': (
            'Domaine isolé, navette depuis la gare d’Avignon TGV. Chambres '
            'individuelles. Cuisine végétarienne et vegan biologique, '
            'allergènes affichés, sans alcool. Yoga et méditation à 7 h, '
            'balades de 4 km en terrain vallonné. Déconnexion numérique '
            'encouragée, couvre-feu calme à 22 h. Rez-de-chaussée accessible, '
            'étages sans ascenseur.'
        ),
        'schedule': [
            (0, '14:00', '17:00', 'Arrivée et cercle d’ouverture', 'atelier', 'Salon'),
            (1, '07:00', '08:00', 'Yoga au lever du soleil', 'bien-etre', 'Terrasse'),
            (1, '10:00', '12:30', 'Atelier stratégie en petits groupes', 'atelier', 'Bibliothèque'),
            (1, '15:00', '17:00', 'Balade méditative (4 km)', 'bien-etre', 'Collines'),
            (2, '07:00', '08:00', 'Méditation guidée', 'bien-etre', 'Terrasse'),
            (2, '09:30', '12:00', 'Restitution et départ', 'atelier', 'Salon'),
        ],
    },
    {
        'name': 'Gala annuel des Partenaires',
        'event_type': 'gala', 'event_format': 'onsite',
        'objective': 'Remercier et fidéliser les partenaires clés',
        'audience_type': 'external', 'mobility_level': 'low',
        'accommodation_required': False, 'accessibility_level': 'standard',
        'location': 'Pavillon des Berges, Lyon',
        'start': date(2026, 12, 12), 'days': 1,
        'capacity': 220, 'target_budget': Decimal('120000'),
        'participant_target': 200, 'participant_expected': 190,
        'notes': (
            'Soirée de 19 h à 2 h, tenue de soirée exigée. Dîner assis : '
            'plateau de fruits de mer en entrée, filet de bœuf, menu '
            'végétarien sur demande préalable. Open bar champagne et cocktails. '
            'DJ et piste de danse, ambiance très festive et bruyante. Salle de '
            'plain-pied, pas de navette retour après 1 h. Discours en français.'
        ),
        'schedule': [
            (0, '19:00', '20:30', 'Cocktail d’accueil (champagne)', 'social', 'Hall'),
            (0, '20:30', '22:30', 'Dîner de gala et remise de trophées', 'repas', 'Grande salle'),
            (0, '22:30', '23:59', 'Soirée dansante DJ', 'social', 'Piste'),
        ],
    },
    {
        'name': 'Hackathon Climat 48h',
        'event_type': 'workshop', 'event_format': 'hybrid',
        'objective': 'Prototyper des solutions numériques pour la sobriété énergétique',
        'audience_type': 'mixed', 'mobility_level': 'low',
        'accommodation_required': False, 'accessibility_level': 'enhanced',
        'location': 'Halle 6, Nantes + participation à distance',
        'start': date(2027, 2, 5), 'days': 2,
        'capacity': 120, 'target_budget': Decimal('30000'),
        'participant_target': 100, 'participant_expected': 90,
        'notes': (
            'Format hybride : équipes sur place ou 100 % à distance '
            '(Discord + visio). Codage en continu sur 48 h, nuit sur place '
            'facultative (open space bruyant, salle de repos). Pizzas et '
            'snacks, pas de repas adaptés garantis. Jury en fin de 2e jour. '
            'Bâtiment accessible PMR. Mentors francophones et anglophones.'
        ),
        'schedule': [
            (0, '09:00', '10:00', 'Lancement et constitution des équipes', 'atelier', 'Halle 6 / Discord'),
            (0, '10:00', '23:59', 'Sprint de développement', 'atelier', 'Open space / à distance'),
            (1, '00:00', '15:00', 'Sprint de nuit et finalisation', 'atelier', 'Open space / à distance'),
            (1, '15:00', '18:00', 'Pitchs et délibération du jury', 'conference', 'Auditorium'),
        ],
    },
    {
        'name': 'Lancement Produit – Showroom Marseille',
        'event_type': 'product_launch', 'event_format': 'onsite',
        'objective': 'Présenter la nouvelle gamme à la presse et aux clients',
        'audience_type': 'external', 'mobility_level': 'medium',
        'accommodation_required': False, 'accessibility_level': 'standard',
        'location': 'Les Docks, Marseille',
        'start': date(2027, 3, 11), 'days': 1,
        'capacity': 150, 'target_budget': Decimal('45000'),
        'participant_target': 140, 'participant_expected': 120,
        'notes': (
            'Demi-journée : démonstrations sur stands, parcours debout de '
            '2 h dans le showroom (aucune assise prévue), cocktail dînatoire '
            'debout. Showroom à l’étage avec monte-charge uniquement. '
            'Présentation bilingue français / anglais. Gare Saint-Charles '
            'à 15 min en métro.'
        ),
        'schedule': [
            (0, '14:00', '15:00', 'Conférence de presse', 'conference', 'Auditorium'),
            (0, '15:00', '17:00', 'Parcours démonstrations (debout)', 'demo', 'Showroom'),
            (0, '17:00', '19:00', 'Cocktail dînatoire', 'social', 'Rooftop'),
        ],
    },
]


# --- Participants ------------------------------------------------------------
# constraints : (type, valeur, stricte ?) ; preferences : (type, valeur, poids).
PARTICIPANTS = [
    {
        'slug': 'camille.durand', 'first': 'Camille', 'last': 'Durand',
        'constraints': [
            ('Accessibilité', 'Fauteuil roulant manuel : accès de plain-pied ou ascenseur indispensable', True),
            ('Transport', 'Train uniquement (pas de car longue distance)', True),
        ],
        'preferences': [
            ('Objectif', 'Apprendre', 3), ('Format', 'Conférences et ateliers', 2),
            ('Intérêt Tech', '9/10', 3), ('Intérêt Social', '5/10', 1), ('Intérêt Sport', '2/10', 1),
            ('Ambiance', 'Studieuse', 2), ('Hébergement', 'Chambre individuelle adaptée PMR', 2),
        ],
    },
    {
        'slug': 'mehdi.benali', 'first': 'Mehdi', 'last': 'Benali',
        'constraints': [
            ('Alimentaire', 'Halal', True),
        ],
        'preferences': [
            ('Boisson', 'Sans alcool', 2), ('Objectif', 'Réseauter', 3),
            ('Intérêt Tech', '6/10', 1), ('Intérêt Social', '9/10', 3), ('Intérêt Sport', '7/10', 2),
            ('Ambiance', 'Festive', 2), ('Arrivée', 'Le jour même', 1),
        ],
    },
    {
        'slug': 'sophie.martin', 'first': 'Sophie', 'last': 'Martin',
        'constraints': [
            ('Disponibilité', 'Aucune nuit hors domicile (enfants en bas âge)', True),
            ('Horaires', 'Indisponible après 19 h en semaine', False),
        ],
        'preferences': [
            ('Objectif', 'Apprendre', 2), ('Format', 'À distance ou demi-journée', 3),
            ('Intérêt Tech', '8/10', 3), ('Intérêt Social', '4/10', 1), ('Intérêt Sport', '3/10', 1),
            ('Ambiance', 'Calme', 2),
        ],
    },
    {
        'slug': 'lucas.petit', 'first': 'Lucas', 'last': 'Petit',
        'constraints': [],
        'preferences': [
            ('Objectif', 'Cohésion d’équipe', 2), ('Intérêt Tech', '3/10', 1),
            ('Intérêt Social', '8/10', 2), ('Intérêt Sport', '10/10', 3),
            ('Ambiance', 'Aventure', 3), ('Hébergement', 'Chambre partagée OK', 1),
        ],
    },
    {
        'slug': 'ines.moreau', 'first': 'Inès', 'last': 'Moreau',
        'constraints': [
            ('Alimentaire', 'Vegan (allergie sévère aux arachides)', True),
        ],
        'preferences': [
            ('Objectif', 'Prendre du recul', 2), ('Intérêt Tech', '4/10', 1),
            ('Intérêt Social', '3/10', 2), ('Intérêt Sport', '5/10', 1),
            ('Ambiance', 'Calme', 3), ('Espace', 'Besoin d’un espace calme', 3),
            ('Boisson', 'Sans alcool', 1),
        ],
    },
    {
        'slug': 'thomas.lefevre', 'first': 'Thomas', 'last': 'Lefèvre',
        'constraints': [
            ('Transport', 'Voiture personnelle', False),
        ],
        'preferences': [
            ('Objectif', 'Apprendre', 3), ('Format', 'Atelier pratique', 3),
            ('Intérêt Tech', '10/10', 3), ('Intérêt Social', '4/10', 1), ('Intérêt Sport', '4/10', 1),
            ('Niveau', 'Expert', 2), ('Ambiance', 'Studieuse', 2),
        ],
    },
    {
        'slug': 'amina.diallo', 'first': 'Amina', 'last': 'Diallo',
        'constraints': [
            ('Accessibilité', 'Malvoyante : accompagnement et supports adaptés (gros caractères, audio)', True),
        ],
        'preferences': [
            ('Objectif', 'Réseauter', 3), ('Intérêt Tech', '6/10', 2),
            ('Intérêt Social', '8/10', 3), ('Intérêt Sport', '3/10', 1),
            ('Ambiance', 'Conviviale', 2),
        ],
    },
    {
        'slug': 'julien.roux', 'first': 'Julien', 'last': 'Roux',
        'constraints': [
            ('Budget (Max)', '150 € de frais personnels maximum (non remboursés)', True),
            ('Transport', 'Transports en commun uniquement, domicile à Lille', True),
        ],
        'preferences': [
            ('Objectif', 'Apprendre', 2), ('Intérêt Tech', '7/10', 2),
            ('Intérêt Social', '6/10', 1), ('Intérêt Sport', '5/10', 1),
            ('Hébergement', 'Pas d’hébergement payant', 2),
        ],
    },
    {
        'slug': 'chloe.bernard', 'first': 'Chloé', 'last': 'Bernard',
        'constraints': [
            ('Alimentaire', 'Allergie sévère aux fruits de mer et crustacés', True),
        ],
        'preferences': [
            ('Objectif', 'Réseauter', 3), ('Intérêt Tech', '4/10', 1),
            ('Intérêt Social', '10/10', 3), ('Intérêt Sport', '4/10', 1),
            ('Ambiance', 'Festive', 3), ('Boisson', 'Champagne', 1),
        ],
    },
    {
        'slug': 'hugo.garnier', 'first': 'Hugo', 'last': 'Garnier',
        'constraints': [
            ('Mobilité', 'Hernie discale : pas de marche > 2 km ni de station debout prolongée', True),
        ],
        'preferences': [
            ('Objectif', 'Apprendre', 2), ('Intérêt Tech', '8/10', 3),
            ('Intérêt Social', '5/10', 1), ('Intérêt Sport', '1/10', 1),
            ('Ambiance', 'Studieuse', 2), ('Format', 'Conférences assises', 2),
        ],
    },
    {
        'slug': 'lea.fontaine', 'first': 'Léa', 'last': 'Fontaine',
        'constraints': [
            ('Langue', 'Anglais uniquement (ne parle pas français)', True),
        ],
        'preferences': [
            ('Objectif', 'Découvrir les produits', 2), ('Intérêt Tech', '7/10', 2),
            ('Intérêt Social', '7/10', 2), ('Intérêt Sport', '5/10', 1),
            ('Ambiance', 'Conviviale', 2),
        ],
    },
    {
        'slug': 'nicolas.lambert', 'first': 'Nicolas', 'last': 'Lambert',
        'constraints': [
            ('Alimentaire', 'Sans gluten (maladie cœliaque)', True),
        ],
        'preferences': [
            ('Objectif', 'Cohésion d’équipe', 2), ('Intérêt Tech', '5/10', 1),
            ('Intérêt Social', '6/10', 2), ('Intérêt Sport', '7/10', 2),
            ('Ambiance', 'Équilibrée', 1), ('Arrivée', 'La veille', 1),
        ],
    },
]

# Inscriptions de démonstration : (slug participant, index événement).
REGISTRATIONS = [
    ('camille.durand', 0), ('thomas.lefevre', 0), ('hugo.garnier', 0), ('julien.roux', 0),
    ('lucas.petit', 1), ('mehdi.benali', 1), ('nicolas.lambert', 1),
    ('ines.moreau', 2), ('sophie.martin', 2),
    ('chloe.bernard', 3), ('amina.diallo', 3), ('mehdi.benali', 3),
    ('thomas.lefevre', 4), ('sophie.martin', 4), ('lea.fontaine', 4),
    ('lea.fontaine', 5), ('hugo.garnier', 5), ('amina.diallo', 5),
]


def _email(slug: str) -> str:
    return f'{slug}@{DEMO_DOMAIN}'


class Command(BaseCommand):
    help = 'Injecte des participants et événements de démonstration (idempotent).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset', action='store_true',
            help='Supprime les données de démo existantes avant de les recréer.',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if options['reset']:
            self._reset()

        organization, _ = Organization.objects.get_or_create(
            name=DEMO_ORG, defaults={'legal_name': 'EventWIN Démo SAS'},
        )
        organizer = self._account(ORGANIZER[0], ORGANIZER[1], ORGANIZER[2], organization, 'organizer')

        events = [self._event(spec, organization, organizer.user) for spec in EVENTS]

        participants = {}
        for spec in PARTICIPANTS:
            profile = self._account(spec['slug'], spec['first'], spec['last'], organization, 'participant')
            # Profil remplacé à l'identique : pas de doublons de préférences.
            profile.constraints.all().delete()
            profile.preferences.all().delete()
            ParticipantConstraint.objects.bulk_create([
                ParticipantConstraint(
                    participant=profile, constraint_type=kind, value=value,
                    is_hard_constraint=hard,
                )
                for kind, value, hard in spec['constraints']
            ])
            ParticipantPreference.objects.bulk_create([
                ParticipantPreference(
                    participant=profile, preference_type=kind, value=value, weight=weight,
                )
                for kind, value, weight in spec['preferences']
            ])
            participants[spec['slug']] = profile

        for slug, index in REGISTRATIONS:
            EventParticipant.objects.get_or_create(
                event=events[index], participant=participants[slug],
                defaults={'attendance_status': 'registered'},
            )

        self.stdout.write(self.style.SUCCESS(
            f'Démo prête : {len(events)} événements, {len(participants)} participants, '
            f'{len(REGISTRATIONS)} inscriptions (organisation « {DEMO_ORG} »).'
        ))
        self.stdout.write(
            f'Connexion organisateur : {_email(ORGANIZER[0])} / {DEMO_PASSWORD}\n'
            f'Connexion participant  : {_email(PARTICIPANTS[0]["slug"])} / {DEMO_PASSWORD} '
            f'(même mot de passe pour tous les comptes de démo)'
        )

    # --- Aides ---------------------------------------------------------------

    def _reset(self):
        demo_users = User.objects.filter(email__endswith=f'@{DEMO_DOMAIN}')
        Event.objects.filter(organization__name=DEMO_ORG).delete()
        Participant.objects.filter(user__in=demo_users).delete()
        demo_users.delete()
        Organization.objects.filter(name=DEMO_ORG).delete()
        self.stdout.write('Données de démo supprimées.')

    def _account(self, slug, first, last, organization, role) -> Participant:
        email = _email(slug)
        user, created = User.objects.get_or_create(
            username=email, defaults={'email': email, 'first_name': first, 'last_name': last},
        )
        if created:
            user.set_password(DEMO_PASSWORD)
            user.save()
        profile, _ = Participant.objects.update_or_create(
            user=user,
            defaults={'organization': organization, 'role': role, 'status': 'active'},
        )
        return profile

    def _event(self, spec, organization, owner) -> Event:
        start = spec['start']
        event, _ = Event.objects.update_or_create(
            organization=organization, name=spec['name'],
            defaults={
                'owner': owner,
                'event_type': spec['event_type'],
                'event_format': spec['event_format'],
                'objective': spec['objective'],
                'audience_type': spec['audience_type'],
                'mobility_level': spec['mobility_level'],
                'accommodation_required': spec['accommodation_required'],
                'accessibility_level': spec['accessibility_level'],
                'route_or_logistics_notes': spec['notes'],
                'status': 'published',
                'capacity': spec['capacity'],
                'start_date': start,
                'end_date': start + timedelta(days=spec['days'] - 1),
                'location': spec['location'],
                'target_budget': spec['target_budget'],
                'participant_target': spec['participant_target'],
                'participant_expected': spec['participant_expected'],
            },
        )
        event.schedule_items.all().delete()
        tz = timezone.get_current_timezone()
        for day, begin, end, title, category, place in spec['schedule']:
            when = start + timedelta(days=day)
            EventScheduleItem.objects.create(
                event=event, title=title, category=category, location=place,
                starts_at=timezone.make_aware(datetime.combine(when, time.fromisoformat(begin)), tz),
                ends_at=timezone.make_aware(datetime.combine(when, time.fromisoformat(end)), tz),
            )
        return event
