"""Settings de test : réutilise la base existante faute de droit CREATE DATABASE.

Le compte PostgreSQL du projet n'a pas le privilège ``CREATEDB`` : Django ne
peut donc pas créer ``test_eventwin``. Ces settings pointent le suffixe de base
de test sur la base réelle et s'utilisent **exclusivement** avec ``--keepdb`` :

    python manage.py test apps.budgets --settings=eventwin_api.test_settings --keepdb

La base n'est jamais vidée : ``django.test.TestCase`` exécute chaque test dans
une transaction annulée à la fin, donc les données de développement sont
préservées.
"""

import os

from .settings import *  # noqa: F401,F403 — reprise volontaire de toute la config

DATABASES['default']['TEST'] = {  # noqa: F405 — dict repris ci-dessus
    'NAME': os.getenv('DB_NAME', 'eventwin'),
}
