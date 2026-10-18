"""Recherche web **réelle** de pages fournisseurs / produits.

Objectif : fournir à l'assistant budgétaire des **liens vérifiables** — de vraies
pages de vente, accessibles en un clic — pour chaque ressource comprise.

Règle absolue : ce module ne devine rien. S'il ne trouve pas, il renvoie une
liste vide, et le reste de l'application affiche explicitement « aucune offre
fiable trouvée ». Aucune URL, aucun fournisseur et aucun prix ne sont jamais
fabriqués par ici.

Chaîne de fournisseurs, du plus fiable au plus accessible :

  1. **API payante** si une clé est fournie (``BRAVE_SEARCH_API_KEY``,
     ``SERP_API_KEY``) : résultats structurés et, selon le fournisseur, prix
     réellement relevés (``price`` renseigné) ;
  2. **à défaut, la page de résultats HTML de Bing en région France, sans clé**.
     Les URL réelles sont encodées en base64 dans les redirections ``u=a1…``
     du moteur : on les décode, on les nettoie des paramètres de pistage et on
     les revalide (schéma ``http(s)``, domaine non bloqué).

Remarque d'intégrité : avec le moteur sans clé, aucun tarif n'est observé. Le
prix affiché à l'utilisateur reste alors une **estimation IA**, jamais le prix
d'un fournisseur. Voir ``estimations``.

État et concurrence : les compteurs de recherches vivent dans une
``SearchSession`` créée **par analyse** (deux analyses simultanées ne se
piquent donc plus le budget de l'une l'autre), et le cache partagé est protégé
par un verrou — il est stocké dans le cache Django pour survivre à une
recharge du module.
"""

from __future__ import annotations

import base64
import html as html_module
import json
import logging
import re
import threading
from dataclasses import dataclass, field
from urllib.parse import parse_qsl, quote_plus, urlencode, urlparse

import httpx
from django.conf import settings
from django.core.cache import cache

from .textutils import normalize_text

logger = logging.getLogger(__name__)

CACHE_MAX_ENTRIES = 256
_CACHE_KEY = 'budgets:websearch:results'
_CACHE_LOCK = threading.Lock()

# Paramètres de pistage retirés des URL retournées.
_TRACKING_PARAM = re.compile(
    r'^(ms[a-z]*|utm_[a-z_]+|mc_[a-z]+|igshid|fbclid|gclid|dclid|_ga|ref_src)$',
    re.IGNORECASE,
)

# Longueur maximale d'une URL conservée, alignée sur ``BudgetItem.product_url``
# (max_length=2048). Au-delà, le lien est **écarté entièrement** : jamais tronqué.
MAX_URL_LENGTH = 2048

# Chemins de pages non exploitables comme offre : accueil, rubrique, résultat
# de recherche, dictionnaire, encyclopédie, et **pages éditoriales** (articles
# de presse, dossiers, blogs) : un article de magazine n'est jamais une fiche
# produit, quelle que soit la requête.
_NON_PRODUCT_PATH = re.compile(
    r'(^|/)(search|recherche|results|resultats|category|categories|c$|catalogue|'
    r'catalog|shop$|store$|boutique|dictionary|dictionnaire|wiki|definition|'
    r'definitions|encyclopedie|accueil|home|latest|news|actualite|actualites|'
    r'dossier|dossiers|article|articles|blog|blogs|interview|reportage|'
    r'communique|presse|magazine|radio|television|video|videos|forum|forums|'
    r'tag|tags|topic|topics|auteur|authors)(/|$)',
    re.IGNORECASE,
)

# Article daté (…/2026/09/29/…) : signature structurelle d'un contenu de
# presse, jamais d'un catalogue marchand.
_DATED_ARTICLE_PATH = re.compile(r'(^|/)\d{4}/\d{1,2}/\d{1,2}(/|$)')

