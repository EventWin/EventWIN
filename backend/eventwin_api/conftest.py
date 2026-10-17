import pytest


@pytest.fixture(scope='session')
def django_db_modify_db_settings():
    """Run the test suite on an isolated in-memory SQLite DB (never the shared Neon/Postgres)."""
    from django.conf import settings

    settings.DATABASES['default'] = {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
