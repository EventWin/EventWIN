from django.contrib import admin
from django import forms
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
import string
import random
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.conf import settings

from .models import (
    UserRole,
    User,
    Participant,
    Organizer,
    AdminUser,
    EventParticipant,
    ParticipantPreference,
    ParticipantConstraint
)


@admin.register(User)
class CustomUserAdmin(BaseUserAdmin):
    """
    Administration de la table principale User (tous les attributs communs).
    """
    list_display = ('username', 'email', 'get_role_badge', 'full_name', 'phone', 'organization', 'is_staff', 'is_active')
    list_filter = ('role', 'is_staff', 'is_superuser', 'is_active', 'status')
    search_fields = ('username', 'email', 'first_name', 'last_name', 'phone')
    ordering = ('-date_joined',)
    
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Attributs Applicatifs Métier', {
            'fields': ('role', 'phone', 'photo', 'status', 'organization')
        }),
    )

    def get_role_badge(self, obj):
        if obj.role == UserRole.ADMIN or obj.is_superuser:
            return "👑 Admin"
        elif obj.role == UserRole.ORGANIZER or obj.is_staff:
            return "🏢 Organisateur"
        return "👤 Participant"
    get_role_badge.short_description = "Rôle"


@admin.register(Participant)
class ParticipantAdmin(admin.ModelAdmin):
    """
    Administration de la sous-classe Participant (Spécialisation).
    """
    list_display = ('username', 'email', 'full_name', 'badge_code', 'phone', 'organization', 'status', 'date_joined')
    list_filter = ('status', 'organization')
    search_fields = ('username', 'email', 'first_name', 'last_name', 'phone', 'badge_code')
    ordering = ('-date_joined',)
    fields = ('username', 'email', 'first_name', 'last_name', 'badge_code', 'phone', 'photo', 'organization', 'status')


class OrganizerAdminForm(forms.ModelForm):
    full_name = forms.CharField(label="Nom Complet de l'Organisateur", max_length=255)
    email = forms.EmailField(label="Adresse E-mail")
    
    class Meta:
        model = Organizer
        fields = ['full_name', 'email', 'license_type', 'organization', 'status']
        
    def save(self, commit=True):
        instance = super().save(commit=False)
        email = self.cleaned_data.get('email')
        full_name = self.cleaned_data.get('full_name')
        
        if not instance.pk:
            alphabet = string.ascii_letters + string.digits
            password = ''.join(random.choice(alphabet) for _ in range(8))
            parts = full_name.split(' ', 1)
            first_name = parts[0]
            last_name = parts[1] if len(parts) > 1 else ''
            
            instance.username = email
            instance.first_name = first_name
            instance.last_name = last_name
            instance.email = email
            instance.set_password(password)
            instance.role = UserRole.ORGANIZER
            instance.is_staff = True
            
            try:
                html_content = render_to_string('emails/organizer_invite.html', {
                    'full_name': full_name,
                    'email': email,
                    'password': password
                })
                sujet = "Vos accès Organisateur EventTwin"
                msg = EmailMultiAlternatives(
                    sujet, 
                    f"Vos accès : {email} / {password}", 
                    settings.EMAIL_HOST_USER, 
                    [email]
                )
                msg.attach_alternative(html_content, "text/html")
                msg.send()
            except Exception as e:
                print(f"Erreur d'envoi d'email admin : {e}")
                
        if commit:
            instance.save()
        return instance


@admin.register(Organizer)
class OrganizerAdmin(admin.ModelAdmin):
    """
    Administration de la sous-classe Organisateur.
    """
    form = OrganizerAdminForm
    list_display = ('username', 'email', 'full_name', 'license_type', 'organization', 'status', 'date_joined')
    list_filter = ('status', 'license_type')
    search_fields = ('username', 'email', 'first_name', 'last_name')
    ordering = ('-date_joined',)


@admin.register(AdminUser)
class AdminUserAdmin(admin.ModelAdmin):
    """
    Administration de la sous-classe Administrateur.
    """
    list_display = ('username', 'email', 'full_name', 'phone', 'status', 'date_joined')
    search_fields = ('username', 'email', 'first_name', 'last_name')
    ordering = ('-date_joined',)


admin.site.register(EventParticipant)
admin.site.register(ParticipantPreference)
admin.site.register(ParticipantConstraint)
