import re
import unicodedata
from urllib.parse import urlparse

from django.db.models import QuerySet

LEGAL_SUFFIX_RE = re.compile(
    r'\b(s\.?a\.?s\.?|s\.?a\.?r\.?l\.?|s\.?a\.?|inc\.?|ltd\.?|gmbh|llc|plc)\b',
    re.IGNORECASE,
)


def normalize_sponsor_name(name):
    if not name:
        return ''
    decomposed = unicodedata.normalize('NFD', str(name))
    stripped = ''.join(ch for ch in decomposed if unicodedata.category(ch) != 'Mn')
    stripped = LEGAL_SUFFIX_RE.sub(' ', stripped)
    stripped = re.sub(r'[^a-zA-Z0-9]+', ' ', stripped.lower())
    return re.sub(r'\s+', ' ', stripped).strip()


def normalize_website_domain(website):
    if not website:
        return ''
    raw = str(website).strip()
    if not raw:
        return ''
    if '://' not in raw:
        raw = 'https://' + raw
    host = (urlparse(raw).hostname or '').lower()
    if host.startswith('www.'):
        host = host[4:]
    return host


def find_duplicate_sponsors(organization, name, website=''):
    """Return sponsors of the same organization whose normalized name or domain match."""
    from .models import Sponsor

    org_id = getattr(organization, 'pk', organization)
    if not org_id:
        return []

    target_name = normalize_sponsor_name(name)
    target_domain = normalize_website_domain(website)
    if not target_name and not target_domain:
        return []

    matches = []
    queryset = Sponsor.objects.filter(organization_id=org_id)
    if isinstance(queryset, QuerySet):
        queryset = queryset.iterator()
    for sponsor in queryset:
        if target_name and normalize_sponsor_name(sponsor.name) == target_name:
            matches.append(sponsor)
            continue
        if target_domain and normalize_website_domain(sponsor.website) == target_domain:
            matches.append(sponsor)
    return matches


def log_activity(deal, actor, action, message='', **kwargs):
    from .models import SponsorshipActivity

    return SponsorshipActivity.objects.create(
        deal=deal,
        actor=actor,
        action=action,
        message=message or '',
        from_status=kwargs.get('from_status') or '',
        to_status=kwargs.get('to_status') or '',
    )
