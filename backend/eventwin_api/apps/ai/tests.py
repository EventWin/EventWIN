from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.budgets.ollama_client import InvalidAiResponse
from apps.events.models import Event
from apps.organizations.models import Organization
from apps.participants.models import Participant, ParticipantConstraint

from . import fit
from .models import ParticipantFitAnalysis


def dims(**scores):
    return {key: {'score': scores.get(key), 'note': f'note {key}'} for key in fit.DIMENSION_KEYS}


def fake_model(prompt, system, timeout=None):
    """Réponse type : E1 idéal, E2 bloquant sur l'accessibilité."""
    return {
        'events': [
            {'event_ref': 'E1', 'dimensions': dims(accessibility=100, interests=90),
             'blockers': [], 'strengths': ['Salles PMR (E1)'], 'summary': 'Idéal.'},
            {'event_ref': 'E2', 'dimensions': dims(accessibility=10, interests=90),
             'blockers': [{'constraint': 'Fauteuil', 'reason': 'Refuges inaccessibles'}],
             'summary': 'Inadapté.'},
        ],
        'comparison': 'Le premier (E1) convient, pas le second (E2).',
    }


class ScoringTests(TestCase):
    def test_score_is_weighted_average_of_known_dimensions_only(self):
        result = fit.score_event({'dimensions': dims(accessibility=100, budget=40)})
        # (2.0*100 + 1.0*40) / 3.0 = 80 ; les dimensions null sont ignorées.
        self.assertEqual(result['score'], 80)
        self.assertEqual(result['verdict']['key'], 'excellent')

    def test_strict_blocker_caps_the_score(self):
        result = fit.score_event({
            'dimensions': dims(interests=95, ambiance=90),
            'blockers': [{'constraint': 'Halal', 'reason': 'Menu non adapté'}],
        })
        self.assertEqual(result['base_score'], 93)
        self.assertEqual(result['score'], fit.BLOCKER_CAP)
        self.assertTrue(result['capped'])

    def test_out_of_range_and_garbage_scores_are_sanitized(self):
        result = fit.score_event({'dimensions': {'accessibility': {'score': 250}, 'diet': {'score': 'n/a'}}})
        self.assertEqual(result['dimensions']['accessibility']['score'], 100)
        self.assertIsNone(result['dimensions']['diet']['score'])

    def test_no_known_dimension_means_not_evaluated(self):
        result = fit.score_event({'dimensions': {}})
        self.assertIsNone(result['score'])
        self.assertEqual(result['verdict']['key'], 'unknown')

    def test_missing_event_in_answer_is_rejected(self):
        events = [{'id': 'a', 'name': 'A'}, {'id': 'b', 'name': 'B'}]
        with self.assertRaises(InvalidAiResponse):
            fit.parse_response({'events': [{'event_ref': 'E1', 'dimensions': dims(diet=50)}]}, events)

    def test_differentiators_and_reference_cleanup(self):
        events = [{'id': 'a', 'name': 'A'}, {'id': 'b', 'name': 'B'}]
        parsed = fit.parse_response(fake_model('', ''), events)
        self.assertEqual(parsed['best_event_id'], 'a')
        self.assertEqual(parsed['differentiators'][0]['dimension'], 'accessibility')
        self.assertEqual(parsed['differentiators'][0]['spread'], 90)
        self.assertNotIn('E1', parsed['comparison'])
        self.assertEqual(parsed['results']['a']['strengths'], ['Salles PMR'])


class ParticipantFitApiTests(TestCase):
    def setUp(self):
        self.org = Organization.objects.create(name='Org')
        self.other_org = Organization.objects.create(name='Autre')
        self.organizer = self._user('orga@x.fr', 'organizer', self.org)
        self.camille = self._user('camille@x.fr', 'participant', self.org)
        self.outsider = self._user('out@x.fr', 'participant', self.other_org)
        ParticipantConstraint.objects.create(
            participant=self.camille.profile, constraint_type='Accessibilité',
            value='Fauteuil roulant', is_hard_constraint=True,
        )
        self.e1 = Event.objects.create(organization=self.org, owner=self.organizer, name='Sommet', status='published')
        self.e2 = Event.objects.create(organization=self.org, owner=self.organizer, name='Road trip', status='published')
        self.client = APIClient()

    def _user(self, email, role, org):
        user = User.objects.create_user(username=email, email=email, password='x')
        Participant.objects.create(user=user, organization=org, role=role)
        return user

    def _post(self, user, **body):
        self.client.force_authenticate(user)
        body.setdefault('event_ids', [str(self.e1.pk), str(self.e2.pk)])
        return self.client.post('/api/ai/participant-fit/', body, format='json')

    @patch('apps.ai.fit.generate_json', side_effect=fake_model)
    def test_organizer_gets_matrix_and_second_call_is_cached(self, model):
        response = self._post(self.organizer, participant_ids=[str(self.camille.profile.pk)])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = response.data['participants'][0]
        # Les événements sont envoyés triés par id : on retrouve le bon via le nom.
        scores = {e['name']: row['results'][e['id']]['score'] for e in response.data['events']}
        self.assertEqual(sorted(scores.values())[0], fit.BLOCKER_CAP)
        self.assertFalse(row['cached'])

        again = self._post(self.organizer, participant_ids=[str(self.camille.profile.pk)])
        self.assertTrue(again.data['participants'][0]['cached'])
        self.assertEqual(model.call_count, 1)
        self.assertEqual(ParticipantFitAnalysis.objects.count(), 1)

    @patch('apps.ai.fit.generate_json', side_effect=fake_model)
    def test_profile_change_invalidates_cache(self, model):
        self._post(self.organizer, participant_ids=[str(self.camille.profile.pk)])
        ParticipantConstraint.objects.create(
            participant=self.camille.profile, constraint_type='Alimentaire', value='Vegan',
        )
        response = self._post(self.organizer, participant_ids=[str(self.camille.profile.pk)])
        self.assertFalse(response.data['participants'][0]['cached'])
        self.assertEqual(model.call_count, 2)

    @patch('apps.ai.fit.generate_json', side_effect=fake_model)
    def test_participant_cannot_analyze_someone_else(self, model):
        response = self._post(self.camille, participant_ids=[str(self.outsider.profile.pk)])
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        model.assert_not_called()

    @patch('apps.ai.fit.generate_json', side_effect=fake_model)
    def test_participant_defaults_to_own_profile(self, model):
        response = self._post(self.camille)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([p['id'] for p in response.data['participants']], [str(self.camille.profile.pk)])

    def test_event_list_is_required_and_bounded(self):
        self.assertEqual(self._post(self.organizer, event_ids=[]).status_code, status.HTTP_400_BAD_REQUEST)

    def test_options_list_only_scoped_participants(self):
        self.client.force_authenticate(self.organizer)
        response = self.client.get('/api/ai/participant-fit/options/')
        names = [p['email'] for p in response.data['participants']]
        self.assertIn('camille@x.fr', names)
        self.assertNotIn('out@x.fr', names)


