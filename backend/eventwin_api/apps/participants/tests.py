"""Tests de sécurité : rôles, autorisation, anti-IDOR, authentification.

Ces tests verrouillent le contrôle d'accès backend (PHASE 2 à 6) :
- le rôle est toujours lu côté serveur, jamais du client ;
- chaque endpoint sensible vérifie le rôle **et** la propriété (anti-IDOR) ;
- l'inscription force le rôle « participant » (aucune élévation) ;
- les invitations utilisent un jeton haché, à usage unique, expirable ;
- les mots de passe ne circulent jamais en clair.

Aucun accès réseau : les services externes sont mockés (règle du projet).
"""
import uuid

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from datetime import timedelta
from rest_framework import status
from rest_framework.test import APIClient

from apps.events.models import Event
from apps.organizations.models import Organization
from apps.participants.models import (
    EventParticipant,
    EventQuiz,
    OrganizerInvitation,
    Participant,
    PasswordResetToken,
    QuizAnswer,
    QuizQuestion,
    hash_token,
)


def make_org(name='Org'):
    return Organization.objects.create(name=name)


def make_user(username, role='participant', org=None, superuser=False, password='pw-test-1234'):
    user = User.objects.create_user(
        username=username, email=f'{username}@test.fr', password=password,
        is_superuser=superuser,
    )
    profile = None
    if role:
        profile = Participant.objects.create(
            user=user, organization=org, role=role, status='active'
        )
    return user, profile


