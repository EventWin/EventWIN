from django.contrib import admin
from django import forms
from django.contrib.auth.models import User
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
import string, random
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.conf import settings
from apps.organizations.models import Organization

from .models import Participant, EventParticipant, ParticipantPreference, ParticipantConstraint, Organizer

# Affichage du rôle de chaque utilisateur dans la table auth_user
class CustomUserAdmin(BaseUserAdmin):
    list_display = ('username', 'email', 'get_role', 'first_name', 'last_name', 'is_staff', 'is_active')
    list_filter = ('is_staff', 'is_superuser', 'is_active')

    def get_role(self, obj):
        if obj.is_superuser:
            return "👑 Administrateur"
        if hasattr(obj, 'profile') and obj.profile:
            r = obj.profile.role
            if r == 'organizer':
                return "🏢 Organisateur"
            elif r == 'participant':
                return "👤 Participant"
            elif r == 'admin':
                return "👑 Administrateur"
        if obj.is_staff:
            return "🏢 Organisateur"
        return "👤 Participant"
    get_role.short_description = "Rôle"

admin.site.unregister(User)
admin.site.register(User, CustomUserAdmin)

@admin.register(Participant)
class ParticipantAdmin(admin.ModelAdmin):
    list_display = ('user', 'role', 'phone', 'organization', 'status', 'created_at')
    list_filter = ('role', 'status')
    search_fields = ('user__username', 'user__email', 'phone')
    fields = ('user', 'role', 'organization', 'phone', 'photo', 'status')

    def get_queryset(self, request):
        return super().get_queryset(request).filter(role='participant')

class OrganizerAdminForm(forms.ModelForm):
    full_name = forms.CharField(label="Nom Complet de l'Organisateur", max_length=255)
    email = forms.EmailField(label="Adresse E-mail")
    
    class Meta:
        model = Organizer
        fields = ['full_name', 'email', 'organization', 'status']
        
    def save(self, commit=True):
        instance = super().save(commit=False)
        email = self.cleaned_data.get('email')
        full_name = self.cleaned_data.get('full_name')
        
        # S'il est nouveau, on crée l'utilisateur et on envoie l'email
        if not instance.user:
            alphabet = string.ascii_letters + string.digits
            password = ''.join(random.choice(alphabet) for i in range(8))
            
            user = User.objects.create_user(username=full_name, email=email, password=password)
            instance.user = user
            instance.role = 'organizer'
            
            # Envoi de l'email
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
    form = OrganizerAdminForm
    list_display = ('user', 'organization', 'status', 'created_at')
    
    def get_queryset(self, request):
        return super().get_queryset(request).filter(role='organizer')
        
    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)

admin.site.register(EventParticipant)
admin.site.register(ParticipantPreference)
admin.site.register(ParticipantConstraint)