# Signaux **commerciaux** attendus sur une vraie page de vente ou de prestation
# (tarif, panier, commande, réservation, devis). Ce sont des marqueurs
# techniques de commerce, jamais du vocabulaire métier : ils servent uniquement
# à écarter une page qui parle de la ressource sans rien proposer à la vente
# (dictionnaire d'expressions, article, fiche encyclopédique…).
_COMMERCIAL_SIGNAL = re.compile(
    r'€|\bEUR\b|priceCurrency|"price"|\boffers\b|panier|add\s?to\s?cart|'
    r'acheter|commander|commande|r[eé]serv|devis|\btarifs?\b',
    re.IGNORECASE,
)


def _config() -> dict:
    """Paramètres techniques, lus à chaque appel (settings surchargeables)."""
    return getattr(settings, 'BUDGET_SEARCH', {})


def _blocked_domains() -> set[str]:
    return set(_config().get('BLOCKED_DOMAINS', ()))


def _timeout() -> float:
    return float(_config().get('TIMEOUT', 8.0))


def _max_results() -> int:
    return max(1, int(_config().get('MAX_RESULTS', 8)))


def _max_searches() -> int:
    return max(0, int(_config().get('MAX_SEARCHES', 8)))


def _cache_ttl() -> int:
    return int(_config().get('CACHE_TTL', 900))


def _user_agent() -> str:
    return _config().get(
        'USER_AGENT', 'EventWIN/1.0 (+https://eventwin.local; budget-check)'
    )


# ---------------------------------------------------------------------------
# État d'une analyse (créé et détenu par la vue, jamais partagé)
# ---------------------------------------------------------------------------

@dataclass
class SearchSession:
    """Budget de recherches rattaché à **une** analyse.

    Remplace les anciens compteurs de module : ``reset_budget()`` d'une requête
    HTTP perturbait les requêtes concurrentes, qui perdaient leur quota en
    cours de route.
    """

    max_searches: int = 0
    searches_done: int = 0
    searched: int = 0
    found: int = 0
    failed: int = 0
    capped: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def try_consume(self) -> bool:
        """Renvoie ``False`` si le quota de l'analyse est épuisé."""
        with self._lock:
            if self.max_searches <= 0 or self.searches_done >= self.max_searches:
                return False
            self.searches_done += 1
            self.searched += 1
            return True

    def record_found(self, count: int) -> None:
        with self._lock:
            self.found += count

    def record_failure(self) -> None:
        with self._lock:
            self.failed += 1

    def record_capped(self) -> None:
        with self._lock:
            self.capped += 1


def new_session(max_searches: int | None = None) -> SearchSession:
    """Crée l'état d'une analyse ; quota tiré des settings par défaut."""
    return SearchSession(
        max_searches=_max_searches() if max_searches is None else max(0, int(max_searches))
    )


# ---------------------------------------------------------------------------
# Normalisation et validation des URL
# ---------------------------------------------------------------------------

def normalise_query(value: str) -> str:
    """Requête de recherche : minuscules, sans accents, caractères non utiles retirés."""
    cleaned = ''.join(
        char if (char.isalnum() or char.isspace()) else ' '
        for char in normalize_text(value)
    )
    return ' '.join(cleaned.split())


def domain_of(url: str) -> str:
    """Domaine sans ``www.`` ; chaîne vide si l'URL est illisible."""
    try:
        netloc = urlparse(url or '').netloc.lower()
    except ValueError:
        return ''
    return netloc[4:] if netloc.startswith('www.') else netloc


def is_blocked_domain(domain: str) -> bool:
    """True si ce domaine ne peut pas être présenté comme un lien d'achat."""
    domain = (domain or '').lower()
    if not domain:
        return True
    blocked = _blocked_domains()
    if domain in blocked:
        return True
    return any(domain.endswith('.' + entry) for entry in blocked)


def clean_url(raw: str) -> str:
    """Valide et nettoie une URL : schéma http(s), longueur supportable.

    Renvoie ``''`` si l'URL n'est pas exploitable — on préfère perdre un
    résultat que proposer un lien cassé, piégé ou tronqué.
    """
    raw = html_module.unescape((raw or '').strip())
    if raw.startswith('//'):
        raw = 'https:' + raw
    if not raw.lower().startswith(('http://', 'https://')):
        return ''
    if len(raw) > MAX_URL_LENGTH:
        return ''

    try:
        parts = urlparse(raw)
    except ValueError:
        return ''

    if not parts.netloc or is_blocked_domain(domain_of(raw)):
        return ''

    kept = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if not _TRACKING_PARAM.match(key)]
    query = urlencode(kept)

    return f'{parts.scheme}://{parts.netloc}{parts.path}' + (f'?{query}' if query else '')


