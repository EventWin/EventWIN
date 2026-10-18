from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.organizations.models import Organization
from .models import EventParticipant, Participant, ParticipantConstraint, ParticipantPreference
from .serializers import (
    EventParticipantSerializer,
    ParticipantConstraintSerializer,
    ParticipantPreferenceSerializer,
    ParticipantSerializer,
)


OTP_TTL_SECONDS = 600
OTP_MAX_ATTEMPTS = 5


def _otp_key(email):
    return f"participant_otp:{email.strip().lower()}"


class ParticipantViewSet(viewsets.ModelViewSet):
    queryset = Participant.objects.select_related('organization', 'user').all().order_by('user__username')
    serializer_class = ParticipantSerializer

    @action(detail=False, methods=['post'])
    def send_otp(self, request):
        email = (request.data.get('email') or '').strip()
        full_name = request.data.get('full_name') or ''
        if not email:
            return Response({'error': "L'email est requis."}, status=status.HTTP_400_BAD_REQUEST)

        from django.contrib.auth.models import User
        if User.objects.filter(email__iexact=email).exists():
            return Response({'error': 'Cet e-mail est déjà utilisé ou invalide.'}, status=status.HTTP_400_BAD_REQUEST)

        import secrets
        from django.core.cache import cache
        code = ''.join(secrets.choice('0123456789') for _ in range(6))
        cache.set(_otp_key(email), {'code': code, 'attempts': 0}, OTP_TTL_SECONDS)

        try:
            from django.core.mail import EmailMultiAlternatives
            from django.template.loader import render_to_string
            from django.conf import settings

            html_content = render_to_string('emails/otp.html', {
                'full_name': full_name,
                'code': code,
                'minutes': OTP_TTL_SECONDS // 60,
            })
            msg = EmailMultiAlternatives(
                "Votre code de vérification EventTwin",
                f"Votre code de vérification : {code}",
                settings.EMAIL_HOST_USER,
                [email],
            )
            msg.attach_alternative(html_content, "text/html")
            msg.send()
        except Exception as e:
            print(f"!!! ERREUR D'ENVOI EMAIL OTP : {e} !!!")
            cache.delete(_otp_key(email))
            return Response({'error': "Échec de l'envoi du code par e-mail."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({'message': 'Un code de vérification a été envoyé.'})

    @action(detail=False, methods=['post'])
    def verify_otp(self, request):
        email = (request.data.get('email') or '').strip()
        code = str(request.data.get('otp') or '').strip()
        ok, error = self._check_otp(email, code, consume=False)
        if not ok:
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'message': 'Code valide.'})

    @staticmethod
    def _check_otp(email, code, consume):
        from django.core.cache import cache
        if not email or not code:
            return False, 'Le code de vérification est requis.'
        key = _otp_key(email)
        data = cache.get(key)
        if not data:
            return False, 'Code expiré ou inexistant. Demandez un nouveau code.'
        if data['attempts'] >= OTP_MAX_ATTEMPTS:
            cache.delete(key)
            return False, 'Trop de tentatives. Demandez un nouveau code.'
        if data['code'] != code:
            data['attempts'] += 1
            cache.set(key, data, OTP_TTL_SECONDS)
            return False, 'Code incorrect.'
        if consume:
            cache.delete(key)
        return True, None

    @action(detail=False, methods=['post'])
    def login(self, request):
        identifier = (request.data.get('email') or '').strip()
        password = request.data.get('password')
        if not identifier or not password:
            return Response({'error': 'L\'e-mail et le mot de passe sont requis.'}, status=status.HTTP_400_BAD_REQUEST)
        
        from django.contrib.auth.models import User
        from django.db.models import Q
        
        # Récupérer tous les comptes correspondants (e-mail ou nom d'utilisateur)
        candidates = list(User.objects.filter(Q(email__iexact=identifier) | Q(username__iexact=identifier)))

        if not candidates:
            return Response({'error': "Aucun compte n'existe avec cet e-mail ou nom d'utilisateur."}, status=status.HTTP_400_BAD_REQUEST)

        user = None
        for u in candidates:
            # Vérifier soit le hash Django, soit le texte brut si le mot de passe a été modifié directement en base
            if u.check_password(password) or u.password == password:
                user = u
                if u.password == password:
                    # Mettre à jour avec le hashage standard Django sécurisé
                    u.set_password(password)
                    u.save()
                break

        if not user:
            print(f"[LOGIN FAILED] Identifiant: '{identifier}', Utilisateurs trouvés en base: {[c.username for c in candidates]}")
            return Response({'error': 'Mot de passe incorrect.'}, status=status.HTTP_401_UNAUTHORIZED)

        profile = getattr(user, 'profile', None)
        if not profile:
            from apps.organizations.models import Organization
            org = Organization.objects.first()
            is_organizer_or_staff = user.is_superuser or user.is_staff
            default_role = 'admin' if user.is_superuser else ('organizer' if user.is_staff else 'participant')
            profile = Participant.objects.create(
                user=user,
                organization=org,
                role=default_role,
                status='active'
            )

        full_name = f"{user.first_name} {user.last_name}".strip() if (user.first_name or user.last_name) else user.username
        
        # Déterminer le rôle
        role = getattr(profile, 'role', 'participant')
        if user.is_superuser:
            role = 'admin'
        elif user.is_staff:
            role = 'organizer' if role == 'participant' else role

        print(f"[LOGIN SUCCESS] Utilisateur: '{user.username}' (id={user.id}), email='{user.email}', rôle='{role}'")

        return Response({
            'message': 'Login successful',
            'participant': {
                'id': str(profile.id),
                'email': user.email,
                'full_name': full_name,
                'role': role
            }
        })


    @action(detail=False, methods=['post'])
    def register(self, request):
        email = request.data.get('email')
        full_name = request.data.get('full_name')
        password = request.data.get('password')
        otp = str(request.data.get('otp') or '').strip()
        
        if not email or not full_name or not password:
            return Response({'error': 'Email, full_name, and password are required'}, status=status.HTTP_400_BAD_REQUEST)
            
        from django.contrib.auth.models import User
        if User.objects.filter(email=email).exists():
            return Response({'error': 'Cet e-mail est déjà utilisé ou invalide.'}, status=status.HTTP_400_BAD_REQUEST)

        ok, error = self._check_otp(email, otp, consume=True)
        if not ok:
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)
            
        org = Organization.objects.first()
        if not org:
            org = Organization.objects.create(name="Default Organization", legal_name="Default Org")
            
        parts = full_name.strip().split(' ', 1)
        first_name = parts[0]
        last_name = parts[1] if len(parts) > 1 else ''
        base_username = f"{first_name.lower()}.{last_name.lower()}" if last_name else first_name.lower()
        username = base_username
        counter = 1
        while User.objects.filter(username=username).exists():
            username = f"{base_username}{counter}"
            counter += 1
            
        user = User.objects.create_user(
            username=username, 
            email=email, 
            password=password,
            first_name=first_name,
            last_name=last_name
        )
        
        participant, _ = Participant.objects.get_or_create(
            user=user,
            defaults={
                'organization': org,
                'role': 'participant',
                'status': 'active'
            }
        )
        participant.role = 'participant'
        if not participant.organization and org:
            participant.organization = org
        participant.save()
        
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
        participant, _ = Participant.objects.get_or_create(
            user=user,
            defaults={
                'organization': org,
                'role': 'organizer',
                'status': 'active'
            }
        )
        participant.role = 'organizer'
        if not participant.organization and org:
            participant.organization = org
        participant.save()
        
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

    @action(detail=True, methods=['patch', 'put'])
    def update_profile(self, request, pk=None):
        participant = self.get_object()
        first_name = request.data.get('first_name')
        last_name = request.data.get('last_name')
        full_name = request.data.get('full_name')
        email = request.data.get('email')
        organization_val = request.data.get('organization')

        if participant.user:
            if first_name is not None:
                participant.user.first_name = first_name.strip()
            if last_name is not None:
                participant.user.last_name = last_name.strip()
            if full_name and (first_name is None and last_name is None):
                parts = full_name.strip().split(' ', 1)
                participant.user.first_name = parts[0]
                participant.user.last_name = parts[1] if len(parts) > 1 else ''

            # Génération automatique propre du username à partir du nom et prénom
            fn = participant.user.first_name.strip()
            ln = participant.user.last_name.strip()
            if fn and ln:
                participant.user.username = f"{fn.lower()}.{ln.lower()}"
            elif fn:
                participant.user.username = fn.lower()
            elif ln:
                participant.user.username = ln.lower()

            if email:
                participant.user.email = email.strip()
            participant.user.save()

        phone = request.data.get('phone')
        if phone is not None:
            participant.phone = phone.strip()

        photo = request.data.get('photo')
        if photo is not None:
            participant.photo = photo

        if organization_val is not None:
            from apps.organizations.models import Organization
            org_str = str(organization_val).strip()
            if org_str and org_str.lower() not in ['aucune', 'none', '']:
                org = Organization.objects.filter(name__iexact=org_str).first()
                if not org:
                    try:
                        org = Organization.objects.filter(id=org_str).first()
                    except Exception:
                        pass
                if not org:
                    org = Organization.objects.create(name=org_str)
                participant.organization = org
            else:
                participant.organization = None

        participant.save()
        return Response(ParticipantSerializer(participant).data)

    @action(detail=False, methods=['post'])
    def reset_password(self, request):
        email = (request.data.get('email') or '').strip()
        if not email:
            return Response({'error': "L'e-mail est requis."}, status=status.HTTP_400_BAD_REQUEST)
            
        from django.contrib.auth.models import User
        user = User.objects.filter(email__iexact=email).first()
        
        if not user:
            return Response({'error': 'Aucun compte associé à cet e-mail.'}, status=status.HTTP_404_NOT_FOUND)
            
        import secrets
        from urllib.parse import quote
        from django.core.cache import cache
        
        token = secrets.token_urlsafe(32)
        cache.set(f"reset_token:{email.lower()}", token, 3600)
        reset_link = f"http://localhost:4200/reset-password?email={quote(email)}&token={token}"
        
        try:
            from django.core.mail import EmailMultiAlternatives
            from django.template.loader import render_to_string
            from django.conf import settings
            
            full_name = f"{user.first_name} {user.last_name}".strip() or user.username
            html_content = render_to_string('emails/reset_password.html', {
                'full_name': full_name,
                'email': email,
                'reset_link': reset_link
            })
            
            sujet = "Réinitialisation de votre mot de passe EventTwin"
            msg = EmailMultiAlternatives(
                sujet, 
                f"Bonjour {full_name},\n\nPour réinitialiser votre mot de passe, cliquez sur ce lien : {reset_link}\n\nCe lien est valable 1 heure.", 
                settings.EMAIL_HOST_USER, 
                [email]
            )
            msg.attach_alternative(html_content, "text/html")
            msg.send()
        except Exception as e:
            print(f"!!! ERREUR D'ENVOI EMAIL RESET PASSWORD : {e} !!!")
            return Response({'error': "Échec de l'envoi de l'e-mail de réinitialisation."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
        return Response({'message': 'Un e-mail contenant votre lien de réinitialisation vous a été envoyé.'})

    @action(detail=False, methods=['post'])
    def confirm_reset_password(self, request):
        email = (request.data.get('email') or '').strip()
        token = (request.data.get('token') or '').strip()
        new_password = request.data.get('new_password')
        
        if not email or not token or not new_password:
            return Response({'error': 'Tous les champs sont requis.'}, status=status.HTTP_400_BAD_REQUEST)
            
        if len(new_password) < 6:
            return Response({'error': 'Le mot de passe doit contenir au moins 6 caractères.'}, status=status.HTTP_400_BAD_REQUEST)
            
        from django.core.cache import cache
        cached_token = cache.get(f"reset_token:{email.lower()}")
        
        if not cached_token or cached_token != token:
            return Response({'error': 'Le lien de réinitialisation est invalide ou a expiré. Veuillez refaire une demande.'}, status=status.HTTP_400_BAD_REQUEST)
            
        from django.contrib.auth.models import User
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            return Response({'error': 'Utilisateur introuvable.'}, status=status.HTTP_404_NOT_FOUND)
            
        user.set_password(new_password)
        user.save()
        cache.delete(f"reset_token:{email.lower()}")
        
        return Response({'message': 'Votre mot de passe a été modifié avec succès. Vous pouvez maintenant vous connecter.'})

    @action(detail=False, methods=['get'])
    def get_organizers(self, request):
        organizers = Participant.objects.filter(role='organizer').order_by('-created_at')
        return Response(ParticipantSerializer(organizers, many=True).data)


class EventParticipantViewSet(viewsets.ModelViewSet):
    queryset = EventParticipant.objects.select_related('event', 'participant').all().order_by('-created_at')
    serializer_class = EventParticipantSerializer


class ParticipantPreferenceViewSet(viewsets.ModelViewSet):
    queryset = ParticipantPreference.objects.select_related('participant').all().order_by('preference_type')
    serializer_class = ParticipantPreferenceSerializer


class ParticipantConstraintViewSet(viewsets.ModelViewSet):
    queryset = ParticipantConstraint.objects.select_related('participant').all().order_by('constraint_type')
    serializer_class = ParticipantConstraintSerializer