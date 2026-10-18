from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('budgets', '0002_expense'),
    ]

    operations = [
        migrations.DeleteModel(name='CostItem'),
        migrations.DeleteModel(name='BudgetCategory'),
        migrations.DeleteModel(name='Budget'),
    ]
