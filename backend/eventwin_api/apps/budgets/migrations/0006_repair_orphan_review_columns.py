"""Répare les colonnes orphelines `review_*` de `budgets_budgetitem`.

Contexte : la base contient trois colonnes — ``review_status``,
``review_question`` et ``review_reason`` — créées par une migration qui n'existe
plus dans le dépôt (le fichier a été supprimé après application, et les champs
correspondants ont été retirés du modèle). Ces colonnes sont donc absentes du
modèle Django et de l'état des migrations, mais toujours présentes en base,
en ``NOT NULL`` **et sans défaut**.

Conséquence : toute insertion dans ``budgets_budgetitem`` échoue avec
``NotNullViolation``, ce qui casse entièrement le module Budget (aucune
ressource ne peut être créée).

Cette migration **ne supprime rien** : elle rend simplement ces colonnes
ignorables (nullable, défaut ``''``), pour que les INSERT produits par Django
— qui ne les mentionnent pas — réussissent à nouveau. Le SQL est idempotent et
inoffensif sur une base saine : les colonnes sont simplement absentes.

Si ces champs devaient être réintroduits plus tard, il suffira d'ajouter les
attributs correspondants au modèle et de régénérer une migration.
"""

from django.db import migrations

#: Colonnes laissées dans un état inexploitable par la migration disparue.
ORPHAN_COLUMNS = ('review_status', 'review_question', 'review_reason')

_STATEMENT = """
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'budgets_budgetitem' AND column_name = '%(column)s'
    ) THEN
        ALTER TABLE budgets_budgetitem ALTER COLUMN %(column)s DROP NOT NULL;
        ALTER TABLE budgets_budgetitem ALTER COLUMN %(column)s SET DEFAULT '';
    END IF;
END $$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('budgets', '0005_budgetitem_ambiguity_reason_budgetitem_is_ambiguous_and_more'),
    ]

    operations = [
        migrations.RunSQL(
            sql=[_STATEMENT % {'column': column} for column in ORPHAN_COLUMNS],
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
