# Migration sûre et réversible : ajoute le propriétaire d'événement puis
# rétroagit les données historiques de façon contrôlée (backfill).
#
# Règle de backfill (aucune donnée inventée) :
#   un événement sans propriétaire reçoit l'organisateur **unique** de son
#   organisation ; s'il y en a plusieurs ou aucun, le propriétaire reste vide
#   et la ligne est listée dans le rapport imprimé (à corriger manuellement
#   ou par l'administrateur via l'interface).
#
# Rollback : la suppression de la colonne ne détruit aucune autre donnée.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def assign_missing_owners(apps, schema_editor):
    """Attribue l'organisateur unique de l'organisation à chaque événement."""
    Event = apps.get_model('events', 'Event')
    Participant = apps.get_model('participants', 'Participant')

    touched = 0
    unresolved = 0
    for event in Event.objects.filter(owner__isnull=True).select_related('organization'):
        organizers = list(
            Participant.objects.filter(
                organization_id=event.organization_id,
                role='organizer',
                user__isnull=False,
            ).values_list('user_id', flat=True)
        )
        if len(organizers) == 1:
            event.owner_id = organizers[0]
            event.save(update_fields=['owner'])
            touched += 1
        else:
            unresolved += 1
            print(
                f'[0005] Événement {event.id} ({event.name!r}) : '
                f'{len(organizers)} organisateurs candidats — propriétaire laissé vide.'
            )
    print(f'[0005] Backfill propriétaire : {touched} événement(s) mis à jour, '
          f'{unresolved} à attribuer manuellement.')


def unassign_owners(apps, schema_editor):
    """Rollback : vide les propriétaires attribués par cette migration."""
    Event = apps.get_model('events', 'Event')
    count = Event.objects.update(owner=None)
    print(f'[0005] Rollback : {count} propriétaire(s) effacé(s).')


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0004_remove_event_budget_accommodation_and_more'),
        ('participants', '0002_organizer'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='event',
            name='owner',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='owned_events',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.RunPython(assign_missing_owners, unassign_owners),
    ]
