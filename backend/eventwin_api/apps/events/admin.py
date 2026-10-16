from django.contrib import admin
from .models import Event, EventScheduleItem, Resource

@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ('name', 'start_date', 'end_date', 'status', 'target_budget')
    search_fields = ('name', 'location')
    list_filter = ('status',)

@admin.register(EventScheduleItem)
class EventScheduleItemAdmin(admin.ModelAdmin):
    list_display = ('title', 'event', 'starts_at', 'ends_at', 'category')
    search_fields = ('title', 'category')
    list_filter = ('category',)

@admin.register(Resource)
class ResourceAdmin(admin.ModelAdmin):
    list_display = ('name', 'event', 'resource_type', 'capacity', 'unit_cost')
    list_filter = ('resource_type',)
