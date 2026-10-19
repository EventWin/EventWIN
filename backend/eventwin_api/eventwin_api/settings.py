from pathlib import Path
import os
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Charge backend/eventwin_api/.env quel que soit le dossier de lancement.
# Sous Docker, DOTENV_OVERRIDE=false laisse les variables de docker-compose
# (DB_HOST=db, etc.) prioritaires sur celles du .env local.
load_dotenv(
    BASE_DIR / '.env',
    override=os.getenv('DOTENV_OVERRIDE', 'true').lower() == 'true',
)

SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key-change-me')
DEBUG = os.getenv('DEBUG', 'True').lower() == 'true'
ALLOWED_HOSTS = os.getenv('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')

INSTALLED_APPS = [
    'jazzmin',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework.authtoken',
    'apps.organizations',
    'apps.events',
    'apps.participants',
    'apps.budgets',
    'apps.simulation',
    'apps.transport',
    'apps.sponsors',
    'apps.ai',
    'corsheaders',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'eventwin_api.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'eventwin_api.wsgi.application'
ASGI_APPLICATION = 'eventwin_api.asgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.getenv('DB_NAME', 'eventwin'),
        'USER': os.getenv('DB_USER', 'eventwin'),
        'PASSWORD': os.getenv('DB_PASSWORD', 'eventwin'),
        'HOST': os.getenv('DB_HOST', 'localhost'),
        'PORT': os.getenv('DB_PORT', '5432'),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'fr'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

CORS_ALLOW_ALL_ORIGINS = True


def _env_float(name: str, default: float) -> float:
    """Lit un flottant d'environnement sans faire planter le démarrage."""
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    """Lit un entier d'environnement sans faire planter le démarrage."""
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_list(name: str, default: str) -> list[str]:
    """Lit une liste séparée par des virgules."""
    raw = os.getenv(name, default)
    return [entry.strip().lower() for entry in raw.split(',') if entry.strip()]


# Email Configuration
EMAIL_BACKEND = os.getenv('EMAIL_BACKEND', 'django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = os.getenv('EMAIL_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(os.getenv('EMAIL_PORT', 587))
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.getenv('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.getenv('EMAIL_HOST_PASSWORD', '')
# Adresse expéditrice affichée ; par défaut celle du compte SMTP.
EMAIL_FROM = os.getenv('EMAIL_FROM', EMAIL_HOST_USER)
# URL publique du front : sert à construire les liens d'activation et de
# réinitialisation envoyés par e-mail.
FRONTEND_BASE_URL = os.getenv('FRONTEND_BASE_URL', 'http://localhost:4200')
# Délai de validité des jetons (heures) : réinitialisation + invitations.
AUTH_TOKEN_TTL_HOURS = _env_int('AUTH_TOKEN_TTL_HOURS', 48)
INVITATION_TTL_HOURS = _env_int('INVITATION_TTL_HOURS', 168)

# --- API REST ----------------------------------------------------------------
# Toute route est refusée sans authentification **sauf** déclaration
# explicite ``AllowAny`` (inscription, connexion, jetons publics, healthcheck).
# Le rôle est toujours lu côté serveur (apps/core/permissions.py).
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        # Le token doit venir en **premier** : DRF lit
        # ``authenticators[0].authenticate_header()`` pour construire l'en-tête
        # ``WWW-Authenticate``, et ``SessionAuthentication`` renvoie toujours
        # ``None``. Sans en-tête, ``APIView.handle_exception`` rétrograde 401 en
        # 403 : le client ne pouvait plus distinguer « jeton expiré / absent »
        # d'un vrai refus de permission, donc jamais de déconnexion automatique
        # ni de redirection vers /login. La session reste prise en charge juste
        # après (les deux classes restent essayées dans l'ordre).
        'rest_framework.authentication.TokenAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_PAGINATION_CLASS': None,
    'TEST_REQUEST_DEFAULT_FORMAT': 'json',
}

# --- Analyse budgétaire par IA (Google Gemini) --------------------------------
# La clé reste côté serveur (jamais envoyée au front). Sans clé, l'IA est
# signalée comme indisponible.
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-3.5-flash')
# Modèles de repli (quota atteint, surcharge…), séparés par des virgules.
GEMINI_FALLBACK_MODELS = [
    m.strip() for m in os.getenv(
        'GEMINI_FALLBACK_MODELS',
        'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-2.5-flash',
    ).split(',') if m.strip()
]
GEMINI_BASE_URL = os.getenv('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')
GEMINI_TIMEOUT = _env_float('GEMINI_TIMEOUT', 180.0)
BUDGET_CURRENCY = os.getenv('BUDGET_CURRENCY', '')

# --- Paramètres techniques du module Budget & Ressources ----------------------
# Aucune décision métier n'est codée en dur dans les fichiers de l'app : les
# valeurs techniques (délais, tailles de lot, concurrence, domaines exclus)
# vivent ici, surchargeables par variable d'environnement.
BUDGET_AI = {
    'BASE_URL': GEMINI_BASE_URL,
    'API_KEY': GEMINI_API_KEY,
    'MODEL': GEMINI_MODEL,
    'FALLBACK_MODELS': GEMINI_FALLBACK_MODELS,
    'TIMEOUT': GEMINI_TIMEOUT,
    'TEMPERATURE': _env_float('GEMINI_TEMPERATURE', 0.4),
    # Nombre de ressources envoyées par appel LLM : le coût et le nombre
    # d'appels ne doivent pas croître avec le nombre de ressources (2 appels
    # maximum par analyse : un lot + l'analyse budgétaire). Surchargeable par
    # environnement pour les machines plus ou moins puissantes.
    'BATCH_SIZE': max(1, _env_int('AI_BATCH_SIZE', 20)),
    # Délai global d'une analyse : au-delà, le reste passe en tâche de fond.
    'ANALYSIS_TIMEOUT': _env_float('BUDGET_ANALYSIS_TIMEOUT', 120.0),
    # Deux analyses simultanées du même événement sont refusées (409).
    'LOCK_TTL': _env_float('BUDGET_ANALYSIS_LOCK_TTL', 600.0),
}

BUDGET_SEARCH = {
    # Domaines exclus : encyclopédies, dictionnaires, moteurs de recherche,
    # réseaux sociaux — jamais une page d'offre exploitable.
    'BLOCKED_DOMAINS': _env_list(
        'WEB_SEARCH_BLOCKED_DOMAINS',
        'wikipedia.org,wiktionary.org,dictionary.com,larousse.fr,'
        'lerobert.com,languefrancaise.net,wordreference.com,'
        'lalanguefrancaise.com,cnrtl.fr,'
        'reverso.net,linguee.fr,google.com,bing.com,duckduckgo.com,qwant.com,'
        'facebook.com,instagram.com,pinterest.com,reddit.com,youtube.com',
    ),
    # Nombre maximal de recherches **par analyse** (garde-fou économique).
    'MAX_SEARCHES': max(0, _env_int('WEB_SEARCH_MAX_SEARCHES', 8)),
    'TIMEOUT': _env_float('WEB_SEARCH_TIMEOUT', 8.0),
    'CACHE_TTL': _env_int('WEB_SEARCH_CACHE_TTL', 900),
    'MAX_RESULTS': max(1, _env_int('WEB_SEARCH_MAX_RESULTS', 8)),
    # Candidats réellement montrés au modèle par ressource. Un prompt court est
    # ce qui permet au modèle de répondre pour **toutes** les ressources d'un
    # lot. La validation lit les indices dans cette même liste bornée.
    'MAX_PROMPT_CANDIDATES': max(1, _env_int('WEB_SEARCH_PROMPT_CANDIDATES', 3)),
    # Recherches exécutées en parallèle (concurrence bornée).
    'CONCURRENCY': max(1, _env_int('WEB_SEARCH_CONCURRENCY', 4)),
    'USER_AGENT': os.getenv(
        'WEB_SEARCH_USER_AGENT', 'EventWIN/1.0 (+https://eventwin.local; budget-check)'
    ),
}

# --- Recherche web pour les prix (optionnelle) -------------------------------
# Deux niveaux :
#   1. BRAVE_SEARCH_API_KEY / SERP_API_KEY : API payante, résultats structurés
#      et, selon le moteur, prix réellement relevés sur les pages.
#   2. Sans aucune clé : recherche **sans clé** sur Bing (région France). Les
#      liens renvoyés sont de vraies pages produits, mais aucun tarif n'est
#      observé — le prix affiché reste alors une estimation IA, jamais le prix
#      d'un fournisseur (cf. apps/budgets/websearch.py).
WEB_SEARCH_AVAILABLE = os.getenv('WEB_SEARCH_AVAILABLE', 'false').lower() == 'true'
WEB_SEARCH_API_KEY = os.getenv('WEB_SEARCH_API_KEY', '')
BRAVE_SEARCH_API_KEY = os.getenv('BRAVE_SEARCH_API_KEY', '')
SERP_API_KEY = os.getenv('SERP_API_KEY', '')

JAZZMIN_SETTINGS = {
    'site_title': 'EventTwin Admin',
    'site_header': 'EventTwin',
    'site_brand': 'EventTwin',
    'site_logo_classes': 'img-circle',
    'welcome_sign': "Bienvenue sur la supervision d'EventTwin",
    'copyright': 'EventTwin Ltd',
    'show_sidebar': True,
    'navigation_expanded': True,
    'order_with_respect_to': ['auth', 'participants', 'events'],
    'icons': {
        'auth.user': 'fas fa-user',
        'auth.Group': 'fas fa-users',
        'participants.participant': 'fas fa-id-badge',
        'events.event': 'fas fa-calendar',
    },
    'default_icon_parents': 'fas fa-chevron-circle-right',
    'default_icon_children': 'fas fa-circle',
}
JAZZMIN_UI_TWEAKS = {
    "navbar": "navbar-dark",
    "theme": "darkly",
    "sidebar": "sidebar-dark-primary",
    "sidebar_nav_child_indent": True,
    "sidebar_nav_compact_style": False,
    "sidebar_nav_legacy_style": False,
    "sidebar_nav_flat_style": False,
    "dark_mode_theme": "darkly",
    "button_classes": {
        "primary": "btn-primary",
        "secondary": "btn-secondary",
        "info": "btn-info",
        "warning": "btn-warning",
        "danger": "btn-danger",
        "success": "btn-success"
    },
    "actions_sticky_top": True
}
