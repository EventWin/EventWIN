from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.event_filter import EventFilterMixin
from apps.organizations.models import Organization
from .models import EventParticipant, Participant, ParticipantConstraint, ParticipantPreference
from .serializers import (
    EventParticipantSerializer,
    ParticipantConstraintSerializer,
    ParticipantPreferenceSerializer,
    ParticipantSerializer,
)


class ParticipantViewSet(viewsets.ModelViewSet):
    queryset = (
        Participant.objects.select_related('organization', 'user')
        .prefetch_related('preferences', 'constraints')
        .all()
        .order_by('user__username')
    )
    serializer_class = ParticipantSerializer

    @action(detail=False, methods=['post'])
    def login(self, request):
        email = request.data.get('email')
        password = request.data.get('password')
        if not email or not password:
            return Response({'error': 'Email and password are required'}, status=status.HTTP_400_BAD_REQUEST)
        
        from django.contrib.auth.models import User
        
        user = User.objects.filter(email=email).first()
        if not user:
            user = User.objects.filter(username=email).first()
            
        if user and user.check_password(password):
            profile = Participant.objects.filter(user=user).first()
            role = 'admin' if user.is_superuser else getattr(profile, 'role', 'participant')
            return Response({
                'message': 'Login successful',
                'participant': {
                    # Participant UUID when a profile exists, so preferences/constraints/profile calls resolve
                    'id': str(profile.id) if profile else user.id,
                    'email': user.email,
                    'full_name': user.username,
                    'role': role
                }
            })
            
        return Response({'error': 'Identifiants incorrects'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['post'])
    def register(self, request):
        email = request.data.get('email')
        full_name = request.data.get('full_name')
        password = request.data.get('password')
        
        if not email or not full_name or not password:
            return Response({'error': 'Email, full_name, and password are required'}, status=status.HTTP_400_BAD_REQUEST)
            
        from django.contrib.auth.models import User
        if User.objects.filter(email=email).exists():
            return Response({'error': 'Cet e-mail est déjà utilisé ou invalide.'}, status=status.HTTP_400_BAD_REQUEST)
            
        org = Organization.objects.first()
        if not org:
            org = Organization.objects.create(name="Default Organization", legal_name="Default Org")
            
        user = User.objects.create_user(username=full_name, email=email, password=password)
        
        participant = Participant.objects.create(
            user=user,
            organization=org,
            role='participant',
            status='active'
        )
        
        try:
            from django.core.mail import EmailMultiAlternatives
            from django.template.loader import render_to_string
            from django.conf import settings
            
            html_content = render_to_string('emails/welcome.html', {'full_name': full_name})
            msg = EmailMultiAlternatives("Bienvenue sur EventTwin !", "Bienvenue", settings.EMAIL_HOST_USER, [email])
            msg.attach_alternative(html_content, "text/html")
            msg.send()
        except Exception as e:
            print(f"!!! ERREUR D'ENVOI EMAIL BIENVENUE : {e} !!!")
            
        return Response({
            'message': 'Registration successful',
            'participant': ParticipantSerializer(participant).data
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def create_organizer(self, request):
        email = request.data.get('email')
        full_name = request.data.get('full_name')
        
        if not email or not full_name:
            return Response({'error': 'L\'email et le nom complet sont requis.'}, status=status.HTTP_400_BAD_REQUEST)
            
        from django.contrib.auth.models import User
        if User.objects.filter(email=email).exists():
            return Response({'error': 'Cet e-mail est déjà utilisé.'}, status=status.HTTP_400_BAD_REQUEST)
            
        import string, random
        alphabet = string.ascii_letters + string.digits
        password = ''.join(random.choice(alphabet) for i in range(8))
        
        org = Organization.objects.first()
        if not org:
            org = Organization.objects.create(name="Default Organization", legal_name="Default Org")
            
        user = User.objects.create_user(username=full_name, email=email, password=password)
        participant = Participant.objects.create(
            user=user,
            organization=org,
            role='organizer',
            status='active'
        )
        
        try:
            from django.core.mail import EmailMultiAlternatives
            from django.template.loader import render_to_string
            from django.conf import settings
            
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
            print(f"!!! ERREUR CRITIQUE D'ENVOI D'EMAIL : {e} !!!")
            
        return Response({
            'message': 'Organisateur créé avec succès',
            'participant': ParticipantSerializer(participant).data
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def reset_password(self, request):
        email = request.data.get('email')
        if not email:
            return Response({'error': 'L\'email est requis.'}, status=status.HTTP_400_BAD_REQUEST)
            
        from django.contrib.auth.models import User
        user = User.objects.filter(email=email).first()
        
        if not user:
            return Response({'error': 'Aucun compte associé à cet e-mail.'}, status=status.HTTP_404_NOT_FOUND)
            
        import string, random
        alphabet = string.ascii_letters + string.digits
        new_password = ''.join(random.choice(alphabet) for i in range(8))
        
        user.set_password(new_password)
        user.save()
        
        try:
            from django.core.mail import EmailMultiAlternatives
            from django.template.loader import render_to_string
            from django.conf import settings
            
            html_content = render_to_string('emails/reset_password.html', {
                'full_name': user.username,
                'password': new_password
            })
            
            sujet = "Réinitialisation de votre mot de passe EventTwin"
            msg = EmailMultiAlternatives(
                sujet, 
                f"Nouveau mot de passe : {new_password}", 
                settings.EMAIL_HOST_USER, 
                [email]
            )
            msg.attach_alternative(html_content, "text/html")
            msg.send()
        except Exception as e:
            print(f"!!! ERREUR D'ENVOI EMAIL RESET PASSWORD : {e} !!!")
            return Response({'error': 'Mot de passe modifié mais échec de l\'envoi de l\'email.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
        return Response({'message': 'Un e-mail de réinitialisation a été envoyé.'})

    @action(detail=False, methods=['get'])
    def get_organizers(self, request):
        organizers = Participant.objects.filter(role='organizer').order_by('-created_at')
        return Response(ParticipantSerializer(organizers, many=True).data)


class EventParticipantViewSet(EventFilterMixin, viewsets.ModelViewSet):
    queryset = EventParticipant.objects.select_related('event', 'participant').all().order_by('-created_at')
    serializer_class = EventParticipantSerializer


class ParticipantPreferenceViewSet(viewsets.ModelViewSet):
    queryset = ParticipantPreference.objects.select_related('participant').all().order_by('preference_type')
    serializer_class = ParticipantPreferenceSerializer


class ParticipantConstraintViewSet(viewsets.ModelViewSet):
    queryset = ParticipantConstraint.objects.select_related('participant').all().order_by('constraint_type')
    serializer_class = ParticipantConstraintSerializer