from django.contrib import admin

from .models import (
    Sponsor,
    SponsorDeliverable,
    SponsorFitEvaluation,
    SponsorPayment,
    SponsorshipActivity,
    SponsorshipDeal,
    SponsorshipPackage,
)


@admin.register(Sponsor)
class SponsorAdmin(admin.ModelAdmin):
    list_display = ('name', 'organization', 'industry', 'relationship_status', 'contact_email', 'created_by')
    list_filter = ('industry', 'relationship_status', 'organization')
    search_fields = ('name', 'legal_name', 'contact_name', 'contact_email')


@admin.register(SponsorshipPackage)
class SponsorshipPackageAdmin(admin.ModelAdmin):
    list_display = ('name', 'event', 'tier_rank', 'price', 'slots_total', 'exclusive_industry', 'active')
    list_filter = ('active', 'exclusive_industry', 'event')
    search_fields = ('name',)


@admin.register(SponsorshipDeal)
class SponsorshipDealAdmin(admin.ModelAdmin):
    list_display = ('sponsor', 'event', 'status', 'cash_amount', 'currency', 'owner', 'probability_percent')
    list_filter = ('status', 'currency', 'event')
    search_fields = ('sponsor__name', 'notes')


@admin.register(SponsorshipActivity)
class SponsorshipActivityAdmin(admin.ModelAdmin):
    list_display = ('deal', 'action', 'actor', 'from_status', 'to_status', 'created_at')
    list_filter = ('action',)
    search_fields = ('message',)


@admin.register(SponsorDeliverable)
class SponsorDeliverableAdmin(admin.ModelAdmin):
    list_display = ('title', 'deal', 'deliverable_type', 'status', 'due_date')
    list_filter = ('status', 'deliverable_type')
    search_fields = ('title',)


@admin.register(SponsorPayment)
class SponsorPaymentAdmin(admin.ModelAdmin):
    list_display = ('label', 'deal', 'amount', 'status', 'due_date', 'invoice_ref')
    list_filter = ('status',)
    search_fields = ('label', 'invoice_ref')


@admin.register(SponsorFitEvaluation)
class SponsorFitEvaluationAdmin(admin.ModelAdmin):
    list_display = ('sponsor', 'event', 'fit_score', 'industry_match', 'budget_fit', 'evaluated_at')
    list_filter = ('industry_match', 'budget_fit')
