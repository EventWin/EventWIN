from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('participants', '0002_organizer'),
    ]

    operations = [
        migrations.AddField(
            model_name='participant',
            name='phone',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
        migrations.AddField(
            model_name='participant',
            name='photo',
            field=models.TextField(blank=True, default=''),
        ),
    ]
