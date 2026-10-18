"""Ajoute l'état d'analyse explicite et l'empreinte de ressource.

Pourquoi : l'état était déduit de la combinaison ``is_ambiguous`` + ``total`` +
``unpriced_reason``. Trois champs, neuf combinaisons possibles, aucune
contrôlée — d'où des lignes « comprise, non chiffrée » affichées à 0 € et des
ressources exclues qui gardaient un lien fournisseur.

- ``analysis_status`` : état unique et lisible (voir le modèle).
- ``analysis_fingerprint`` : empreinte nom + description + catégorie + type
  d'événement, permettant de ne **pas** ré-analyséer une ressource inchangée.
  La quantité n'en fait pas partie : la changer ne doit recalculer qu'un
  total.
- ``product_url`` : 500 → 2048 caractères. Une URL coupée est un lien mort ;
  au-delà, la valeur est écartée, jamais tronquée.
"""

from django.db import migrations, models


def _normalize(value) -> str:
    """Forme normalisée reprise de apps.budgets.textutils (figée pour la migration)."""
    import re
    import unicodedata

    text = str(value or '').strip().lower()
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(char for char in text if not unicodedata.combining(char))
    return re.sub(r'\s+', ' ', text)


def _fingerprint(item, event_type: str) -> str:
    import hashlib

    raw = '|'.join([
        _normalize(item.name),
        _normalize(item.description),
        item.category or '',
        event_type or '',
    ])
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def derive_analysis_status(apps, schema_editor):
    """Dérive l'état des lignes existantes à partir des données réelles."""
    BudgetItem = apps.get_model('budgets', 'BudgetItem')
    Event = apps.get_model('events', 'Event')

    event_types = dict(Event.objects.values_list('id', 'event_type'))

    for item in BudgetItem.objects.all().iterator():
        if item.is_ambiguous:
            status = 'ambiguous'
        elif item.unpriced_reason:
            status = 'understood_unpriced'
        elif item.total is not None:
            status = 'priced'
        else:
            # Aucune trace d'un prix ni d'un motif : la ligne sera ré-analysée
            # au prochain clic. On ne devine jamais un état favorable.
            status = 'pending'

        item.analysis_status = status
        item.analysis_fingerprint = _fingerprint(
            item, event_types.get(item.event_id, '')
        )
        item.save(update_fields=['analysis_status', 'analysis_fingerprint'])


def unset_analysis_status(apps, schema_editor):
    """Retour arrière : les champs sont supprimés, rien à restaurer."""


class Migration(migrations.Migration):

    dependencies = [
        ('budgets', '0009_budgetitem_offer_available_budgetitem_offer_currency_and_more'),
        # Dernière migration d'events : la migration de données lit
        # ``Event.event_type``, ajouté après 0001.
        ('events', '0004_remove_event_budget_accommodation_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='budgetitem',
            name='analysis_status',
            field=models.CharField(
                choices=[
                    ('pending', 'En attente d’analyse'),
                    ('priced', 'Comprise et chiffrée'),
                    ('understood_unpriced', 'Comprise, non chiffrée'),
                    ('ambiguous', 'Ressource ambiguë'),
                    ('search_unavailable', 'Recherche web indisponible'),
                    ('analysis_failed', 'Analyse échouée'),
                ],
                default='pending',
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name='budgetitem',
            name='analysis_fingerprint',
            field=models.CharField(blank=True, db_index=True, max_length=64),
        ),
        migrations.AlterField(
            model_name='budgetitem',
            name='product_url',
            field=models.URLField(blank=True, max_length=2048),
        ),
        migrations.AlterField(
            model_name='budgetitem',
            name='price_source',
            field=models.CharField(
                blank=True,
                choices=[
                    ('', 'Non déterminé'),
                    ('ai_estimate', 'Estimation IA'),
                    ('real_offer', 'Prix relevé sur une page réelle'),
                ],
                max_length=20,
            ),
        ),
        migrations.RunPython(derive_analysis_status, unset_analysis_status),
    ]
