from django.contrib import admin

from .models import BudgetItem


@admin.register(BudgetItem)
class BudgetItemAdmin(admin.ModelAdmin):
    """Vue d'administration : tout ce que l'IA produit est en lecture seule.

    Un administrateur ne peut pas fabriquer un prix, une offre ou un classement
    « ambiguë » depuis l'interface : seuls les champs saisis par l'organisateur
    (nom, catégorie, quantité, description) sont modifiables ici.
    """

    list_display = (
        'name', 'event', 'category', 'quantity', 'unit_price', 'total',
        'price_source', 'analysis_status',
    )
    list_filter = ('category', 'price_source', 'analysis_status', 'is_ambiguous')
    search_fields = ('name', 'event__name')
    readonly_fields = (
        'unit_price', 'total', 'price_source', 'provider', 'product_url',
        'confidence', 'estimated_at',
        # État de l'analyse : ni le statut ni ses conséquences ne sont
        # modifiables à la main, sous peine d'incohérence avec le moteur.
        'analysis_status', 'analysis_fingerprint',
        'is_ambiguous', 'ambiguity_reason', 'unpriced_reason',
        'offer_title', 'offer_domain', 'offer_note',
        'offer_price', 'offer_currency', 'offer_verified_at', 'offer_available',
    )
