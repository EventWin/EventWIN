# Réconciliation du schéma — dérive historique.
#
# Constat (contrôlé sur la base de production, sauvegarde pg_dump effectuée
# avant toute opération) :
#   - la colonne ``events_event.capacity`` **existait déjà** en base
#     (integer NOT NULL, défaut 0, contrainte CHECK capacity >= 0) alors
#     qu'aucune migration du dépôt ne la déclarait. Tenter ``AddField`` levait
#     « la colonne capacity de la relation events_event existe déjà ». On
#     **adopte** la colonne existante via ``SeparateDatabaseAndState`` : aucune
#     opération destructive, seule l'état des migrations est mis à jour.
#   - les colonnes ``created_by_id`` et ``organizer_id`` pointaient vers
#     ``participants_participant`` mais n'étaient déclarées par aucun modèle
#     actuel (champ ``owner`` vers ``auth_user`` désormais utilisée). Elles sont
#     **supprimées** : orphelines, non lues par le code, et la valeur utile
#     (propriétaire) est portée par ``owner``. Justification + sauvegarde
#     ci-dessus ; réversible par pg_restore.
#
# Le modèle ``capacity`` porte désormais ``default=0`` (0 = illimité) et une
# validation ``MinValueValidator(0)`` qui reprend la contrainte DB existante.

from django.db import migrations, models
import django.core.validators


class Migration(migrations.Migration):

    dependencies = [
        ('events', '0005_event_owner'),
    ]

    operations = [
        # Adoption de la colonne capacity préexistante : on ne touche pas à la
        # base, on aligne seulement l'état des migrations sur le réel.
        migrations.SeparateDatabaseAndState(
            database_operations=[
                # Base neuve (ex. Docker) : la colonne n'existe pas encore,
                # on la crée ; sur une base qui l'a déjà, IF NOT EXISTS est
                # sans effet.
                migrations.RunSQL(
                    sql=[
                        'ALTER TABLE events_event '
                        'ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 0;',
                        'ALTER TABLE events_event '
                        'ALTER COLUMN capacity SET DEFAULT 0;',
                    ],
                    reverse_sql=migrations.RunSQL.noop,
                    state_operations=[],
                ),
            ],
            state_operations=[
                migrations.AddField(
                    model_name='event',
                    name='capacity',
                    field=models.IntegerField(
                        default=0,
                        validators=[django.core.validators.MinValueValidator(0)],
                    ),
                ),
            ],
        ),
        # Les choices n'affectent pas le type de colonne ; opération d'état
        # sûre sur Postgres (varchar(50) inchangé).
        migrations.AlterField(
            model_name='event',
            name='status',
            field=models.CharField(
                choices=[
                    ('draft', 'Brouillon'),
                    ('published', 'Publié'),
                    ('completed', 'Terminé'),
                    ('cancelled', 'Annulé'),
                ],
                default='draft',
                max_length=50,
            ),
        ),
        # Nettoyage des colonnes orphelines d'un ancien schéma (voir en-tête).
        migrations.RunSQL(
            sql=[
                'ALTER TABLE events_event DROP COLUMN IF EXISTS created_by_id;',
                'ALTER TABLE events_event DROP COLUMN IF EXISTS organizer_id;',
            ],
            reverse_sql=[
                (
                    'ALTER TABLE events_event ADD COLUMN created_by_id uuid '
                    'NULL REFERENCES participants_participant(id);'
                ),
                (
                    'ALTER TABLE events_event ADD COLUMN organizer_id uuid '
                    'NULL REFERENCES participants_participant(id);'
                ),
            ],
        ),
    ]
