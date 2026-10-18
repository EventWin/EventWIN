from rest_framework import serializers

from .models import BudgetItem


class BudgetItemSerializer(serializers.ModelSerializer):
    """Ressource budgétaire.

    L'organisateur ne renseigne que ``name``, ``category``, ``quantity`` et
    ``description``. Tous les champs monétaires, le classement « ambiguë » et
    la recommandation d'achat sont en lecture seule : ils sont produits par le
    moteur d'estimation IA et ne doivent jamais pouvoir être falsifiés depuis
    le client.

    Note sur la validation du nom : un libellé vague n'est **plus refusé** à la
    création. Il est enregistré, puis classé « ressource ambiguë » au moment de
    l'analyse, avec une raison précise, et exclus du calcul budgétaire. C'est
    l'organisateur qui voit la raison et qui décide de reformuler.

    Trois états sont donc possibles après analyse :

    - comprise et chiffrée : ``total`` renseigné ;
    - comprise mais non chiffrée : ``total`` à ``None``, ``is_ambiguous`` faux
      et ``unpriced_reason`` renseigné (l'IA a compris mais n'a osé aucun
      montant) ;
    - ambiguë : ``is_ambiguous`` vrai et ``ambiguity_reason`` renseigné.
    """

    category_label = serializers.CharField(source='get_category_display', read_only=True)

    class Meta:
        model = BudgetItem
        fields = [
            'id',
            'event',
            'name',
            'category',
            'category_label',
            'quantity',
            'min_quantity',
            'is_essential',
            'description',
            'unit_price',
            'total',
            'price_source',
            'provider',
            'product_url',
            'confidence',
            'price_range_min',
            'price_range_max',
            'estimated_at',
            'analysis_status',
            'is_ambiguous',
            'ambiguity_reason',
            'offer_title',
            'offer_domain',
            'offer_note',
            'offer_price',
            'offer_currency',
            'offer_verified_at',
            'offer_available',
            'unpriced_reason',
            'created_at',
        ]
        read_only_fields = [
            'id',
            'created_at',
            'unit_price',
            'total',
            'price_source',
            'provider',
            'product_url',
            'confidence',
            'price_range_min',
            'price_range_max',
            'estimated_at',
            'analysis_status',
            'is_ambiguous',
            'ambiguity_reason',
            'offer_title',
            'offer_domain',
            'offer_note',
            'offer_price',
            'offer_currency',
            'offer_verified_at',
            'offer_available',
            'unpriced_reason',
        ]

    def validate_quantity(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError('La quantité doit être supérieure à zéro.')
        return value

    def validate(self, attrs):
        min_quantity = attrs.get("min_quantity")
        quantity = attrs.get("quantity", getattr(self.instance, "quantity", None))
        if min_quantity is not None and (min_quantity <= 0 or quantity is not None and min_quantity > quantity):
            raise serializers.ValidationError(
                {"min_quantity": "La quantité minimale doit être positive et inférieure ou égale à la quantité."}
            )
        if self.instance is not None and "event" in attrs and attrs["event"] != self.instance.event:
            raise serializers.ValidationError({"event": "L'événement ne peut pas être modifié."})
        return attrs

    def validate_name(self, value):
        """Un nom est requis, mais il n'est jamais rejeté pour être « vague ».

        Un libellé inexploitable est conservé tel quel : l'analyse le placera
        dans le tableau « Ressources ambiguës » avec une raison, ce qui est
        plus utile à l'organisateur qu'un refus au moment de la saisie.
        """
        cleaned = (value or '').strip()
        if not cleaned:
            raise serializers.ValidationError('Le nom de la ressource est obligatoire.')
        return cleaned