def looks_like_product_page(url: str) -> bool:
    """Faux pour l'accueil, une rubrique, une recherche, une définition ou un
    article de presse (chemin daté, rubrique « latest », « dossier »…)."""
    try:
        parts = urlparse(url or '')
    except ValueError:
        return False
    path = (parts.path or '').strip('/')
    if not path:
        return False
    if _DATED_ARTICLE_PATH.search('/' + path + '/'):
        return False
    return not _NON_PRODUCT_PATH.search('/' + path + '/')


# ---------------------------------------------------------------------------
# Moteurs de recherche
# ---------------------------------------------------------------------------

def _decode_bing_url(href: str) -> str:
    """Décode la redirection Bing ``…/ck/a?…&u=a1<base64url>&…``.

    Bing masque les URL réelles derrière un encodage base64 (variante URL-safe)
    préfixé par ``a1``. Si l'URL est déjà directe, on la renvoie telle quelle.

    L'HTML doit être dééchappé **avant** l'analyse : dans le code source les
    séparateurs de paramètres apparaissent sous la forme ``&amp;u=a1…``.
    """
    href = html_module.unescape(href or '')
    match = re.search(r'[?&]u=a1([A-Za-z0-9_\-+/]+)', href, re.IGNORECASE)
    if not match:
        return href or ''

    token = match.group(1)
    token += '=' * (-len(token) % 4)  # compléter le padding base64 manquant
    try:
        return base64.urlsafe_b64decode(token).decode('utf-8', 'replace')
    except (ValueError, UnicodeDecodeError):
        return ''


def _strip_tags(fragment: str) -> str:
    return ' '.join(html_module.unescape(re.sub(r'<[^>]+>', ' ', fragment or '')).split())


def _structured_commerce(html: str) -> dict:
    """Extrait uniquement les données Product/Service/Offer des JSON-LD.

    Une occurrence arbitraire de ``"price"`` dans une page ne prouve pas un
    tarif produit. Les données structurées sont parcourues récursivement afin
    de rattacher prix, devise et disponibilité à une entité commerciale.
    """
    found = {}

    def visit(value):
        if isinstance(value, list):
            for child in value:
                visit(child)
            return
        if not isinstance(value, dict):
            return
        types = value.get('@type', [])
        if isinstance(types, str):
            types = [types]
        types = {str(item).lower() for item in types} if isinstance(types, list) else set()
        if types.intersection({'product', 'service', 'offer'}):
            if value.get('name') and not found.get('name'):
                found['name'] = value.get('name')
            offers = value.get('offers')
            if isinstance(offers, dict):
                value = {**value, **offers}
            if value.get('price') is not None and found.get('price') is None:
                found['price'] = value.get('price')
            if value.get('priceCurrency') and not found.get('currency'):
                found['currency'] = value.get('priceCurrency')
            if value.get('availability') and not found.get('availability'):
                found['availability'] = value.get('availability')
        for child in value.values():
            visit(child)

    for script in re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.IGNORECASE | re.DOTALL,
    ):
        try:
            visit(json.loads(html_module.unescape(script)))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
    return found