class EventFitEndpointTests(ParticipantFitApiTests):
    """Endpoint du jumeau : lecture du cache, analyse des seuls manquants."""

    def setUp(self):
        super().setUp()
        from apps.participants.models import EventParticipant
        EventParticipant.objects.create(event=self.e1, participant=self.camille.profile)
        self.url = f'/api/ai/participant-fit/event/{self.e1.pk}/'

    @staticmethod
    def single_event_model(prompt, system, timeout=None):
        return {'events': [{'event_ref': 'E1', 'dimensions': dims(accessibility=95, interests=85),
                            'blockers': [], 'summary': 'Adapté.'}], 'comparison': ''}

    @patch('apps.ai.fit.generate_json')
    def test_get_reads_cache_without_calling_ai(self, model):
        self.client.force_authenticate(self.organizer)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['results'], {})
        self.assertEqual(response.data['missing'], [str(self.camille.profile.pk)])
        model.assert_not_called()

    def test_matrix_result_is_reused_by_the_twin(self):
        with patch('apps.ai.fit.generate_json', side_effect=fake_model):
            self._post(self.organizer, participant_ids=[str(self.camille.profile.pk)])
        self.client.force_authenticate(self.organizer)
        data = self.client.get(self.url).data
        self.assertIn(str(self.camille.profile.pk), data['results'])
        self.assertEqual(data['missing'], [])

    def test_post_analyzes_only_missing_attendees(self):
        self.client.force_authenticate(self.organizer)
        with patch('apps.ai.fit.generate_json', side_effect=self.single_event_model) as model:
            first = self.client.post(self.url, {}, format='json')
            second = self.client.post(self.url, {}, format='json')
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(first.data['results'][str(self.camille.profile.pk)]['score'], 90)
        self.assertEqual(second.data['missing'], [])
        self.assertEqual(model.call_count, 1)



class GeminiFallbackTests(TestCase):
    """Le client bascule de modèle quand le quota est atteint."""

    def setUp(self):
        from apps.budgets import ollama_client
        self.client_mod = ollama_client
        ollama_client._MODEL_COOLDOWN.clear()

    def _error(self, status_code):
        error = self.client_mod.OllamaError(f'HTTP {status_code}')
        error.status_code = status_code
        return error

    def test_quota_error_falls_back_to_next_model(self):
        calls = []

        def fake(model, prompt, system, timeout):
            calls.append(model)
            if len(calls) == 1:
                raise self._error(429)
            return {'ok': model}

        with patch.object(self.client_mod, 'model_chain', return_value=['a', 'b', 'c']),                 patch.object(self.client_mod, '_generate_with_model', side_effect=fake):
            self.assertEqual(self.client_mod.generate_json('p', 's'), {'ok': 'b'})
            # Le modèle à court de quota est mis de côté pour l'appel suivant.
            self.assertEqual(self.client_mod.generate_json('p', 's'), {'ok': 'b'})
        self.assertEqual(calls, ['a', 'b', 'b'])

    def test_non_retryable_error_is_raised_immediately(self):
        with patch.object(self.client_mod, 'model_chain', return_value=['a', 'b']),                 patch.object(self.client_mod, '_generate_with_model', side_effect=self._error(401)) as call:
            with self.assertRaises(self.client_mod.OllamaError):
                self.client_mod.generate_json('p', 's')
        self.assertEqual(call.call_count, 1)

    def test_all_models_exhausted_raises_last_error(self):
        with patch.object(self.client_mod, 'model_chain', return_value=['a', 'b']),                 patch.object(self.client_mod, '_generate_with_model', side_effect=self._error(429)):
            with self.assertRaises(self.client_mod.OllamaError):
                self.client_mod.generate_json('p', 's')
