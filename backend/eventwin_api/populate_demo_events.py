import os
import django
from datetime import date, datetime
from decimal import Decimal

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'eventwin_api.settings')
django.setup()

from apps.organizations.models import Organization
from apps.events.models import Event, EventScheduleItem, Resource
from apps.participants.models import Participant, EventParticipant
from apps.simulation.models import Scenario, ScenarioResult

org = Organization.objects.first()

# Supprimer anciens events de test si existants
Event.objects.all().delete()

# 1. Événement Musical / Festival
ev_festival = Event.objects.create(
    organization=org,
    name='NeonWaves Music and Digital Festival 2026',
    status='confirmed',
    start_date=date(2026, 7, 18),
    end_date=date(2026, 7, 20),
    location='Hippodrome de ParisLongchamp, Scene Electro et Live',
    target_budget=Decimal('125000.00')
)

EventScheduleItem.objects.create(
    event=ev_festival,
    title='Ouverture des portes et Warm-up DJ Set',
    starts_at=datetime(2026, 7, 18, 18, 0),
    ends_at=datetime(2026, 7, 18, 20, 0),
    category='Concert Live',
    location='Scene Sunset Garden'
)

EventScheduleItem.objects.create(
    event=ev_festival,
    title='Showcase Electro Live et Hologramme 3D',
    starts_at=datetime(2026, 7, 18, 20, 30),
    ends_at=datetime(2026, 7, 18, 23, 0),
    category='Concert Principal',
    location='Grande Scene Neon Arena'
)

EventScheduleItem.objects.create(
    event=ev_festival,
    title='Soiree Festive de Cloture et Jam Electro',
    starts_at=datetime(2026, 7, 19, 21, 0),
    ends_at=datetime(2026, 7, 20, 1, 30),
    category='Fete et Celebration',
    location='Dome Immersion 360'
)

Resource.objects.create(
    event=ev_festival,
    resource_type='pass',
    name='Pass VIP All-Access et Lounge Backstage',
    capacity=500,
    unit_cost=Decimal('180.00')
)

Resource.objects.create(
    event=ev_festival,
    resource_type='catering',
    name='Formule Restauration Eco-Gourmet et Bar Prive',
    capacity=1200,
    unit_cost=Decimal('45.00')
)

# 2. Séminaire et Voyage d'Affaires Optimisé par Simulateur
ev_seminar = Event.objects.create(
    organization=org,
    name="Seminaire d'Innovation et Leadership Alpin 2026",
    status='confirmed',
    start_date=date(2026, 9, 12),
    end_date=date(2026, 9, 15),
    location='Chamonix Mont-Blanc Grand Resort et Centre de Congres',
    target_budget=Decimal('280000.00')
)

EventScheduleItem.objects.create(
    event=ev_seminar,
    title='Transport TGV Lyria Paris Gare de Lyon vers Bellegarde / Chamonix',
    starts_at=datetime(2026, 9, 12, 8, 30),
    ends_at=datetime(2026, 9, 12, 12, 15),
    category='Transport et Voyage',
    location='Voiture 4 - Siege 52 (Attribue par le simulateur)'
)

EventScheduleItem.objects.create(
    event=ev_seminar,
    title="Pleniere d'Ouverture : Les Jumeaux Numeriques dans l'Entreprise",
    starts_at=datetime(2026, 9, 12, 14, 30),
    ends_at=datetime(2026, 9, 12, 18, 0),
    category='Conference Pleniere',
    location='Auditorium Mont-Blanc'
)

EventScheduleItem.objects.create(
    event=ev_seminar,
    title='Atelier Strategie et Modelisation Predictive en Equipe',
    starts_at=datetime(2026, 9, 13, 9, 0),
    ends_at=datetime(2026, 9, 13, 12, 30),
    category='Atelier de Travail',
    location='Salle Aiguille du Midi'
)

EventScheduleItem.objects.create(
    event=ev_seminar,
    title='Diner de Gala Panoramique et Celebration Annuelle',
    starts_at=datetime(2026, 9, 13, 19, 30),
    ends_at=datetime(2026, 9, 13, 23, 0),
    category='Restauration et Gala',
    location='Chalet Sommet 2000m'
)

Resource.objects.create(
    event=ev_seminar,
    resource_type='hotel',
    name='Hotel Mont-Blanc 4★ (Chambre Superieure Vue Massif)',
    capacity=150,
    unit_cost=Decimal('185.00')
)

Resource.objects.create(
    event=ev_seminar,
    resource_type='transport',
    name='TGV Lyria 1ere Classe et Navette Eco-Electrique',
    capacity=180,
    unit_cost=Decimal('140.00')
)

Resource.objects.create(
    event=ev_seminar,
    resource_type='catering',
    name='Menu Gastronomique Adapte aux Regimes Declares',
    capacity=200,
    unit_cost=Decimal('95.00')
)

# Simulation du séminaire
sc = Scenario.objects.create(
    event=ev_seminar,
    name='Scenario Optimal IA - Confort et Empreinte Bas Carbone',
    status='optimized',
    description='Attribution optimale des chambres calmes et transport direct par train.'
)

ScenarioResult.objects.create(
    scenario=sc,
    predicted_cost=Decimal('420.00'),
    predicted_satisfaction=Decimal('98.5'),
    notes="Satisfaction maximisee a 98.5% avec -38% d'emissions CO2."
)

# Inscrire tous les participants existants aux 2 événements
for p in Participant.objects.all():
    EventParticipant.objects.get_or_create(event=ev_festival, participant=p, defaults={'attendance_status': 'confirmed', 'satisfaction_score': Decimal('97.5')})
    EventParticipant.objects.get_or_create(event=ev_seminar, participant=p, defaults={'attendance_status': 'confirmed', 'satisfaction_score': Decimal('99.0')})

print('Successfully created 2 events and linked all participants!')