def _search_bing_html(query: str, limit: int) -> list[dict]:
    """Recherche sans clé sur Bing, en région France.

    Chaque résultat correspond à un vrai bloc de résultats (``<h2><a>``), et
    l'URL réelle est récupérée après décodage de la redirection.
    """
    url = (
        'https://www.bing.com/search'
        f'?q={quote_plus(query)}&setlang=fr&cc=FR&count={limit * 3}'
    )
    response = httpx.get(
        url,
        headers={
            'User-Agent': _user_agent(),
            'Accept-Language': 'fr-FR,fr;q=0.9',
            'Accept': 'text/html,application/xhtml+xml',
        },
        timeout=_timeout(),
        follow_redirects=True,
    )
    response.raise_for_status()

    results: list[dict] = []
    seen_urls: set[str] = set()
    per_domain: dict[str, int] = {}

    pattern = re.compile(r'<h2>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL)
    for href, title_html in pattern.findall(response.text):
        target = clean_url(_decode_bing_url(href))
        if not target or target in seen_urls:
            continue

        domain = domain_of(target)
        # Au maximum deux liens par site : une seule enseigne ne doit pas
        # occuper toute la liste des candidats.
        if per_domain.get(domain, 0) >= 2:
            continue

        seen_urls.add(target)
        per_domain[domain] = per_domain.get(domain, 0) + 1
        results.append({
            'url': target,
            'domain': domain,
            'title': _strip_tags(title_html),
            'snippet': '',
            'price': None,
            'currency': 'EUR',
        })

        if len(results) >= limit:
            break

    return results


def _search_brave(query: str, limit: int) -> list[dict]:
    """Recherche via l'API Brave (clé requise, résultats structurés)."""
    response = httpx.get(
        'https://api.search.brave.com/res/v1/web/search',
        params={'q': query, 'country': 'FR', 'search_lang': 'fr', 'count': limit},
        headers={'X-Subscription-Token': settings.BRAVE_SEARCH_API_KEY,
                 'Accept': 'application/json'},
        timeout=_timeout(),
    )
    response.raise_for_status()

    results = []
    for item in ((response.json().get('web') or {}).get('results') or [])[:limit]:
        target = clean_url(item.get('url') or '')
        if not target:
            continue
        results.append({
            'url': target,
            'domain': domain_of(target),
            'title': str(item.get('title') or '').strip(),
            'snippet': str(item.get('description') or '').strip(),
            'price': None,
            'currency': 'EUR',
        })
    return results


def _search_serpapi(query: str, limit: int) -> list[dict]:
    """Recherche via SerpAPI (clé requise, résultats Google structurés)."""
    response = httpx.get(
        'https://serpapi.com/search.json',
        params={'engine': 'google', 'q': query, 'gl': 'fr', 'hl': 'fr',
                'num': limit, 'api_key': settings.SERP_API_KEY},
        timeout=_timeout(),
    )
    response.raise_for_status()

    results = []
    for item in (response.json().get('organic_results') or [])[:limit]:
        target = clean_url(item.get('link') or '')
        if not target:
            continue
        results.append({
            'url': target,
            'domain': domain_of(target),
            'title': str(item.get('title') or '').strip(),
            'snippet': str(item.get('snippet') or '').strip(),
            'price': None,
            'currency': 'EUR',
        })
    return results


# ---------------------------------------------------------------------------
# Cache partagé (verrouillé) — les mêmes requêtes reviennent d'une analyse à
# l'autre, mais deux analyses concurrentes ne doivent jamais se le voler.
# ---------------------------------------------------------------------------

def _cache_get(key: str) -> list[dict] | None:
    with _CACHE_LOCK:
        store = cache.get(_CACHE_KEY) or {}
    entry = store.get(key)
    return entry if isinstance(entry, list) else None


def _cache_put(key: str, results: list[dict]) -> None:
    with _CACHE_LOCK:
        store = cache.get(_CACHE_KEY) or {}
        if not isinstance(store, dict):
            store = {}
        if len(store) >= CACHE_MAX_ENTRIES:
            store = {}
        store[key] = results
        cache.set(_CACHE_KEY, store, _cache_ttl())


def clear_cache() -> None:
    """Vide le cache de recherche (tests et outillage)."""
    with _CACHE_LOCK:
        cache.delete(_CACHE_KEY)


def _usable_results(results: list[dict]) -> list[dict]:
    """Ré-applique le nettoyage (schéma, longueur, domaines exclus).

    Le cache peut contenir un lien retenu **avant** qu'un domaine soit ajouté
    aux exclusions (dictionnaire, presse…). Un lien périmé ne doit jamais
    resurgir : on le réévalue à chaque lecture, comme un résultat neuf.
    """
    usable = []
    for result in results or []:
        url = clean_url(str(result.get('url') or ''))
        if not url:
            continue
        entry = dict(result)
        entry['url'] = url
        entry['domain'] = domain_of(url)
        usable.append(entry)
    return usable


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def configured_provider() -> str:
    """Nom du moteur utilisé : ``brave`` / ``serpapi`` si une clé existe,
    sinon ``bing`` (recherche sans clé, toujours disponible)."""
    if getattr(settings, 'BRAVE_SEARCH_API_KEY', ''):
        return 'brave'
    if getattr(settings, 'SERP_API_KEY', ''):
        return 'serpapi'
    return 'bing'


def has_api_key() -> bool:
    """True si un moteur payant est configuré (il peut alors remonter des prix)."""
    return configured_provider() != 'bing'


def provider_label() -> str:
    return {'bing': 'Bing', 'brave': 'Brave Search', 'serpapi': 'SerpAPI'}.get(
        configured_provider(), 'Bing'
    )


def search_info(session: SearchSession | None = None) -> dict:
    """État de la recherche, transmis au front pour un affichage honnête."""
    keyless = not has_api_key()
    session = session or SearchSession()
    return {
        'provider': configured_provider(),
        'provider_label': provider_label(),
        'keyless': keyless,
        'searched': session.searched,
        'found': session.found,
        'failed': session.failed,
        'capped': session.capped,
        'note': (
            'Recherche web sans clé : les liens sont de vraies pages produits '
            'trouvées sur le web, mais les prix restent des estimations IA.'
            if keyless else
            'Recherche web via une API configurée.'
        ),
    }


@dataclass
class SearchOutcome:
    """Résultat d'une recherche, avec la distinction cruciale :
    ``failed`` (panne réseau / quota) ≠ ``aucun résultat pertinent``."""

    results: list[dict]
    failed: bool = False
    capped: bool = False
    from_cache: bool = False


def search_offers(query: str, session: SearchSession | None = None) -> SearchOutcome:
    """Renvoie de **vraies** pages de vente pour ``query``.

    Cette fonction ne lève jamais d'exception : une recherche cassée produit
    ``failed=True`` et une liste vide, ce qui n'a **jamais** été ni ne sera un
    motif d'ambiguïté pour la ressource correspondante.
    """
    session = session or new_session(max_searches=0)
    cleaned = normalise_query(query)
    if not cleaned:
        return SearchOutcome(results=[])

    cached = _cache_get(cleaned)
    if cached is not None:
        usable = _usable_results(cached)
        # Vide parce qu'il n'y avait vraiment rien : résultat légitime, servi
        # depuis le cache. Non vide mais entièrement périmé (domaines désormais
        # exclus) : on relance une vraie recherche.
        if usable or not cached:
            session.record_found(len(usable))
            return SearchOutcome(results=usable, from_cache=True)

    if not session.try_consume():
        session.record_capped()
        return SearchOutcome(results=[], capped=True)

    limit = max(1, min(int(_max_results()), _max_results()))
    provider = configured_provider()

    try:
        if provider == 'brave':
            results = _search_brave(cleaned, limit)
        elif provider == 'serpapi':
            results = _search_serpapi(cleaned, limit)
        else:
            results = _search_bing_html(cleaned, limit)
    except httpx.HTTPError as error:
        logger.warning('Recherche web « %s » injoignable : %s', query, error)
        session.record_failure()
        return SearchOutcome(results=[], failed=True)
    except Exception:  # noqa: BLE001 — une recherche ne doit jamais casser l'analyse
        logger.exception('Recherche web « %s » en échec.', query)
        session.record_failure()
        return SearchOutcome(results=[], failed=True)

    results = _usable_results(results)
    _cache_put(cleaned, results)
    session.record_found(len(results))

    logger.info('Recherche web « %s » → %d résultat(s).', query, len(results))
    return SearchOutcome(results=results)


# ---------------------------------------------------------------------------
# Validation d'une page retenue comme offre
# ---------------------------------------------------------------------------

def _identity_tokens(text: str) -> list[str]:
    """Tokens signifiants d'un nom de ressource, dépluralisés naïvement.

    Sert à vérifier qu'une page parle bien de la ressource demandée : un nom
    (souvent au pluriel : « chaises pliables ») doit apparaître entier, sans
    liste de mots métier.
    """
    tokens: list[str] = []
    for token in normalise_query(text).split():
        if len(token) < 3:
            continue
        if token.endswith('s') and len(token) > 3:
            token = token[:-1]
        if token not in tokens:
            tokens.append(token)
    return tokens


def validate_direct_offer(raw_url: str, query: str = '', identity: str = '') -> dict:
    """Contrôle une page candidate et rend un **verdict** explicite.

    Trois verdicts, jamais confondus :

      - ``verified``   : page réellement atteinte, marchande et pertinente ;
      - ``rejected``   : page prouvée non exploitable (accueil, rubrique,
        dictionnaire, article de presse, page sans rapport avec la ressource) ;
      - ``unreachable``: page non atteinte (réseau, délai) — on ne peut ni la
        valider ni la réfuter.

    Le prix lu sur la page n'est retenu que par le verdict ``verified`` :
    ``price_verified`` le dit séparément de la validité du lien.
    """
    def verdict(kind: str, reason: str, **fields) -> dict:
        return {'verdict': kind, 'reason': reason, **fields}

    url = clean_url(raw_url)
    if not url:
        return verdict('rejected', "adresse invalide ou domaine non marchand")
    if not looks_like_product_page(url):
        return verdict('rejected', "page d'accueil, rubrique, recherche ou article")

    try:
        response = httpx.get(
            url,
            headers={'User-Agent': _user_agent(), 'Accept-Language': 'fr-FR,fr;q=0.9'},
            timeout=_timeout(),
            follow_redirects=True,
        )
        response.raise_for_status()
    except (httpx.HTTPError, ValueError):
        logger.info('Page fournisseur inaccessible: %s', url)
        return verdict('unreachable', "page inaccessible au moment de l'analyse")

    final_url = clean_url(str(response.url))
    if not final_url or not looks_like_product_page(final_url):
        return verdict('rejected', "page d'accueil, rubrique, recherche ou article")

    html = response.text[:1_000_000]
    title_match = re.search(r'<title[^>]*>(.*?)</title>', html, re.I | re.S)
    title = _strip_tags(title_match.group(1)) if title_match else ''
    canonical_match = re.search(
        r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)', html, re.I
    )
    canonical = clean_url(canonical_match.group(1)) if canonical_match else final_url

    # Pertinence mesurée sur le **nom de la ressource** : la page doit parler
    # de ce qui a été demandé. Les mots du lieu ou de la phrase de description
    # ne suffisent pas (« lyon », « pour » apparaissent partout).
    text = normalise_query(' '.join((title, html_module.unescape(html[:120000]))))
    identity_tokens = _identity_tokens(identity)
    if not identity_tokens:
        identity_tokens = [token for token in _identity_tokens(query) if len(token) > 3]
    missing = [token for token in identity_tokens if token not in text]
    if missing:
        return verdict(
            'rejected',
            "la page ne mentionne pas " + ', '.join(missing),
        )

    # La page parle bien de la ressource, mais propose-t-elle quelque chose ?
    # Un dictionnaire d'expressions, une fiche explicative ou une actualité
    # citent le mot sans jamais vendre : ce n'est pas une offre.
    if not _COMMERCIAL_SIGNAL.search(html):
        return verdict(
            'rejected',
            "la page parle de la ressource mais ne propose ni prix, ni tarif, "
            "ni commande",
        )

    structured = _structured_commerce(html)
    currency = str(structured.get('currency') or '').upper()
    if not re.fullmatch(r'[A-Z]{3}', currency):
        currency = ''
    price = None
    structured_price = structured.get('price')
    if structured_price is not None and currency:
        try:
            price = float(str(structured_price).replace(',', '.'))
        except (TypeError, ValueError):
            price = None
    if price is not None and price <= 0:
        price = None
    availability = None
    structured_availability = str(structured.get('availability') or '').lower()
    if structured_availability:
        availability = 'outofstock' not in structured_availability
    return verdict(
        'verified',
        '',
        url=canonical,
        domain=domain_of(canonical),
        title=title,
        price=price,
        currency=currency,
        verified=True,
        price_verified=price is not None and bool(currency),
        available=availability,
    )