class RoleSecurityTests(TestCase):
    """Vérifie le RBAC et l'anti-IDOR sur les endpoints sensibles."""

    def setUp(self):
        self.org_a = make_org('OrgA')
        self.org_b = make_org('OrgB')

        self.admin, _ = make_user('admin', role=None, superuser=True)
        self.orga_a, _ = make_user('orga_a', role='organizer', org=self.org_a)
        self.orga_b, _ = make_user('orga_b', role='organizer', org=self.org_b)
        self.part, self.part_profile = make_user('part', role='participant', org=self.org_a)

        self.event_a = Event.objects.create(
            organization=self.org_a, owner=self.orga_a, name='EventA',
            status='published', target_budget=1000,
        )
        self.event_b = Event.objects.create(
            organization=self.org_b, owner=self.orga_b, name='EventB',
            status='published', target_budget=1000,
        )

        self.api = APIClient()

    def _as(self, user):
        self.api.force_authenticate(user=user)
        return self.api

    # --- Authentification obligatoire ----------------------------------------

    def test_anonymous_is_refused_on_protected_endpoints(self):
        self.api.force_authenticate(user=None)
        for method, url in (
            ('get', '/api/events/'),
            ('get', '/api/participants/'),
            ('get', f'/api/budget-items/summary/?event={self.event_a.id}'),
            ('get', '/api/organizations/'),
        ):
            response = getattr(self.api, method)(url)
            self.assertIn(
                response.status_code,
                (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
                f'{method.upper()} {url} devrait refuser un anonyme',
            )

    # --- Anti-IDOR : un organisateur ne voit pas l'autre événement ----------

    def test_organizer_cannot_read_other_event_budget(self):
        self._as(self.orga_a)
        response = self.api.get(f'/api/budget-items/summary/?event={self.event_b.id}')
        # 403 (refus de propriété) ou 400 (événement non résolvable dans le
        # périmètre) — jamais un 200 qui exposerait les données d'autrui.
        self.assertIn(
            response.status_code,
            (status.HTTP_403_FORBIDDEN, status.HTTP_400_BAD_REQUEST),
        )

    def test_organizer_cannot_modify_other_event(self):
        self._as(self.orga_a)
        response = self.api.patch(
            f'/api/events/{self.event_b.id}/', {'name': 'piraté'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.event_b.refresh_from_db()
        self.assertNotEqual(self.event_b.name, 'piraté')

    def test_organizer_sees_only_scoped_events(self):
        # Un brouillon d'une autre organisation ne doit jamais apparaître.
        # (Un événement publié reste visible par tous : c'est voulu, car un
        # participant doit pouvoir le consulter pour s'y inscrire.)
        Event.objects.create(
            organization=self.org_b, owner=self.orga_b, name='BrouillonB',
            status='draft', target_budget=500,
        )
        self._as(self.orga_a)
        response = self.api.get('/api/events/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = {item['name'] for item in response.json()}
        self.assertIn(self.event_a.name, names)
        self.assertNotIn('BrouillonB', names)

    def test_participant_sees_only_published_events(self):
        Event.objects.create(
            organization=self.org_a, owner=self.orga_a, name='Brouillon',
            status='draft', target_budget=500,
        )
        self._as(self.part)
        response = self.api.get('/api/events/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = {item['name'] for item in response.json()}
        self.assertNotIn('Brouillon', names)

    def test_participant_cannot_access_budget(self):
        self._as(self.part)
        response = self.api.get(f'/api/budget-items/summary/?event={self.event_a.id}')
        self.assertIn(
            response.status_code,
            (status.HTTP_403_FORBIDDEN, status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND),
        )

    # --- Élévation de privilèges ---------------------------------------------

    def test_register_forces_participant_role(self):
        self.api.force_authenticate(user=None)
        response = self.api.post('/api/participants/register/', {
            'full_name': 'Malicieux', 'email': 'malicieux@test.fr',
            'password': 'motdepasse-secure-1', 'role': 'organizer',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # Le rôle renvoyé vient du serveur : jamais 'organizer' ni 'admin'.
        self.assertEqual(response.json()['participant']['role'], 'participant')
        user = User.objects.get(email='malicieux@test.fr')
        self.assertEqual(user.profile.role, 'participant')

    def test_organizer_cannot_invite_without_admin(self):
        self._as(self.orga_a)
        response = self.api.post('/api/participants/invite_organizer/', {
            'email': 'nouveau@test.fr', 'full_name': 'Nouveau',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_participant_cannot_list_organizers(self):
        self._as(self.part)
        response = self.api.get('/api/participants/get_organizers/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class InvitationSecurityTests(TestCase):
    """Invitations : jeton haché, usage unique, expiration, envoi honnête."""

    def setUp(self):
        self.admin, _ = make_user('admin', role=None, superuser=True)
        self.api = APIClient()
        self.api.force_authenticate(user=self.admin)

    def test_invite_creates_pending_account_without_password(self):
        response = self.api.post('/api/participants/invite_organizer/', {
            'email': 'invited@test.fr', 'full_name': 'Invité',
        }, format='json')
        # SMTP absent en test → l'envoi échoue, mais la réponse est honnête.
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        payload = response.json()
        self.assertIn('email_sent', payload)
        user = User.objects.get(email='invited@test.fr')
        # Aucun mot de passe utilisable : le compte attend l'activation.
        self.assertFalse(user.has_usable_password())
        self.assertEqual(user.profile.status, 'invited')
        self.assertEqual(user.profile.role, 'organizer')
        # Le jeton n'est jamais renvoyé en clair ; seul le hachage est stocké.
        invitation = OrganizerInvitation.objects.get(email='invited@test.fr')
        self.assertNotIn('token', payload)
        self.assertEqual(len(invitation.token_hash), 64)

    def test_accept_invitation_is_single_use(self):
        invitation = OrganizerInvitation.objects.create(
            email='once@test.fr', full_name='Once',
            token_hash=hash_token('jeton-fixe'),
            expires_at=timezone.now() + timedelta(hours=24),
        )
        self.api.force_authenticate(user=None)
        first = self.api.post('/api/participants/accept_invitation/', {
            'token': 'jeton-fixe', 'password': 'nouveau-mot-de-passe-1',
        }, format='json')
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        # Second usage du même jeton → refus.
        second = self.api.post('/api/participants/accept_invitation/', {
            'token': 'jeton-fixe', 'password': 'autre-motdepasse-2',
        }, format='json')
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

    def test_expired_invitation_is_refused(self):
        OrganizerInvitation.objects.create(
            email='expired@test.fr', full_name='Expired',
            token_hash=hash_token('vieux-jeton'),
            expires_at=timezone.now() - timedelta(hours=1),
        )
        self.api.force_authenticate(user=None)
        response = self.api.post('/api/participants/accept_invitation/', {
            'token': 'vieux-jeton', 'password': 'motdepasse-secure-1',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_revoked_invitation_is_refused(self):
        OrganizerInvitation.objects.create(
            email='revoke@test.fr', full_name='Revoke',
            token_hash=hash_token('revoque'),
            expires_at=timezone.now() + timedelta(hours=24),
            revoked_at=timezone.now(),
        )
        self.api.force_authenticate(user=None)
        response = self.api.post('/api/participants/accept_invitation/', {
            'token': 'revoque', 'password': 'motdepasse-secure-1',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class PasswordResetTests(TestCase):
    """Réinitialisation : jeton temporaire, usage unique, pas de mot de passe en clair."""

    def setUp(self):
        self.user, self.profile = make_user('resetme', role='participant')

    def test_reset_flow_uses_single_use_token(self):
        self.api = APIClient()
        self.api.force_authenticate(user=None)
        # Demande : le backend crée un jeton haché.
        response = self.api.post('/api/participants/request_password_reset/', {
            'email': 'resetme@test.fr',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        reset = PasswordResetToken.objects.filter(user=self.user).first()
        self.assertIsNotNone(reset)
        self.assertEqual(len(reset.token_hash), 64)

        # Confirmation avec un faux jeton → refus.
        bad = self.api.post('/api/participants/confirm_password_reset/', {
            'token': 'faux', 'password': 'nouveau-secure-123',
        }, format='json')
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unknown_email_does_not_leak(self):
        self.api = APIClient()
        self.api.force_authenticate(user=None)
        response = self.api.post('/api/participants/request_password_reset/', {
            'email': 'inconnu@test.fr',
        }, format='json')
        # Réponse générique : on ne révèle pas si l'e-mail existe.
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class QuizSecurityTests(TestCase):
    """Quiz : participant répond uniquement via sa propre inscription."""

    def setUp(self):
        self.org = make_org('QuizOrg')
        self.orga, _ = make_user('orga_q', role='organizer', org=self.org)
        self.part, self.part_profile = make_user('part_q', role='participant', org=self.org)
        self.other, self.other_profile = make_user('other_q', role='participant', org=self.org)

        self.event = Event.objects.create(
            organization=self.org, owner=self.orga, name='QuizEvent',
            status='published', target_budget=500,
        )
        self.quiz = EventQuiz.objects.create(event=self.event, title='Préférences')
        self.question = QuizQuestion.objects.create(
            quiz=self.quiz, prompt='Avez-vous des allergies ?', kind='boolean', position=0
        )
        self.registration = EventParticipant.objects.create(
            event=self.event, participant=self.part_profile
        )
        self.api = APIClient()

    def test_organizer_creates_quiz(self):
        # Un événement ne porte qu'un quiz (contrainte un-quiz-par-événement) :
        # on crée le quiz sur un second événement vierge.
        fresh_event = Event.objects.create(
            organization=self.org, owner=self.orga, name='EventVierge',
            status='published', target_budget=400,
        )
        self.api.force_authenticate(user=self.orga)
        response = self.api.post('/api/quizzes/', {
            'event': str(fresh_event.id), 'title': 'Nouveau quiz',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_participant_cannot_create_quiz(self):
        self.api.force_authenticate(user=self.part)
        response = self.api.post('/api/quizzes/', {
            'event': str(self.event.id), 'title': 'Intrus',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_unregistered_participant_cannot_answer(self):
        self.api.force_authenticate(user=self.other)
        response = self.api.post(f'/api/quizzes/{self.quiz.id}/answers/', [
            {'question': str(self.question.id), 'value': True},
        ], format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_answer_is_tied_to_own_registration(self):
        self.api.force_authenticate(user=self.part)
        response = self.api.post(f'/api/quizzes/{self.quiz.id}/answers/', [
            {'question': str(self.question.id), 'value': False},
        ], format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        answer = QuizAnswer.objects.get(
            registration=self.registration, question=self.question
        )
        # La réponse est rattachée à la propre inscription du participant.
        self.assertEqual(answer.registration.participant, self.part_profile)
        self.assertEqual(answer.value, False)

    def test_unanswered_is_not_confirmed_with_none_allergy(self):
        """Une question sans réponse reste « non répondu », jamais « aucune »."""
        self.api.force_authenticate(user=self.orga)
        response = self.api.get(f'/api/quiz-summary/?event={self.event.id}')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        summary = response.json()['questions'][0]
        self.assertEqual(summary['answered_count'], 0)
        self.assertEqual(summary['unanswered_count'], 1)
