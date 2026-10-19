import hashlib

from django.db import models

from apps.base_models import UUIDTimestampedModel

from .textutils import normalize_text

# --- États d'une ressource ---------------------------------------------------
# L'état est **stocké**, jamais déduit d'une combinaison de champs : déduire
# l'état de ``is_ambiguous`` + ``total`` + ``unpriced_reason`` était fragile
# (trois champs, neuf combinaisons possibles, aucune contrôlée).
ANALYSIS_STATUSES = [
    ('pending', 'En attente d’analyse'),
    ('priced', 'Comprise et chiffrée'),
    ('understood_unpriced', 'Comprise, non chiffrée'),
    ('ambiguous', 'Ressource ambiguë'),
    ('search_unavailable', 'Recherche web indisponible'),
    ('analysis_failed', 'Analyse échouée'),
]

# États dans lesquels la ressource est **exclue** : aucun prix, ni fournisseur.
EXCLUDED_STATUSES = ('ambiguous', 'analysis_failed', 'search_unavailable')

PRICE_SOURCES = [
    ('', 'Non déterminé'),
    ('ai_estimate', 'Estimation IA'),
    ('real_offer', 'Prix relevé sur une page réelle'),
]


class BudgetItem(UUIDTimestampedModel):
    """Ressource / poste budgétaire rattaché à un événement.

    L'organisateur ne saisit jamais de prix : il décrit la ressource
    (nom, quantité, catégorie, description). Les champs monétaires sont
    renseignés exclusivement par le moteur d'estimation IA (voir
    ``apps.budgets.estimations``). Le rattachement se fait par une vraie clé
    étrangère vers ``events.Event`` dont la clé primaire est un UUID, ce qui
    garantit l'isolation stricte des données entre événements.
    """

    CATEGORIES = [
        ('tables_chaises', 'Tables et chaises'),
        ('restauration', 'Repas, boissons et gâteaux'),
        ('decoration', 'Décoration et fleurs'),
        ('audiovisuel', 'Matériel audio et vidéo'),
        ('equipement', 'Tentes, éclairage et équipements'),
        ('transport', 'Transport et autres services'),
        ('autre', 'Autre'),
    ]

    event = models.ForeignKey(
        'events.Event',
        on_delete=models.CASCADE,
        related_name='budget_items',
    )
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=50, choices=CATEGORIES, default='autre')
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    min_quantity = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    is_essential = models.BooleanField(default=False)
    description = models.TextField(blank=True)

    # Champs remplis par l'IA, jamais par l'organisateur.
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    total = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    # ``real_offer`` uniquement si un tarif a réellement été extrait de la page
    # retenue. ``ai_estimate`` reste une estimation, jamais un prix fournisseur.
    price_source = models.CharField(max_length=20, blank=True, choices=PRICE_SOURCES)
    provider = models.CharField(max_length=255, blank=True)
    # Jamais tronqué : une URL coupée à 500 caractères est un lien mort.
    # Au-delà de la longueur supportée, le lien est écarté entièrement.
    product_url = models.URLField(max_length=2048, blank=True)
    confidence = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    price_range_min = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    price_range_max = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    estimated_at = models.DateTimeField(null=True, blank=True)

    # --- État d'analyse -------------------------------------------------------
    # Source de vérité pour le front et pour les calculs : voir
    # ``ANALYSIS_STATUSES``. Les champs historiques (``is_ambiguous``,
    # ``total``…) restent produits pour ne pas casser le contrat JSON.
    analysis_status = models.CharField(
        max_length=32, choices=ANALYSIS_STATUSES, default='pending'
    )
    # Empreinte de la ressource (nom + description + catégorie + type
    # d'événement). La quantité n'en fait **pas** partie : la changer doit
    # seulement recalculer le total, sans ré-analyser la ressource.
    analysis_fingerprint = models.CharField(max_length=64, blank=True, db_index=True)

    # --- Ressource ambiguë : exclue de l'analyse budgétaire -----------------
    # Quand ni le nom ni la description ne permettent de savoir ce qu'il faut
    # chiffrer, la ressource est mise de côté avec une raison explicite. Elle
    # ne reçoit alors AUCUN prix, AUCUN fournisseur et n'entre dans AUCUN
    # calcul (les champs monétaires ci-dessus restent à ``None``).
    is_ambiguous = models.BooleanField(default=False)
    ambiguity_reason = models.TextField(blank=True)

    # --- Recommandation d'achat réelle (page trouvée sur le web) -----------
    # Ces champs ne sont renseignés que lorsqu'une page produit **réellement
    # trouvée** par la recherche web a été retenue. Ils ne sont jamais produits
    # par le LLM, qui ne peut que choisir dans la liste des résultats.
    offer_title = models.CharField(max_length=300, blank=True)
    offer_domain = models.CharField(max_length=255, blank=True)
    offer_note = models.TextField(blank=True)
    # Prix réellement relevé sur la page. Reste ``None`` avec la recherche sans
    # clé : le prix affiché est alors une estimation IA, jamais celui du
    # fournisseur.
    offer_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    offer_currency = models.CharField(max_length=10, blank=True)
    offer_verified_at = models.DateTimeField(null=True, blank=True)
    offer_available = models.BooleanField(null=True, blank=True)

    # --- Ressource comprise mais non chiffrée -------------------------------
    # Cas fréquent pour les services (« musicien », « DJ ») : le nom est
    # parfaitement compris, mais l'IA n'ose aucun montant. La ressource n'est
    # PAS ambiguë — elle garde sa page fournisseur réelle — mais elle ne pèse
    # sur aucun calcul, et la raison ci-dessous l'explique à l'organisateur.
    # Un ``total`` à ``None`` accompagné de ``is_ambiguous`` à faux signale
    # donc « comprise, non chiffrée ».
    unpriced_reason = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['category', 'name']
        constraints = [
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0),
                name='budget_item_quantity_positive',
            ),
            models.CheckConstraint(
                condition=models.Q(min_quantity__isnull=True)
                | models.Q(min_quantity__gte=0),
                name='budget_item_min_quantity_nonnegative',
            ),
            models.CheckConstraint(
                condition=models.Q(unit_price__isnull=True)
                | models.Q(unit_price__gte=0),
                name='budget_item_unit_price_nonnegative',
            ),
            models.CheckConstraint(
                condition=models.Q(total__isnull=True)
                | models.Q(total__gte=0),
                name='budget_item_total_nonnegative',
            ),
            models.CheckConstraint(
                condition=models.Q(price_range_min__isnull=True)
                | models.Q(price_range_min__gte=0),
                name='budget_item_price_range_min_nonnegative',
            ),
            models.CheckConstraint(
                condition=models.Q(price_range_max__isnull=True)
                | models.Q(price_range_max__gte=0),
                name='budget_item_price_range_max_nonnegative',
            ),
        ]

    def __str__(self):
        return self.name

    # --- Transitions d'état --------------------------------------------------
    # Centralisées ici : elles garantissent les invariants (aucun prix ni
    # fournisseur sur une ressource écartée, aucun montant zéro « gratuit »)
    # quel que soit le chemin d'appel (analyse, estimation, quantité, admin).
    def compute_fingerprint(self, event_type: str = '') -> str:
        """Empreinte déterministe de la ressource, **hors quantité**.

        ``event_type`` est passé en paramètre pour éviter une requête clé
        étrangère à chaque appel.
        """
        raw = '|'.join([
            normalize_text(self.name),
            normalize_text(self.description),
            self.category or '',
            event_type or '',
        ])
        return hashlib.sha256(raw.encode('utf-8')).hexdigest()

    def clear_priced_fields(self) -> None:
        """Remet à zéro tout ce qui pourrait être lu comme un prix ou un lien."""
        self.unit_price = None
        self.total = None
        self.price_source = ''
        self.confidence = None
        self.price_range_min = None
        self.price_range_max = None
        self.clear_offer_fields()

    def clear_offer_fields(self) -> None:
        """Purge le lien fournisseur sans toucher au prix.

        Utilisé quand l'adresse persistée ne passe plus la revalidation
        (domaine désormais exclu, URL malformée…) : un lien périmé ne doit
        jamais survivre à une analyse, y compris sur une ressource réutilisée.
        """
        self.provider = ''
        self.product_url = ''
        self.offer_title = ''
        self.offer_domain = ''
        self.offer_note = ''
        self.offer_price = None
        self.offer_currency = ''
        self.offer_verified_at = None
        self.offer_available = None

    def mark_ambiguous(self, reason: str, status: str = 'ambiguous') -> None:
        """Écarte la ressource : ni prix, ni fournisseur, ni calcul."""
        self.clear_priced_fields()
        self.is_ambiguous = True
        self.ambiguity_reason = reason or ''
        self.unpriced_reason = ''
        self.analysis_status = status
        self.estimated_at = None

    def mark_unpriced(
        self,
        reason: str,
        status: str = 'understood_unpriced',
        preserve_offer: bool = False,
    ) -> None:
        """Comprise mais non chiffrée : ``total`` reste ``None``, jamais 0.

        ``status`` permet de distinguer le cas où c'est la **recherche web**
        qui a manqué (``search_unavailable``) d'un refus pur du modèle de
        chiffrer (``understood_unpriced``) — l'organisateur n'a pas le même
        recours dans les deux cas.
        """
        saved_offer = None
        if preserve_offer and self.product_url:
            saved_offer = {
                'provider': self.provider,
                'product_url': self.product_url,
                'offer_title': self.offer_title,
                'offer_domain': self.offer_domain,
                'offer_note': self.offer_note,
                'offer_price': self.offer_price,
                'offer_currency': self.offer_currency,
                'offer_verified_at': self.offer_verified_at,
                'offer_available': self.offer_available,
            }
        self.clear_priced_fields()
        if saved_offer:
            for field, value in saved_offer.items():
                setattr(self, field, value)
        self.is_ambiguous = False
        self.ambiguity_reason = ''
        self.unpriced_reason = reason or ''
        self.analysis_status = status

    def mark_priced(self) -> None:
        self.is_ambiguous = False
        self.ambiguity_reason = ''
        self.unpriced_reason = ''
        self.analysis_status = 'priced'

    def reset_analysis(self) -> None:
        """Remet la ressource en attente (contenu modifié par l'organisateur)."""
        self.clear_priced_fields()
        self.is_ambiguous = False
        self.ambiguity_reason = ''
        self.unpriced_reason = ''
        self.analysis_status = 'pending'
        self.estimated_at = None
