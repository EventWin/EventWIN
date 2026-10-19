"""Tests du module Budget & Ressources.

Aucun test n'accède au réseau ni à Ollama : ``generate_json`` (client LLM) et
``search_offers`` (recherche web) sont systématiquement mockés. Les données
d'exemple vivent uniquement ici, jamais dans le code de production.

Organisation :

- ``ValidationLocaleTests``  : rejet **structurel** uniquement (aucune règle
  sémantique locale, aucun mot-clé métier codé en dur) ;
- ``NumUtilsTests``          : validation stricte des nombres du LLM ;
- ``EstimationsTests``       : validation d'un lot de réponses IA ;
- ``AiAnalysisTests``        : scénarios, recommandations, états budgétaires ;
- ``WebsearchTests``         : quota par analyse, cache, nettoyage d'URL ;
- ``CalculsTests``           : totaux et statuts déterministes ;
- ``ApiTests`` (DB)          : contrats HTTP, isolation, verrou, code de retour.
"""

import re
import threading
import uuid as uuid_lib
from contextlib import contextmanager
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from django.conf import settings
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from rest_framework import status
from rest_framework.test import APIClient

from apps.events.models import Event
from apps.organizations.models import Organization
from apps.participants.models import Participant

from . import ai_analysis, estimations, ollama_client, views, websearch
from .calculations import (
    analysis_mode,
    analysis_status_of,
    calculate_budget,
    calculate_optimization,
    money_text,
)
from .models import BudgetItem
from .numutils import clean_choice_index, decimal_or_none, parse_range, positive_decimal_or_none
from .textutils import is_single_repeated_letter, letters_only, normalize_text
from .validation import (
    INVALID_NAME_MESSAGE,
    ambiguity_reason,
    local_signals,
    validate_resource_input,
    validate_resource_name,
)


# ---------------------------------------------------------------------------
# Utilitaires partagés
# ---------------------------------------------------------------------------

EXPENSE_ID_RE = re.compile(r'"expense_id":\s*"([^"]+)"')

OFFER_PAGE = {
    'url': 'https://shop.example/products/chaises-pliables',
    'title': 'Chaises pliables 10 places',
    'domain': 'shop.example',
    'price': None,
    'currency': 'EUR',
    'snippet': 'Location de chaises pour événements',
}

BUDGET_RESPONSE = {
    'summary': 'Budget maîtrisé, aucune action urgente.',
    'main_recommendation': {'title': 'Point de vigilance', 'reason': 'Surveiller les coûts.'},
    'scenarios': [],
    'recommendations': [],
}


def priced_results(prompt, *args, price='10', **extra):
    """Réponse de lot : chaque ressource du prompt est comprise et chiffrée.

    ``*args`` absorbe le prompt système que ``generate_json`` transmet en
    deuxième positionnel.
    """
    results = []
    for expense_id in EXPENSE_ID_RE.findall(prompt):
        entry = {
            'expense_id': expense_id,
            'understood': True,
            'ambiguity_reason': '',
            'unpriced_reason': '',
            'unit_price_estimate': price,
            'price_range_min': None,
            'price_range_max': None,
            'chosen_index': None,
            'match_note': '',
        }
        entry.update(extra)
        results.append(entry)
    return {'results': results}


def offer_outcome(query, session=None):
    return websearch.SearchOutcome(results=[dict(OFFER_PAGE)])


@contextmanager
def analysis_mocks(priced=priced_results, budget=None, search=offer_outcome, validate=None):
    """Enchaîne les mocks du pipeline complet (recherche + LLM + page produit).

    ``validate`` est la dict renvoyée par la vérification de page produit, ou
    ``None`` pour « page inaccessible » — jamais un effet de bord implicite.
    """
    with patch('apps.budgets.websearch.search_offers', side_effect=search) as search_mock, \
            patch('apps.budgets.websearch.validate_direct_offer',
                  return_value=validate) as validate_mock, \
            patch('apps.budgets.estimations.generate_json', side_effect=priced) as estimations_mock, \
            patch('apps.budgets.ai_analysis.generate_json',
                  return_value=budget if budget is not None else BUDGET_RESPONSE) as budget_mock:
        yield SimpleNamespace(
            search=search_mock, validate=validate_mock,
            estimations=estimations_mock, budget=budget_mock,
        )


def ai_settings(**overrides):
    """Surcharge de la config IA en gardant la structure complète."""
    config = dict(settings.BUDGET_AI)
    config.update(overrides)
    return {'BUDGET_AI': config}


# ===========================================================================
# A. Validation d'entrée : structurel uniquement
# ===========================================================================

class ValidationLocaleTests(SimpleTestCase):
    """Le module local ne rejette que l'ininterprétable par nature."""

    def test_empty_name_is_rejected(self):
        valid, message = validate_resource_input('', '')
        self.assertFalse(valid)
        self.assertEqual(message, INVALID_NAME_MESSAGE)

    def test_name_without_any_letter_is_rejected(self):
        for name in ('!!!', '12345', '€€€', '- -'):
            valid, _ = validate_resource_name(name)
            self.assertFalse(valid, name)

    def test_single_repeated_letter_is_rejected(self):
        for name in ('aaaa', 'éééé', 'ппп', 'zzzzzz'):
            self.assertTrue(is_single_repeated_letter(name), name)
            valid, _ = validate_resource_name(name)
            self.assertFalse(valid, name)

    def test_generic_names_are_not_rejected_locally(self):
        # « bar », « autre », « divers », « test » étaient rejetés par un
        # dictionnaire de mots vagues : la sémantique appartient à l'IA.
        for name in ('bar', 'autre', 'divers', 'test', 'truc', 'mlsdjf', 'sono'):
            valid, reason = validate_resource_input(name, '')
            self.assertTrue(valid, name)
            self.assertEqual(reason, '')

    def test_non_latin_names_are_accepted(self):
        # Le vieux test ASCII `[a-z]` refusait toute écriture non latine.
        for name in ('Стол', '直子', 'çadı', 'מַשְׁבֵּר', 'chaises 調達'):
            valid, _ = validate_resource_name(name)
            self.assertTrue(valid, name)
        self.assertEqual(letters_only('Стол'), 'Стол')

    def test_accents_are_kept_and_normalised_once(self):
        self.assertEqual(normalize_text('  Gâteau  DE Fête '), 'gateau de fete')
        self.assertEqual(normalize_text('ÇA'), 'ca')

    def test_signals_are_never_rejections(self):
        # Un signal est transmis au LLM, jamais appliqué localement.
        signals = local_signals('dj11111111', '')
        self.assertTrue(any('11' in signal or 'répétition' in signal for signal in signals))
        valid, _ = validate_resource_name('dj11111111')
        self.assertTrue(valid)

    def test_short_name_is_a_signal_not_a_rejection(self):
        signals = local_signals('dj', '')
        self.assertTrue(any('court' in signal for signal in signals))
        self.assertTrue(validate_resource_name('dj')[0])

    def test_djembe_is_not_a_dj_service(self):
        # L'ancien code faisait `'dj' in name` : « djembé » passait pour un DJ.
        self.assertTrue(validate_resource_name('djembé')[0])
        query = estimations.search_query_for('djembé', 'percussionniste', 'Lyon')
        self.assertIn('djembe', query)
        self.assertNotEqual(query.split()[0], 'dj')
        self.assertNotIn('service_words', dir(estimations))

    def test_no_wordlist_survives_in_the_module(self):
        self.assertFalse(hasattr(estimations, 'service_words'))
        self.assertFalse(hasattr(estimations, '_GENERIC_TOKENS'))
        from . import validation as validation_module
        self.assertFalse(hasattr(validation_module, 'VAGUE_NAMES'))

    def test_ambiguity_reason_explains_the_structural_problem(self):
        reason = ambiguity_reason('!!!', '')
        self.assertIn('structurellement', reason)
        # Un nom lisible mais non identifiable reçoit une raison propre :
        # l'IA pourra en dire plus, le refus local ne s'en mêle pas.
        reason = ambiguity_reason('mlsdjf', 'pour le mariage')
        self.assertNotEqual(reason, INVALID_NAME_MESSAGE)


# ===========================================================================
# D. Validation stricte des nombres du LLM
# ===========================================================================

class NumUtilsTests(SimpleTestCase):
    def test_nan_and_infinity_are_rejected(self):
        from decimal import Decimal as D
        self.assertIsNone(decimal_or_none(D('NaN')))
        self.assertIsNone(decimal_or_none(D('Infinity')))
        self.assertIsNone(decimal_or_none(D('-Infinity')))
        self.assertIsNone(decimal_or_none(float('nan')))

    def test_negative_numbers_are_rejected(self):
        self.assertIsNone(decimal_or_none(-1))
        self.assertIsNone(decimal_or_none('-3.5'))
        self.assertIsNone(positive_decimal_or_none(0))

    def test_booleans_and_strings_are_rejected(self):
        self.assertIsNone(decimal_or_none(True))
        self.assertIsNone(decimal_or_none(False))
        self.assertIsNone(decimal_or_none('N/A'))
        self.assertIsNone(decimal_or_none('douze euros'))
        self.assertIsNone(decimal_or_none({'a': 1}))

    def test_readable_numbers_are_accepted(self):
        self.assertEqual(decimal_or_none('12,50'), Decimal('12.50'))
        self.assertEqual(decimal_or_none(12.5), Decimal('12.5'))
        self.assertEqual(decimal_or_none(Decimal('0')), Decimal('0'))

    def test_inverted_range_is_discarded(self):
        self.assertEqual(parse_range(80, 20), (None, None))
        self.assertEqual(parse_range(None, 20), (None, None))
        self.assertEqual(parse_range(20, None), (None, None))
        low, high = parse_range(20, 80)
        self.assertEqual((low, high), (Decimal('20'), Decimal('80')))

    def test_choice_index_rejects_booleans_and_out_of_bounds(self):
        self.assertIsNone(clean_choice_index(True, 3))
        self.assertIsNone(clean_choice_index(False, 3))
        self.assertIsNone(clean_choice_index(3, 3))
        self.assertIsNone(clean_choice_index(-1, 3))
        self.assertIsNone(clean_choice_index(1.5, 3))
        self.assertIsNone(clean_choice_index(0, 0))
        self.assertIsNone(clean_choice_index('abc', 3))
        self.assertEqual(clean_choice_index(2, 3), 2)
        self.assertEqual(clean_choice_index('2', 3), 2)
        self.assertEqual(clean_choice_index(1.0, 3), 1)


# ===========================================================================
# D/E. Validation d'un lot de réponses IA
# ===========================================================================

class EstimationsTests(SimpleTestCase):
    EXPENSES = [
        {'expense_id': 'e1', 'name': 'Chaises', 'description': '', 'category': 'autre',
         'quantity': '10', 'local_signals': [], 'web_candidates': []},
    ]
    QUERIES = {'e1': 'chaises'}

    def validate(self, raw, candidates=None, expenses=None):
        payload = {'results': [raw]} if isinstance(raw, dict) else raw
        return estimations.validate_batch_response(
            payload,
            expenses if expenses is not None else self.EXPENSES,
            {'e1': candidates or []},
            self.QUERIES,
        )['e1']

    def test_understood_key_missing_marks_analysis_failed(self):
        # Avant : `_as_bool(..., default=True)` → une réponse muette passait
        # pour « comprise », avec un prix inventé.
        result = self.validate({'expense_id': 'e1', 'unit_price_estimate': 12})
        self.assertEqual(result.status, estimations.STATUS_FAILED)
        self.assertIsNone(result.unit_price)

    def test_empty_response_marks_analysis_failed(self):
        result = self.validate([])
        self.assertEqual(result.status, estimations.STATUS_FAILED)

    def test_nan_negative_and_boolean_prices_stay_unpriced(self):
        for price in ('NaN', 'Infinity', -5, True, 'gratuit', 0):
            result = self.validate({
                'expense_id': 'e1', 'understood': True, 'unit_price_estimate': price,
            })
            self.assertEqual(result.status, estimations.STATUS_UNPRICED, price)
            self.assertIsNone(result.unit_price, price)
            self.assertTrue(result.reason, price)

    def test_valid_range_without_supplier_price_becomes_midpoint_estimate(self):
        # Le modèle fournit une fourchette honnête sans oser le prix unitaire :
        # le milieu devient un prix indicatif (étiqueté `ai_estimate`) au lieu
        # de perdre la ligne et de ramener le budget à 0 €.
        result = self.validate({
            'expense_id': 'e1', 'understood': True,
            'price_range_min': 10, 'price_range_max': 20,
        })
        self.assertEqual(result.status, estimations.STATUS_PRICED)
        self.assertEqual(result.unit_price, Decimal('15'))
        self.assertEqual(result.price_range_min, Decimal('10'))
        self.assertEqual(result.price_range_max, Decimal('20'))
        self.assertTrue(result.warnings)

    def test_inverted_range_is_discarded(self):
        result = self.validate({
            'expense_id': 'e1', 'understood': True, 'unit_price_estimate': 12,
            'price_range_min': 80, 'price_range_max': 20,
        })
        # Le prix unitaire reste utilisable en estimation, mais la fourchette
        # inversée est écartée (jamais « corrigée »).
        self.assertEqual(result.status, estimations.STATUS_PRICED)
        self.assertEqual(result.unit_price, Decimal('12'))
        self.assertIsNone(result.price_range_min)
        self.assertIsNone(result.price_range_max)

    def test_ambiguous_result_carries_no_price_offer_nor_url(self):
        result = self.validate({
            'expense_id': 'e1', 'understood': False,
            'ambiguity_reason': 'Objet non identifiable.',
            'unit_price_estimate': 99, 'chosen_index': 0,
        })
        self.assertEqual(result.status, estimations.STATUS_AMBIGUOUS)
        self.assertIsNone(result.unit_price)
        self.assertIsNone(result.offer)
        self.assertEqual(result.price_source, '')

    def test_chosen_index_out_of_bounds_yields_no_offer(self):
        result = self.validate(
            {'expense_id': 'e1', 'understood': True, 'unit_price_estimate': 12,
             'chosen_index': 7},
            candidates=[dict(OFFER_PAGE)],
        )
        self.assertIsNone(result.offer)
        # Aucune fiche retenue : le prix de l'IA reste une estimation étiquetée.
        self.assertEqual(result.price_source, 'ai_estimate')
        self.assertTrue(result.warnings)

    def test_chosen_index_boolean_yields_no_offer(self):
        result = self.validate(
            {'expense_id': 'e1', 'understood': True, 'unit_price_estimate': 12,
             'chosen_index': True},
            candidates=[dict(OFFER_PAGE)],
        )
        self.assertIsNone(result.offer)

    def test_invalid_offer_urls_are_discarded(self):
        for url in (
            'javascript:alert(1)',
            'data:text/html,<script>',
            'www.shop.example/x',
            'ftp://shop.example/x',
            'https://fr.wikipedia.org/wiki/Chaise',
            'https://sub.wikipedia.org/wiki/Chaise',
            'https://shop.example/' + 'a' * 2100,
        ):
            candidate = dict(OFFER_PAGE, url=url)
            result = self.validate(
                {'expense_id': 'e1', 'understood': True, 'unit_price_estimate': 12,
                 'chosen_index': 0},
                candidates=[candidate],
            )
            self.assertIsNone(result.offer, url)

    def test_real_offer_requires_a_verified_price_on_the_page(self):
        # Page non atteinte : aucun lien non vérifié ne doit être affiché.
        with patch('apps.budgets.websearch.validate_direct_offer', return_value=None):
            result = self.validate(
                {'expense_id': 'e1', 'understood': True, 'unit_price_estimate': 12,
                 'chosen_index': 0},
                candidates=[dict(OFFER_PAGE)],
            )
        self.assertEqual(result.status, estimations.STATUS_PRICED)
        self.assertEqual(result.price_source, 'ai_estimate')
        self.assertEqual(result.unit_price, Decimal('12'))
        self.assertIsNone(result.offer)
        self.assertTrue(result.warnings)

        # Tarif réellement relevé sur la page : seul cas de `real_offer`.
        verified = {
            'url': OFFER_PAGE['url'], 'domain': 'shop.example',
            'title': OFFER_PAGE['title'], 'price': 12.5, 'currency': 'EUR',
            'verified': True, 'price_verified': True, 'available': True,
        }
        with patch('apps.budgets.websearch.validate_direct_offer', return_value=verified):
            result = self.validate(
                {'expense_id': 'e1', 'understood': True, 'unit_price_estimate': 12,
                 'chosen_index': 0},
                candidates=[dict(OFFER_PAGE)],
            )
        self.assertEqual(result.price_source, 'real_offer')
        self.assertEqual(result.offer['price'], Decimal('12.5'))

    def test_chosen_page_proven_irrelevant_rejects_the_price(self):
        # Cas réel : « musicien » chiffré 12,50 € avec pour seule preuve un
        # article de presse (Meghan Markle / piano en chocolat). La page est
        # écartée ET le prix tombe : il n'avait pas d'autre fondement.
        rejected = {
            'verdict': 'rejected',
            'reason': 'la page ne mentionne pas musicien',
        }
        with patch('apps.budgets.websearch.validate_direct_offer', return_value=rejected):
            result = self.validate(
                {'expense_id': 'e1', 'understood': True, 'unit_price_estimate': 12.5,
                 'chosen_index': 0, 'match_note': 'Fiche produit correspondant'},
                candidates=[dict(OFFER_PAGE)],
            )
        self.assertEqual(result.status, estimations.STATUS_UNPRICED)
        self.assertIsNone(result.unit_price)
        self.assertIsNone(result.price_range_min)
        self.assertIsNone(result.price_range_max)
        self.assertIsNone(result.offer)
        self.assertEqual(result.price_source, '')
        self.assertTrue(result.warnings)
        self.assertIn('tarif fournisseur', result.reason.lower())

    def test_estimate_not_based_on_any_page_survives_irrelevant_results(self):
        # Cas réel (Gemini) : « sonorisation » estimée 550 € sans s'appuyer sur
        # une page ; la recherche sans clé ne renvoie que des pages hors sujet.
        # Le prix n'en dépendait pas : il reste une estimation IA, sans lien.
        rejected = {'verdict': 'rejected', 'reason': 'la page ne mentionne pas sonorisation'}
        with patch('apps.budgets.websearch.validate_direct_offer', return_value=rejected):
            result = self.validate(
                {'expense_id': 'e1', 'understood': True, 'unit_price_estimate': 550,
                 'price_range_min': 300, 'price_range_max': 900, 'chosen_index': None},
                candidates=[dict(OFFER_PAGE)],
            )
        self.assertEqual(result.status, estimations.STATUS_PRICED)
        self.assertEqual(result.unit_price, Decimal('550'))
        self.assertEqual(result.price_source, 'ai_estimate')
        self.assertIsNone(result.offer)

    def test_unreachable_chosen_page_keeps_price_but_marks_the_link(self):
        # Page non atteinte : le prix reste indicatif, mais le lien est écarté.
        unreachable = {
            'verdict': 'unreachable',
            'reason': "page inaccessible au moment de l'analyse",
        }
        with patch('apps.budgets.websearch.validate_direct_offer', return_value=unreachable):
            result = self.validate(
                {'expense_id': 'e1', 'understood': True, 'unit_price_estimate': 12,
                 'chosen_index': 0},
                candidates=[dict(OFFER_PAGE)],
            )
        self.assertEqual(result.status, estimations.STATUS_PRICED)
        self.assertEqual(result.unit_price, Decimal('12'))
        self.assertEqual(result.price_source, 'ai_estimate')
        self.assertIsNone(result.offer)
        self.assertTrue(result.warnings)

    def test_page_check_receives_the_resource_name_as_identity(self):
        with patch('apps.budgets.websearch.validate_direct_offer',
                   return_value={'verdict': 'unreachable', 'reason': ''}) as check:
            self.validate(
                {'expense_id': 'e1', 'understood': True, 'unit_price_estimate': 12,
                 'chosen_index': 0},
                candidates=[dict(OFFER_PAGE)],
            )
        # L'identité transmise est le **nom** de la ressource, jamais la requête
        # entière (qui contient le lieu et des mots génériques).
        self.assertEqual(check.call_args.args[2], 'Chaises')

    def test_system_prompt_demands_every_resource_and_context(self):
        system = estimations._system_prompt()
        self.assertIn('CHAQUE', system)
        self.assertIn('description', system)
        self.assertIn('article de presse', system)
        self.assertIn('recopiant', system.lower())

    def test_system_prompt_distinguishes_estimate_and_supplier_price(self):
        system = estimations._system_prompt().lower()
        self.assertIn('estimation ia indicative', system)
        self.assertIn('prix fournisseur réel', system)
        # La raison d'une ressource non chiffrée ne recopie pas le contexte.
        self.assertIn('local_signals', system)

    def test_unknown_and_missing_ids_are_handled(self):
        payload = {
            'results': [
                {'expense_id': 'inconnu', 'understood': True, 'unit_price_estimate': 5},
                {'expense_id': 'e1', 'understood': True, 'unit_price_estimate': 5},
            ],
        }
        results = estimations.validate_batch_response(
            payload, self.EXPENSES, {'e1': []}, self.QUERIES
        )
        self.assertEqual(set(results), {'e1'})
        # Aucun candidat : le prix de l'IA reste une estimation étiquetée,
        # sans lien fournisseur.
        self.assertEqual(results['e1'].unit_price, Decimal('5'))
        self.assertEqual(results['e1'].price_source, 'ai_estimate')
        self.assertIsNone(results['e1'].offer)
        self.assertEqual(results['e1'].status, estimations.STATUS_PRICED)

        results = estimations.validate_batch_response(
            {'results': []}, self.EXPENSES, {'e1': []}, self.QUERIES
        )
        self.assertEqual(results['e1'].status, estimations.STATUS_FAILED)

    def test_prompt_asks_for_unit_prices_and_never_a_total(self):
        prompt = estimations.build_batch_prompt(
            {'name': 'Anniversaire', 'type': 'trip', 'location': 'Lyon',
             'participants': 20, 'budget': 1000},
            self.EXPENSES,
        )
        self.assertIn('unit_price_estimate', prompt)
        self.assertNotIn('total_estimate', prompt)

    def test_prompt_demands_one_entry_per_resource(self):
        expenses = [
            estimations.build_expense_payload(
                SimpleNamespace(pk='e1', name='Chaises', description='',
                                category='autre', quantity=1)
            ),
            estimations.build_expense_payload(
                SimpleNamespace(pk='e2', name='Sono', description='',
                                category='autre', quantity=1)
            ),
        ]
        prompt = estimations.build_batch_prompt({'name': 'E', 'type': 'trip'}, expenses)
        self.assertIn('exactement 2 entrée(s)', prompt)
        # Les ressources sont numérotées : leur omettre une est visible.
        self.assertIn('1. {', prompt)
        self.assertIn('2. {', prompt)

    def test_prompt_candidates_is_bounded_and_shared_with_validation(self):
        candidates = [{'url': f'https://shop.example/p/{index}'} for index in range(10)]
        with patch.dict(settings.BUDGET_SEARCH, {'MAX_PROMPT_CANDIDATES': 3}):
            shown = estimations.prompt_candidates(candidates)
        self.assertEqual([c['url'] for c in shown], [
            'https://shop.example/p/0',
            'https://shop.example/p/1',
            'https://shop.example/p/2',
        ])
        # La liste bornée est celle que voit le modèle **et** celle où
        # ``chosen_index`` est résolu : un indice reste toujours valide.
        expense = estimations.build_expense_payload(
            SimpleNamespace(pk='e1', name='Chaises', description='',
                            category='autre', quantity=1),
            candidates=candidates,
        )
        self.assertEqual(len(expense['web_candidates']), 3)

    def test_search_query_is_deterministic_and_uses_the_location(self):
        query = estimations.search_query_for('Chaises', 'Pliables 10 places', 'Lyon')
        self.assertEqual(query, 'chaises pliables 10 places lyon')
        self.assertEqual(query, estimations.search_query_for(' Chaises ', 'Pliables 10 places', 'Lyon'))


# ===========================================================================
# E. Analyse budgétaire : états, scénarios, recommandations
# ===========================================================================

class AiAnalysisTests(SimpleTestCase):
    def event(self, budget=1000):
        return {'id': 'event-1', 'name': 'Événement', 'type': 'other',
                'description': '', 'objective': '', 'location': '',
                'participants': 10, 'budget': budget}

    def expense(self, expense_id='resource-1', name='Ressource', total=100,
                unit_price=100, quantity=1):
        return SimpleNamespace(
            id=expense_id, name=name, quantity=quantity, unit_price=unit_price,
            total=total, min_quantity=None, is_essential=False,
        )

    # --- états ---------------------------------------------------------------

    def test_budget_states_are_exact_without_threshold(self):
        self.assertEqual(ai_analysis.budget_state(Decimal('990'), Decimal('1000')), 'within_budget')
        self.assertEqual(ai_analysis.budget_state(Decimal('1000'), Decimal('1000')), 'exactly_met')
        self.assertEqual(ai_analysis.budget_state(Decimal('1001'), Decimal('1000')), 'over_budget')
        self.assertEqual(ai_analysis.budget_state(Decimal('100'), Decimal('0')), 'budget_missing')
        self.assertEqual(ai_analysis.budget_state(Decimal('100'), None), 'budget_missing')

    def test_prompt_uses_under_budget_mode_when_total_is_lower(self):
        prompt = ai_analysis.build_prompt(
            self.event(),
            [self.expense()],
            Decimal('100'),
            Decimal('1000'),
        )
        self.assertIn('statut : within_budget', prompt)
        self.assertIn('mode obligatoire : improvement', prompt)
        self.assertIn('ne réduis jamais une quantité', prompt)
        self.assertNotIn('Le budget est DÉPASSÉ', prompt)

    def test_prompt_does_not_turn_missing_budget_into_over_budget(self):
        prompt = ai_analysis.build_prompt(self.event(budget=0), [], Decimal('100'), Decimal('0'))
        self.assertIn('statut : budget_missing', prompt)
        self.assertIn('mode obligatoire : none', prompt)
        self.assertIn('Aucun solde n’est calculable', prompt)
        self.assertNotIn('Le budget est DÉPASSÉ', prompt)

    def test_ninety_nine_percent_is_not_a_balanced_threshold(self):
        # Régresse l'ancien seuil « 10 % » qui produisait l'étiquette balanced.
        prompt = ai_analysis.build_prompt(self.event(), [self.expense(total=990, unit_price=990)],
                                          Decimal('990'), Decimal('1000'))
        self.assertIn('statut : within_budget', prompt)
        self.assertNotIn('balanced', prompt)

    def test_exact_budget_is_free_improvement(self):
        prompt = ai_analysis.build_prompt(self.event(), [self.expense()],
                                          Decimal('1000'), Decimal('1000'))
        self.assertIn('statut : exactly_met', prompt)
        self.assertIn('mode obligatoire : free_improvement', prompt)

    # --- scénarios ------------------------------------------------------------

    def test_scenario_quantity_reduction_is_recomputed_by_the_backend(self):
        expense = self.expense(total=1000, unit_price=10, quantity=100)
        scenarios, rejected = ai_analysis._normalise_scenarios(
            [{
                'name': 'Moins de chaises',
                'description': 'Réduire la quantité au strict nécessaire.',
                'changes': [{
                    'expense_id': 'resource-1',
                    'strategy': 'reduce_quantity',
                    'new_quantity': 60,
                    'reason': 'Marge de sécurité',
                }],
                # Montants inventés par le modèle : ils doivent être ignorés.
                'saving': 9999,
                'new_total': 0,
            }],
            [expense],
            Decimal('1000'),
            Decimal('1000'),
        )
        self.assertEqual(rejected, [])
        self.assertEqual(len(scenarios), 1)
        scenario = scenarios[0]
        # 10 € × 60 = 600 ; économie réelle 400.
        self.assertEqual(scenario['new_total'], 600.0)
        self.assertEqual(scenario['saving'], 400.0)
        self.assertTrue(scenario['budget_respected'])
        change = scenario['changes'][0]
        self.assertEqual(change['strategy'], 'reduce_quantity')
        self.assertEqual(change['old_quantity'], 100.0)
        self.assertEqual(change['new_quantity'], 60.0)
        self.assertEqual(change['unit_price'], 10.0)
        self.assertEqual(change['old_cost'], 1000.0)
        self.assertEqual(change['new_cost'], 600.0)
        self.assertEqual(change['saving'], 400.0)
        self.assertEqual(scenario['remaining_after'], 400.0)
        self.assertEqual(scenario['overage_after'], 0.0)

    def test_scenario_change_carries_the_verified_offer_link(self):
        expense = self.expense(total=1000, unit_price=10, quantity=100)
        expense.price_source = 'real_offer'
        expense.product_url = 'https://shop.example/chaises'
        expense.offer_domain = 'shop.example'
        expense.offer_title = 'Chaise pliante'
        scenarios, _ = ai_analysis._normalise_scenarios(
            [{'name': 'Moins', 'changes': [{'expense_id': 'resource-1', 'new_quantity': 50}]}],
            [expense], Decimal('1000'), Decimal('1000'),
        )
        change = scenarios[0]['changes'][0]
        self.assertEqual(change['source_url'], 'https://shop.example/chaises')
        self.assertEqual(change['source_domain'], 'shop.example')
        self.assertEqual(change['source_title'], 'Chaise pliante')
        self.assertEqual(change['source_status'], 'verified')
        self.assertTrue(change['price_verified'])

    def test_scenario_without_a_real_reduction_is_rejected(self):
        expense = self.expense(total=100, unit_price=100, quantity=1)
        for change in (
            {'expense_id': 'resource-1', 'new_cost': 70},     # non multiple exact
            {'expense_id': 'resource-1', 'new_cost': 100},    # pas de réduction
            {'expense_id': 'resource-1', 'new_quantity': 1},  # pas de réduction
            {'expense_id': 'resource-1', 'new_quantity': 5},  # au-dessus de l'actuelle
            {'expense_id': 'resource-1', 'new_quantity': 'abc'},
            {'expense_id': 'inconnu', 'new_quantity': 0},
        ):
            scenarios, rejected = ai_analysis._normalise_scenarios(
                [{'name': 'Mauvais', 'changes': [change]}],
                [expense], Decimal('100'), Decimal('1000'),
            )
            self.assertEqual(scenarios, [], change)
            self.assertEqual(len(rejected), 1, change)

    def test_scenario_on_unknown_resource_is_rejected(self):
        scenarios, rejected = ai_analysis._normalise_scenarios(
            [{'name': 'Hors liste',
              'changes': [{'expense_id': 'autre-chose', 'new_cost': 10}]}],
            [self.expense()],
            Decimal('100'),
            Decimal('1000'),
        )
        self.assertEqual(scenarios, [])
        self.assertEqual(len(rejected), 1)

    def test_budget_respected_is_true_only_under_the_budget(self):
        expense = self.expense(total=180, unit_price=18, quantity=10)
        # new_quantity 9 → 18 € × 9 = 162 → économie 18 → nouveau total 162.
        too_expensive, _ = ai_analysis._normalise_scenarios(
            [{'name': 'Encore trop cher',
              'changes': [{'expense_id': 'resource-1', 'new_quantity': 9}]}],
            [expense], Decimal('180'), Decimal('100'),
        )
        self.assertEqual(len(too_expensive), 1)
        self.assertFalse(too_expensive[0]['budget_respected'])
        self.assertEqual(too_expensive[0]['remaining_after'], -62.0)
        self.assertEqual(too_expensive[0]['overage_after'], 62.0)

        under, _ = ai_analysis._normalise_scenarios(
            [{'name': 'Sous le budget',
              'changes': [{'expense_id': 'resource-1', 'new_quantity': 9}]}],
            [expense], Decimal('180'), Decimal('200'),
        )
        self.assertTrue(under[0]['budget_respected'])
        self.assertEqual(under[0]['remaining_after'], 38.0)
        self.assertEqual(under[0]['overage_after'], 0.0)

    def test_minimum_quantity_is_preserved_in_scenarios(self):
        expense = self.expense(total=100, unit_price=10, quantity=10)
        expense.min_quantity = Decimal('5')
        scenarios, rejected = ai_analysis._normalise_scenarios(
            [{'name': 'Sous le minimum',
              'changes': [{'expense_id': 'resource-1', 'new_quantity': 4}]}],
            [expense], Decimal('100'), Decimal('1000'),
        )
        self.assertEqual(scenarios, [])
        self.assertEqual(len(rejected), 1)
        # La quantité minimale exacte reste acceptée : 10 € × 5 = 50 €.
        ok, _ = ai_analysis._normalise_scenarios(
            [{'name': 'Au minimum',
              'changes': [{'expense_id': 'resource-1', 'new_quantity': 5}]}],
            [expense], Decimal('100'), Decimal('1000'),
        )
        self.assertEqual(len(ok), 1)
        self.assertEqual(ok[0]['new_total'], 50.0)

    def test_scenario_changes_use_ids_and_do_not_duplicate_a_resource(self):
        expenses = [
            self.expense('resource-a', 'Même nom', Decimal('1000'), unit_price=10, quantity=100),
            self.expense('resource-b', 'Même nom', Decimal('800'), unit_price=8, quantity=100),
        ]
        scenarios, _ = ai_analysis._normalise_scenarios(
            [{
                'name': 'Alternative',
                'description': 'Réduction',
                'changes': [
                    {'expense_id': 'resource-a', 'new_quantity': 50},
                    {'expense_id': 'resource-a', 'new_quantity': 40},
                    {'expense_id': 'resource-inexistant', 'new_quantity': 10},
                ],
            }],
            expenses,
            Decimal('1800'),
        )
        self.assertEqual(len(scenarios), 1)
        # Une seule réduction retenue pour la ressource-a (le doublon est écarté).
        self.assertEqual(len(scenarios[0]['changes']), 1)
        self.assertEqual(scenarios[0]['changes'][0]['expense_id'], 'resource-a')
        # 10 € × 50 = 500 ; économie 500.
        self.assertEqual(scenarios[0]['saving'], 500.0)

    # --- recommandations -------------------------------------------------------

    def test_paid_recommendation_within_balance_is_kept_as_ai_estimate(self):
        recommendations, total = ai_analysis._normalise_recommendations(
            [{'title': 'Photobooth', 'kind': 'improvement', 'estimated_cost': 250,
              'reason': 'Ambiance', 'benefit': 'Souvenirs'}],
            'within_budget', Decimal('1000'), Decimal('100'),
        )
        self.assertEqual(len(recommendations), 1)
        self.assertEqual(total, 250.0)
        self.assertEqual(recommendations[0]['estimated_cost'], 250.0)
        # Un coût de recommandation est **toujours** une estimation de l'IA,
        # jamais présenté comme un tarif relevé sur une page.
        self.assertEqual(recommendations[0]['cost_source'], 'ai_estimate')
        self.assertEqual(recommendations[0]['balance_after'], 650.0)

    def test_cumulative_paid_recommendations_never_exceed_the_balance(self):
        recommendations, total = ai_analysis._normalise_recommendations(
            [
                {'title': 'A', 'kind': 'improvement', 'estimated_cost': 600, 'reason': 'x'},
                {'title': 'B', 'kind': 'improvement', 'estimated_cost': 600, 'reason': 'y'},
            ],
            'within_budget', Decimal('1000'), Decimal('100'),
        )
        # 600 ≤ 900, mais 600 + 600 > 900 : la seconde est écartée.
        self.assertEqual([item['title'] for item in recommendations], ['A'])
        self.assertEqual(total, 600.0)

    def test_duplicate_recommendations_are_merged(self):
        recommendations, _ = ai_analysis._normalise_recommendations(
            [
                {'title': 'Plan B météo', 'kind': 'improvement',
                 'estimated_cost': None, 'reason': 'x'},
                {'title': 'plan b météo ', 'kind': 'improvement',
                 'estimated_cost': None, 'reason': 'y'},
            ],
            'within_budget', Decimal('1000'), Decimal('100'),
        )
        self.assertEqual(len(recommendations), 1)

    def test_recommendation_links_to_a_real_offer_of_the_resource(self):
        expense = self.expense('resource-1', 'Sono', Decimal('100'))
        expense.price_source = 'real_offer'
        expense.product_url = 'https://shop.example/sono'
        expense.offer_domain = 'shop.example'
        expense.offer_title = 'Pack sono'
        recommendations, _ = ai_analysis._normalise_recommendations(
            [{'title': 'Ajouter des micros', 'kind': 'improvement',
              'estimated_cost': None, 'expense_id': 'resource-1', 'reason': 'x'}],
            'within_budget', Decimal('1000'), Decimal('100'), [expense],
        )
        recommendation = recommendations[0]
        self.assertEqual(recommendation['url'], 'https://shop.example/sono')
        self.assertEqual(recommendation['domain'], 'shop.example')
        self.assertEqual(recommendation['source_status'], 'verified')
        self.assertTrue(recommendation['price_verified'])

    def test_paid_recommendation_exceeding_remaining_budget_is_dropped(self):
        recommendations, total = ai_analysis._normalise_recommendations(
            [{'title': 'Traiteur luxe', 'kind': 'improvement', 'estimated_cost': 950,
              'reason': 'Confort', 'benefit': 'Prestige'}],
            'within_budget', Decimal('1000'), Decimal('100'),
        )
        self.assertEqual(recommendations, [])
        self.assertEqual(total, 0)

    def test_paid_recommendations_are_dropped_when_analysis_is_incomplete(self):
        # Une recommandation **payante** n'est jamais conservée quand l'analyse
        # est incomplète : seule une suggestion qualitative (coût null) reste.
        with patch('apps.budgets.ai_analysis.generate_json', return_value={
            'summary': 'Partiel',
            'main_recommendation': {},
            'scenarios': [],
            'recommendations': [
                {'title': 'Amélioration payante', 'kind': 'improvement',
                 'estimated_cost': 50, 'reason': 'x', 'benefit': 'y'},
                {'title': 'Amélioration gratuite', 'kind': 'improvement',
                 'estimated_cost': None, 'reason': 'x', 'benefit': 'y'},
            ],
        }):
            result = ai_analysis.analyse_budget(
                self.event(),
                [self.expense()],
                incomplete=True,
            )
        self.assertEqual(
            [item['title'] for item in result['recommendations']],
            ['Amélioration gratuite'],
        )
        self.assertIsNone(result['recommendations'][0]['estimated_cost'])
        self.assertEqual(result['computed']['recommendations_total'], 0)
        self.assertIn('solde maximal', result['summary'])
        self.assertNotIn('réduction', result['summary'].lower())

    def test_under_budget_recommendation_is_not_silently_dropped(self):
        # Régression : `analyse_budget` passait l'état **compat** (`under_budget`)
        # à un normaliseur qui compare des noms **canoniques** (`within_budget`).
        # `expected_kind` valait alors `None` et toute recommandation sous budget
        # était jetée en silence — c'est pourquoi le front n'en voyait jamais.
        with patch('apps.budgets.ai_analysis.generate_json', return_value={
            'summary': 'Tout va bien.',
            'main_recommendation': {'title': '', 'reason': ''},
            'scenarios': [],
            'recommendations': [{
                'title': 'Prévoir un plan B météo',
                'kind': 'improvement',
                'estimated_cost': None,
                'reason': 'Événement en extérieur.',
                'benefit': 'Continuité en cas de pluie.',
            }],
        }):
            result = ai_analysis.analyse_budget(self.event(), [self.expense()])
        self.assertEqual(result['status'], 'under_budget')
        self.assertEqual(result['budget_state'], 'within_budget')
        self.assertEqual(len(result['recommendations']), 1)

    def test_qualitative_recommendations_remain_explicitly_unpriced(self):
        recommendations, total = ai_analysis._normalise_recommendations(
            [{'title': 'Accueil', 'kind': 'improvement', 'estimated_cost': None,
              'reason': 'x', 'benefit': 'y'}],
            'within_budget', Decimal('1000'), Decimal('100'),
        )
        self.assertEqual(total, 0)
        self.assertIsNone(recommendations[0]['estimated_cost'])

    def test_under_budget_rejects_optimization_kind(self):
        recommendations, _ = ai_analysis._normalise_recommendations(
            [{'title': 'Réduire', 'kind': 'optimization', 'estimated_cost': None,
              'reason': 'x', 'benefit': 'y'}],
            'within_budget', Decimal('1000'), Decimal('100'),
        )
        self.assertEqual(recommendations, [])

    def test_over_budget_allows_qualitative_recommendations(self):
        # Régresse la contrainte `recommendations: []` imposée par l'ancien
        # prompt : en dépassement, des conseils restent utiles.
        recommendations, _ = ai_analysis._normalise_recommendations(
            [{'title': 'Mutualiser les taxis', 'kind': 'optimization',
              'estimated_cost': None, 'reason': 'x', 'benefit': 'y'}],
            'over_budget', Decimal('100'), Decimal('180'),
        )
        self.assertEqual(len(recommendations), 1)

    def test_over_budget_forces_recommendation_cost_to_none(self):
        # En dépassement, une recommandation payante serait contradictoire :
        # le coût est forcé à ``None`` mais la piste qualitative est conservée.
        recommendations, total = ai_analysis._normalise_recommendations(
            [{'title': 'Achat', 'kind': 'optimization', 'estimated_cost': 40,
              'reason': 'x', 'benefit': 'y'}],
            'over_budget', Decimal('100'), Decimal('180'),
        )
        self.assertEqual(len(recommendations), 1)
        self.assertIsNone(recommendations[0]['estimated_cost'])
        self.assertIsNone(recommendations[0]['cost_source'])
        self.assertEqual(total, 0.0)

    def test_analysis_exposes_distinct_figures(self):
        with patch('apps.budgets.ai_analysis.generate_json', return_value={
            'summary': 'x', 'main_recommendation': {},
            'scenarios': [], 'recommendations': [],
        }):
            result = ai_analysis.analyse_budget(
                self.event(budget=1000), [self.expense(total=400)]
            )
        figures = result['figures']
        self.assertEqual(figures['budget_max'], 1000.0)
        self.assertEqual(figures['initial_cost'], 400.0)
        self.assertEqual(figures['savings'], 0.0)
        self.assertEqual(figures['improvements_cost'], 0.0)
        self.assertEqual(figures['final_cost'], 400.0)
        self.assertEqual(figures['final_remaining'], 600.0)
        self.assertEqual(result['computed']['figures'], figures)

    def test_over_budget_scenario_savings_appear_in_figures(self):
        expense = self.expense(total=1000, unit_price=10, quantity=100)
        with patch('apps.budgets.ai_analysis.generate_json', return_value={
            'summary': 'x',
            'main_recommendation': {'title': 'Réduire', 'reason': 'Trop cher'},
            'scenarios': [{'name': 'Moins', 'changes': [
                {'expense_id': 'resource-1', 'new_quantity': 50}]}],
            'recommendations': [],
        }):
            result = ai_analysis.analyse_budget(self.event(budget=800), [expense])
        self.assertEqual(result['budget_state'], 'over_budget')
        self.assertEqual(len(result['scenarios']), 1)
        self.assertEqual(result['figures']['savings'], 500.0)
        self.assertEqual(result['figures']['final_cost'], 500.0)
        self.assertEqual(result['figures']['final_remaining'], 300.0)

    # --- exclusions -------------------------------------------------------------

    def test_prompt_never_lists_ambiguous_nor_unpriced_resources(self):
        prompt = ai_analysis.build_prompt(
            self.event(),
            [self.expense()],
            Decimal('100'),
            Decimal('1000'),
        )
        self.assertNotIn('Ressource', prompt.split('EXCLUSION')[1])

        result = None
        with patch('apps.budgets.ai_analysis.generate_json', return_value=BUDGET_RESPONSE):
            result = ai_analysis.analyse_budget(
                self.event(),
                [self.expense()],
                ambiguous=[{'id': 'x', 'name': 'Truc bizarre', 'reason': 'inidentifiable'}],
                unpriced=[{'id': 'y', 'name': 'Prestation floue', 'reason': 'tarif inconnu'}],
            )
        self.assertEqual([item['id'] for item in result['ambiguous']], ['x'])
        self.assertEqual([item['id'] for item in result['unpriced']], ['y'])
        self.assertNotIn('Truc bizarre', result['summary'])

    def test_budget_analysis_reports_the_used_model(self):
        with patch('apps.budgets.ai_analysis.generate_json', return_value=BUDGET_RESPONSE):
            result = ai_analysis.analyse_budget(self.event(), [self.expense()])
        self.assertEqual(result['computed']['model'], settings.BUDGET_AI['MODEL'])


# ===========================================================================
# F. Recherche web
# ===========================================================================

class WebsearchTests(SimpleTestCase):
    def setUp(self):
        websearch.clear_cache()

    def tearDown(self):
        websearch.clear_cache()

    def test_clean_url_rejects_non_http_and_blocked_domains(self):
        self.assertEqual(websearch.clean_url('javascript:alert(1)'), '')
        self.assertEqual(websearch.clean_url('https://fr.wikipedia.org/wiki/Chaise'), '')
        self.assertEqual(websearch.clean_url('https://sub.wikipedia.org/x'), '')
        # Une URL très longue n'est pas tronquée par clean_url : elle est
        # conservée intacte (le champ modèle peut la refuser plus tard, mais
        # clean_url ne coupe jamais).
        long_url = 'https://shop.example/' + 'a' * 2100
        self.assertEqual(websearch.clean_url(long_url), long_url)

    def test_clean_url_strips_tracking_parameters(self):
        cleaned = websearch.clean_url('https://shop.example/p?utm_source=x&id=5&fbclid=abc')
        self.assertEqual(cleaned, 'https://shop.example/p?id=5')

    def test_product_page_detection(self):
        self.assertFalse(websearch.looks_like_product_page('https://shop.example/'))
        self.assertFalse(websearch.looks_like_product_page('https://shop.example/category/chaises'))
        self.assertFalse(websearch.looks_like_product_page('https://shop.example/dictionary/xyz'))
        self.assertTrue(websearch.looks_like_product_page('https://shop.example/products/chaises'))

    def test_editorial_pages_are_never_product_pages(self):
        # Un article de presse, un dossier ou un article daté ne vend rien :
        # le lien ne doit jamais être présenté comme une fiche produit.
        for url in (
            'https://news.example/latest/676762-meghan-markle-chocolate-piano',
            'https://news.example/2026/09/29/mobilisation-fonction-publique',
            'https://news.example/dossier/manifestation',
            'https://news.example/article/12345',
            'https://blog.example/blogs/post-1',
        ):
            self.assertFalse(websearch.looks_like_product_page(url), url)

    def test_quota_is_per_analysis_and_never_shared(self):
        with patch('apps.budgets.websearch._search_bing_html', return_value=[]):
            first = websearch.new_session(max_searches=1)
            second = websearch.new_session(max_searches=1)

            outcome = websearch.search_offers('chaises', first)
            self.assertEqual(outcome.results, [])
            self.assertFalse(outcome.capped)

            outcome = websearch.search_offers('chaises lyon', first)
            self.assertTrue(outcome.capped)
            self.assertEqual(first.searches_done, 1)

            # La seconde analyse dispose toujours de son quota complet.
            outcome = websearch.search_offers('chaises marseille', second)
            self.assertFalse(outcome.capped)
            self.assertEqual(second.searches_done, 1)

    def test_network_failure_is_not_an_exception_nor_an_ambiguity(self):
        request = httpx.Request('GET', 'https://www.bing.com/search?q=chaises')
        with patch('apps.budgets.websearch._search_bing_html',
                   side_effect=httpx.ConnectError('boom', request=request)):
            session = websearch.new_session(max_searches=2)
            outcome = websearch.search_offers('chaises', session)
        self.assertEqual(outcome.results, [])
        self.assertTrue(outcome.failed)
        self.assertEqual(session.failed, 1)

    def test_cache_is_shared_and_clearable(self):
        calls = []

        def fake_search(query, limit):
            calls.append(query)
            return []

        with patch('apps.budgets.websearch._search_bing_html', side_effect=fake_search):
            websearch.search_offers('chaises pliables', websearch.new_session())
            outcome = websearch.search_offers('chaises pliables', websearch.new_session())
        self.assertEqual(len(calls), 1)
        self.assertTrue(outcome.from_cache)

        websearch.clear_cache()
        with patch('apps.budgets.websearch._search_bing_html', side_effect=fake_search):
            websearch.search_offers('chaises pliables', websearch.new_session())
        self.assertEqual(len(calls), 2)

    def test_cached_results_are_revalidated_against_new_exclusions(self):
        # Un lien retenu avant l'ajout d'une exclusion (ici un dictionnaire) ne
        # doit jamais resurgir du cache vers le modèle.
        websearch.clear_cache()
        websearch._cache_put('chaises', [
            {'url': 'https://www.linguee.fr/produit/chaise', 'domain': 'linguee.fr'},
            {'url': 'https://shop.example/products/chaise', 'domain': 'shop.example'},
        ])
        outcome = websearch.search_offers(
            'chaises', websearch.new_session(max_searches=0)
        )
        self.assertEqual(
            [result['url'] for result in outcome.results],
            ['https://shop.example/products/chaise'],
        )
        websearch.clear_cache()

    def test_search_info_is_honest_about_the_keyless_provider(self):
        info = websearch.search_info()
        self.assertTrue(info['keyless'])
        self.assertIn('estimations IA', info['note'])

    @patch('apps.budgets.websearch.httpx.get')
    def test_direct_product_page_is_verified_and_price_is_separate(self, get):
        response = SimpleNamespace(
            url='https://shop.example/products/chairs',
            text=(
                '<html><head><title>Chaises pliables</title>'
                '<link rel="canonical" href="https://shop.example/products/chairs">'
                '</head><body><script type="application/ld+json">'
                '{"@type":"Product","name":"Chaises pliables",'
                '"offers":{"@type":"Offer","price":"12.50","priceCurrency":"EUR"}}'
                '</script></body></html>'
            ),
            raise_for_status=lambda: None,
        )
        get.return_value = response

        result = websearch.validate_direct_offer(
            'https://shop.example/products/chairs?utm_source=test', 'chaises pliables',
        )
        self.assertEqual(result['verdict'], 'verified')
        self.assertEqual(result['url'], 'https://shop.example/products/chairs')
        self.assertTrue(result['verified'])
        self.assertTrue(result['price_verified'])
        self.assertEqual(result['price'], 12.5)

    @patch('apps.budgets.websearch.httpx.get')
    def test_home_category_and_dictionary_pages_are_rejected(self, get):
        get.return_value = SimpleNamespace(
            url='https://shop.example/', text='<title>Shop</title>',
            raise_for_status=lambda: None,
        )
        for url in (
            'https://shop.example/',
            'https://shop.example/category/chairs',
            'https://example.org/dictionary/chairs',
        ):
            result = websearch.validate_direct_offer(url, 'chairs')
            self.assertEqual(result['verdict'], 'rejected', url)

    @patch('apps.budgets.websearch.httpx.get')
    def test_unrelated_product_page_is_rejected(self, get):
        get.return_value = SimpleNamespace(
            url='https://shop.example/products/plates',
            text='<title>Assiettes en porcelaine</title>',
            raise_for_status=lambda: None,
        )
        result = websearch.validate_direct_offer(
            'https://shop.example/products/plates', 'chaises pliables'
        )
        self.assertEqual(result['verdict'], 'rejected')
        # Le motif nomme le mot manquant : la page ne parle pas des chaises.
        self.assertIn('chaise', result['reason'])

    @patch('apps.budgets.websearch.httpx.get')
    def test_identity_tokens_beat_generic_query_words(self, get):
        # Une page d'actualité contient « lyon », « pour » et « ceremonie » mais
        # ne parle pas du musicien demandé : elle est rejetée sur l'identité.
        get.return_value = SimpleNamespace(
            url='https://news.example/produit/ceremonie-lyon',
            text=(
                '<title>Cérémonie à Lyon : les syndicats pour la mobilisation</title>'
                '<body>Manifestation prévue à Lyon pour la cérémonie de rentrée.</body>'
            ),
            raise_for_status=lambda: None,
        )
        result = websearch.validate_direct_offer(
            'https://news.example/produit/ceremonie-lyon',
            'musicien guitariste pour la ceremonie lyon',
            'musicien',
        )
        self.assertEqual(result['verdict'], 'rejected')
        self.assertIn('musicien', result['reason'])

    @patch('apps.budgets.websearch.httpx.get')
    def test_unreachable_page_is_not_a_rejection(self, get):
        # Panne réseau : on ne peut ni valider ni réfuter la page — verdict
        # distinct, jamais confondu avec « page non pertinente ».
        get.side_effect = websearch.httpx.ConnectError(
            'boom', request=websearch.httpx.Request('GET', 'https://shop.example/products/chairs')
        )
        result = websearch.validate_direct_offer(
            'https://shop.example/products/chairs', 'chaises', 'chaises'
        )
        self.assertEqual(result['verdict'], 'unreachable')
        self.assertEqual(result['reason'], "page inaccessible au moment de l'analyse")

    @patch('apps.budgets.websearch.httpx.get')
    def test_page_that_sells_nothing_is_rejected(self, get):
        # La page cite le mot mais ne vend rien (dictionnaire d'expressions,
        # fiche explicative) : elle est écartée, et avec elle le prix qui s'y
        # adossait.
        get.return_value = SimpleNamespace(
            url='https://explications.example/produit/truc',
            text=(
                '<title>Définition de truc</title>'
                '<body>Un truc est une chose dont on ne dit pas le nom.</body>'
            ),
            raise_for_status=lambda: None,
        )
        result = websearch.validate_direct_offer(
            'https://explications.example/produit/truc', 'truc', 'truc'
        )
        self.assertEqual(result['verdict'], 'rejected')
        self.assertIn('ne propose', result['reason'])

    def test_dictionary_domain_is_blocked_outright(self):
        # Le domaine d'expressions réellement observé est de toute façon exclu.
        self.assertEqual(websearch.clean_url('https://www.languefrancaise.net/Bob'), '')

    @patch('apps.budgets.websearch.httpx.get')
    def test_a_shop_page_with_a_price_still_passes(self, get):
        # Contre-épreuve : une vraie fiche produit annonce un prix, donc son
        # lien reste valide et son tarif peut être relevé.
        get.return_value = SimpleNamespace(
            url='https://shop.example/produit/chaise-pliable',
            text=(
                '<title>Chaise pliable 10 places</title>'
                '<script type="application/ld+json">'
                '{"@type": "Product", "offers": {"price": "12.50", "priceCurrency": "EUR"}}'
                '</script><button>Ajouter au panier</button>'
            ),
            raise_for_status=lambda: None,
        )
        result = websearch.validate_direct_offer(
            'https://shop.example/produit/chaise-pliable', 'chaise pliable', 'chaise pliable'
        )
        self.assertEqual(result['verdict'], 'verified')
        self.assertTrue(result['price_verified'])
        self.assertEqual(result['price'], 12.5)


# ===========================================================================
# Calculs déterministes
# ===========================================================================

class EventStub:
    def __init__(self, budget):
        self.target_budget = budget


class ItemStub:
    def __init__(self, total=None, ambiguous=False, unit_price=None, quantity=1,
                 analysis_status='', price_source=''):
        self.total = total
        self.is_ambiguous = ambiguous
        self.unit_price = unit_price
        self.quantity = quantity
        self.min_quantity = None
        self.is_essential = False
        self.analysis_status = analysis_status
        self.price_source = price_source


class CalculsTests(SimpleTestCase):
    def test_over_budget_is_strict(self):
        result = calculate_budget(EventStub(Decimal('100.00')), [ItemStub(Decimal('99.995'))])
        self.assertEqual(result['status'], 'on_budget')
        self.assertEqual(result['total'], Decimal('100.00'))

    def test_budget_recalculates_total_from_unit_price_and_quantity(self):
        result = calculate_budget(
            EventStub(Decimal('100.00')),
            [ItemStub(Decimal('999.00'), unit_price=Decimal('12.50'), quantity=4)],
        )
        self.assertEqual(result['total'], Decimal('50.00'))
        self.assertEqual(result['status'], 'under_budget')

    def test_missing_budget_never_becomes_over_budget(self):
        result = calculate_budget(EventStub(Decimal('0')), [ItemStub(Decimal('20'))])
        self.assertEqual(result['status'], 'budget_missing')
        self.assertIsNone(result['remaining'])

    def test_invalid_budget_is_missing(self):
        result = calculate_budget(EventStub('not-a-budget'), [ItemStub(Decimal('20'))])
        self.assertEqual(result['status'], 'budget_missing')

    def test_unpriced_and_ambiguous_lines_make_total_incomplete(self):
        result = calculate_budget(
            EventStub(Decimal('200')),
            [ItemStub(Decimal('50')), ItemStub(), ItemStub(ambiguous=True)],
        )
        self.assertEqual(result['total'], Decimal('50.00'))
        self.assertTrue(result['incomplete'])
        self.assertEqual(result['unpriced_count'], 1)
        self.assertEqual(result['ambiguous_count'], 1)

    def test_verified_and_ai_totals_are_separated(self):
        result = calculate_budget(
            EventStub(Decimal('1000')),
            [
                ItemStub(Decimal('40'), analysis_status='priced', price_source='real_offer'),
                ItemStub(Decimal('60'), analysis_status='priced', price_source='ai_estimate'),
            ],
        )
        self.assertEqual(result['total'], Decimal('100.00'))
        self.assertEqual(result['verified_total'], Decimal('40.00'))
        self.assertEqual(result['estimated_total'], Decimal('60.00'))
        self.assertEqual(result['verified_count'], 1)
        self.assertEqual(result['estimated_count'], 1)
        self.assertEqual(result['total_confidence'], 'estimated')

    def test_excluded_statuses_are_never_counted_as_priced(self):
        items = [
            ItemStub(Decimal('30'), analysis_status='priced'),
            ItemStub(Decimal('40'), analysis_status='ambiguous'),
            ItemStub(Decimal('50'), analysis_status='analysis_failed'),
            ItemStub(Decimal('60'), analysis_status='search_unavailable'),
            ItemStub(Decimal('70'), analysis_status='pending'),
        ]
        result = calculate_budget(EventStub(Decimal('1000')), items)
        self.assertEqual(result['total'], Decimal('30.00'))
        self.assertEqual(result['ambiguous_count'], 1)
        self.assertEqual(result['excluded_count'], 3)
        self.assertEqual(result['pending_count'], 1)
        self.assertTrue(result['incomplete'])

    def test_status_falls_back_for_legacy_objects(self):
        self.assertEqual(analysis_status_of(ItemStub(Decimal('10'))), 'priced')
        self.assertEqual(analysis_status_of(ItemStub()), 'understood_unpriced')
        self.assertEqual(analysis_status_of(ItemStub(ambiguous=True)), 'ambiguous')

    def test_all_budget_statuses_have_one_analysis_mode(self):
        self.assertEqual(analysis_mode('under_budget'), 'improvement')
        self.assertEqual(analysis_mode('on_budget'), 'free_improvement')
        self.assertEqual(analysis_mode('over_budget'), 'optimization')
        self.assertEqual(analysis_mode('budget_missing'), 'none')

    def test_optimization_recalculates_savings_and_remaining(self):
        result = calculate_optimization('150', '100', '30')
        self.assertEqual(result['total_after_optimization'], Decimal('120.00'))
        self.assertEqual(result['overage_after_optimization'], Decimal('20.00'))
        self.assertFalse(result['feasible'])

    def test_money_text_is_french_and_uses_two_decimals(self):
        # Une seule écriture des montants : jamais « 13 € » arrondi à côté de
        # « 12.50 EUR ». C'est ce libellé qui part dans les messages.
        self.assertEqual(money_text('12.5'), '12,50 €')
        self.assertEqual(money_text(1000), '1 000,00 €')
        self.assertEqual(money_text(Decimal('0.00')), '0,00 €')
        self.assertEqual(money_text(None), '0,00 €')

    def test_duplicate_lines_are_grouped_by_full_identity(self):
        def twin(pk, **kwargs):
            return SimpleNamespace(
                pk=pk,
                name=kwargs.get('name', 'musicien'),
                description=kwargs.get('description', ''),
                quantity=kwargs.get('quantity', 1),
                category=kwargs.get('category', 'autre'),
            )

        groups = views._duplicate_groups([
            twin(1), twin(2),
            twin(3, name='musicien', description='guitariste'),
        ])
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['name'], 'musicien')
        self.assertEqual(groups[0]['count'], 2)
        self.assertEqual(groups[0]['item_ids'], ['1', '2'])


# ===========================================================================
# F/G/H. API HTTP (base de données)
# ===========================================================================

class ApiTests(TestCase):
    """Contrats HTTP : isolation, codes de retour, verrou, persistance."""

    def setUp(self):
        self.org = Organization.objects.create(name='Orga test')
        # Un organisateur propriétaire authentifié : le RBAC exige désormais le
        # rôle ET la propriété de l'événement pour tout accès budget.
        self.owner_user = User.objects.create_user(
            username='orga@test.fr', email='orga@test.fr', password='x-test-1234'
        )
        self.owner_profile = Participant.objects.create(
            user=self.owner_user, organization=self.org, role='organizer', status='active'
        )
        self.event = Event.objects.create(
            organization=self.org,
            owner=self.owner_user,
            name='Anniversaire',
            event_type='trip',
            target_budget=Decimal('1000.00'),
            location='Lyon',
        )
        self.other_event = Event.objects.create(
            organization=self.org,
            owner=self.owner_user,
            name='Autre événement',
            event_type='trip',
            target_budget=Decimal('500.00'),
        )
        self.api = APIClient()
        self.api.force_authenticate(user=self.owner_user)

    def add_item(self, event=None, name='Chaises pliables', quantity=Decimal('10'), **kwargs):
        defaults = {'event': event or self.event, 'name': name, 'quantity': quantity}
        defaults.update(kwargs)
        return BudgetItem.objects.create(**defaults)

    def analyze(self, event=None, **payload):
        body = {'event': str((event or self.event).id)}
        body.update(payload)
        return self.api.post('/api/budget-items/analyze/', body, format='json')

    def summary(self, event=None):
        return self.api.get('/api/budget-items/summary/', {'event': str((event or self.event).id)})

    # --- isolation et identifiants -------------------------------------------

    def test_invalid_uuid_returns_400_not_500(self):
        self.add_item()
        for client_call in (
            lambda: self.api.post('/api/budget-items/analyze/',
                                  {'event': 'pas-un-uuid'}, format='json'),
            lambda: self.api.get('/api/budget-items/summary/', {'event': 'pas-un-uuid'}),
            lambda: self.api.post('/api/budget-items/estimate/',
                                  {'event': 'pas-un-uuid', 'resource_name': 'chaises'},
                                  format='json'),
        ):
            response = client_call()
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_and_unknown_event_are_client_errors(self):
        self.add_item()
        missing = self.api.post('/api/budget-items/analyze/', {}, format='json')
        self.assertEqual(missing.status_code, status.HTTP_400_BAD_REQUEST)
        unknown_id = uuid_lib.uuid4()
        unknown = self.api.post('/api/budget-items/analyze/',
                                {'event': str(unknown_id)}, format='json')
        self.assertEqual(unknown.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('introuvable', unknown.json()['error'])

    def test_resources_of_another_event_are_not_visible(self):
        private = self.add_item(name='Ressource privée')
        self.add_item(event=self.other_event, name='Ressource étrangère')
        response = self.api.get('/api/budget-items/', {'event': str(self.other_event.id)})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = [item['name'] for item in response.json()]
        self.assertEqual(names, ['Ressource étrangère'])
        self.assertNotIn(str(private.id), str(response.content))

    def test_estimate_refuses_an_item_of_another_event(self):
        foreign = self.add_item(event=self.other_event, name='Autre ressource')
        response = self.api.post('/api/budget-items/estimate/', {
            'event': str(self.event.id),
            'id': str(foreign.id),
            'resource_name': 'chaises',
            'quantity': 1,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        foreign.refresh_from_db()
        self.assertIsNone(foreign.unit_price)

    def test_estimate_prices_and_persists_through_the_batch_machinery(self):
        item = self.add_item(name='Chaises', quantity=Decimal('5'))
        with analysis_mocks():
            response = self.api.post('/api/budget-items/estimate/', {
                'event': str(self.event.id),
                'id': str(item.id),
                'resource_name': 'Chaises',
                'details': 'pliables',
                'quantity': 5,
            }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body['unit_price_estimate'], 10.0)
        self.assertIn('item', body)
        item.refresh_from_db()
        self.assertEqual(item.unit_price, Decimal('10'))
        self.assertEqual(item.total, Decimal('50.00'))
        self.assertEqual(item.analysis_status, 'priced')

    def test_estimate_refuses_a_non_positive_quantity(self):
        response = self.api.post('/api/budget-items/estimate/', {
            'event': str(self.event.id),
            'resource_name': 'Chaises',
            'quantity': 0,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('strictement positif', response.json()['error'])

    def test_event_cannot_be_changed_on_update(self):
        item = self.add_item()
        response = self.api.patch(f'/api/budget-items/{item.id}/?event={self.event.id}', {
            'event': str(self.other_event.id),
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        item.refresh_from_db()
        self.assertEqual(item.event_id, self.event.id)

    # --- persistance et invalidation ----------------------------------------

    def test_description_change_invalidates_the_analysis(self):
        item = self.add_item(unit_price=Decimal('10'), total=Decimal('100'),
                             price_source='ai_estimate', analysis_status='priced',
                             analysis_fingerprint='ancienne')
        response = self.api.patch(f'/api/budget-items/{item.id}/?event={self.event.id}', {
            'description': 'Pliables, 10 places',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item.refresh_from_db()
        self.assertEqual(item.analysis_status, 'pending')
        self.assertIsNone(item.unit_price)
        self.assertIsNone(item.total)
        self.assertEqual(item.price_source, '')

    def test_quantity_change_keeps_understanding_and_recomputes_total(self):
        item = self.add_item(quantity=Decimal('10'), unit_price=Decimal('12.50'),
                             total=Decimal('125.00'), price_source='ai_estimate',
                             analysis_status='priced')
        response = self.api.patch(f'/api/budget-items/{item.id}/?event={self.event.id}', {
            'quantity': 4,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item.refresh_from_db()
        self.assertEqual(item.unit_price, Decimal('12.50'))
        self.assertEqual(item.total, Decimal('50.00'))
        self.assertEqual(item.analysis_status, 'priced')

    def test_analysis_refuses_non_positive_quantities(self):
        response = self.api.post('/api/budget-items/', {
            'event': str(self.event.id),
            'name': 'Chaises',
            'category': 'other',
            'quantity': 0,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('quantity', response.json())

    def test_analysis_requires_at_least_one_resource(self):
        response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_serializer_exposes_analysis_status(self):
        item = self.add_item(analysis_status='pending')
        response = self.api.get(f'/api/budget-items/{item.id}/', {'event': str(self.event.id)})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()['analysis_status'], 'pending')

    def test_structural_rejection_needs_no_ai_call(self):
        self.add_item(name='!!!')
        with analysis_mocks() as mocks:
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mocks.estimations.assert_not_called()
        mocks.budget.assert_not_called()
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.analysis_status, 'ambiguous')
        self.assertIsNone(item.unit_price)
        self.assertEqual(item.product_url, '')

    # --- coût en appels IA ----------------------------------------------------

    def test_ai_call_count_is_constant(self):
        for count in (1, 5, 20):
            with self.subTest(resources=count):
                for index in range(count):
                    self.add_item(name=f'Ressource {index}')
                with analysis_mocks() as mocks:
                    response = self.analyze()
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                # Un appel par lot + un appel d'analyse budgétaire.
                self.assertLessEqual(mocks.estimations.call_count, 1)
                self.assertLessEqual(mocks.budget.call_count, 1)
                self.assertLessEqual(
                    mocks.estimations.call_count + mocks.budget.call_count, 2
                )
                self.assertEqual(response.json()['ai_calls'],
                                 mocks.estimations.call_count + mocks.budget.call_count)
                BudgetItem.objects.all().delete()

    def test_batch_size_is_configurable_but_never_per_resource(self):
        for index in range(5):
            self.add_item(name=f'Ressource {index}')
        with analysis_mocks() as mocks, patch.dict(settings.BUDGET_AI, {'BATCH_SIZE': 2}):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(mocks.estimations.call_count, 3)

    def test_unchanged_resources_are_reanalysed_with_zero_ai_call(self):
        self.add_item(name='Chaises pliables')
        with analysis_mocks():
            self.analyze()
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.analysis_status, 'priced')

        with analysis_mocks() as mocks:
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mocks.estimations.assert_not_called()

    def test_quantity_change_does_not_trigger_reanalysis(self):
        item = self.add_item(name='Chaises pliables', quantity=Decimal('10'))
        with analysis_mocks():
            self.analyze()
        item.refresh_from_db()
        self.assertEqual(item.unit_price, Decimal('10'))
        first_fingerprint = item.analysis_fingerprint

        item.quantity = Decimal('4')
        item.save(update_fields=['quantity'])
        with analysis_mocks() as mocks:
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mocks.estimations.assert_not_called()
        item.refresh_from_db()
        self.assertEqual(item.analysis_fingerprint, first_fingerprint)
        self.assertEqual(item.total, Decimal('40.00'))

    # --- verrou et concurrence -------------------------------------------------

    def test_concurrent_analysis_of_the_same_event_is_refused(self):
        self.add_item()
        self.assertTrue(views._acquire_analysis(self.event.id))
        try:
            response = self.analyze()
            self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        finally:
            views._release_analysis(self.event.id)

    def test_lock_is_released_after_analysis(self):
        self.add_item()
        with analysis_mocks():
            self.analyze()
        self.assertNotIn(str(self.event.id), views._ACTIVE_ANALYSES)

    def test_timeout_hands_the_rest_over_to_a_background_task(self):
        self.add_item()
        with analysis_mocks(), patch.dict(settings.BUDGET_AI, {'ANALYSIS_TIMEOUT': -1}):
            response = self.analyze()
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            body = response.json()
            self.assertTrue(body['background'])
            self.assertIn('arrière-plan', body['recommendations_notice'])
            # Le verrou reste pris tant que la tâche de fond tourne, puis libéré.
            for _ in range(100):
                if str(self.event.id) not in views._ACTIVE_ANALYSES:
                    break
                threading.Event().wait(0.05)
        self.assertNotIn(str(self.event.id), views._ACTIVE_ANALYSES)

    # --- code de retour selon la nature de l'échec -----------------------------

    def test_ai_unavailable_returns_503_and_never_simulates(self):
        self.add_item()

        def unavailable(*args, **kwargs):
            raise ollama_client.OllamaError('Ollama est injoignable.')

        with analysis_mocks(priced=unavailable):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.analysis_status, 'analysis_failed')
        self.assertIsNone(item.unit_price)
        self.assertIsNone(item.total)

    def test_invalid_ai_response_returns_502_with_details(self):
        self.add_item()

        def invalid(*args, **kwargs):
            raise ollama_client.InvalidAiResponse('JSON illisible.')

        with analysis_mocks(priced=invalid):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
        body = response.json()
        self.assertEqual(body['status'], 'failed')
        self.assertTrue(body['details'])

    def test_partial_failure_returns_200_with_per_resource_statuses(self):
        self.add_item(name='Chaises')
        self.add_item(name='Sonorisation')

        # Le premier lot aboutit, le second échoue : l'analyse continue.
        calls = {'count': 0}

        def first_ok_then_down(*args, **kwargs):
            calls['count'] += 1
            if calls['count'] == 1:
                return priced_results(*args, **kwargs)
            raise ollama_client.OllamaError('timeout')

        with analysis_mocks(priced=first_ok_then_down) as mocks:
            with patch.dict(settings.BUDGET_AI, {'BATCH_SIZE': 1}):
                response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        statuses = sorted(item['analysis_status'] for item in body['items'])
        self.assertEqual(statuses, ['analysis_failed', 'priced'])
        self.assertTrue(body['estimate_errors'])
        self.assertEqual(mocks.estimations.call_count, 2)

    # --- états des ressources ---------------------------------------------------

    def test_ambiguous_resource_has_no_price_provider_nor_link(self):
        self.add_item(name='Truc')

        def results_for(prompt, *args, **kwargs):
            payload = priced_results(prompt, price='10')
            payload['results'][0].update({
                'understood': False,
                'ambiguity_reason': 'Le nom ne permet pas d’identifier le produit.',
                'unit_price_estimate': 99,
            })
            return payload

        with analysis_mocks(priced=results_for):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.analysis_status, 'ambiguous')
        self.assertTrue(item.is_ambiguous)
        self.assertIsNone(item.unit_price)
        self.assertIsNone(item.total)
        self.assertEqual(item.provider, '')
        self.assertEqual(item.product_url, '')
        self.assertEqual(item.price_source, '')
        body = response.json()
        self.assertEqual(body['ambiguous'][0]['name'], 'Truc')
        self.assertEqual(body['computed']['total_expenses'], 0)

    def test_unpriced_resource_keeps_total_none(self):
        self.add_item(name='Prestation floue', quantity=Decimal('3'))

        def results_for(prompt, *args, **kwargs):
            payload = priced_results(prompt, price=None)
            payload['results'][0].update({
                'unit_price_estimate': None,
                'unpriced_reason': 'Tarif dépendant de la durée.',
            })
            return payload

        with analysis_mocks(priced=results_for):
            response = self.analyze()
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.analysis_status, 'understood_unpriced')
        self.assertIsNone(item.total)
        self.assertEqual(item.unpriced_reason, 'Tarif dépendant de la durée.')
        self.assertEqual(response.json()['computed']['total_expenses'], 0)

    def test_real_offer_never_invented_without_a_verified_price(self):
        self.add_item(name='Chaises pliables')

        def choose_first(prompt, *args, **kwargs):
            payload = priced_results(prompt, price='12')
            payload['results'][0]['chosen_index'] = 0
            return payload

        with analysis_mocks(priced=choose_first, validate=None):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item = BudgetItem.objects.get(event=self.event)
        # Page réelle trouvée, mais aucun tarif vérifié : estimation IA.
        self.assertEqual(item.price_source, 'ai_estimate')
        self.assertIsNone(item.offer_price)

    def test_real_offer_is_recorded_when_the_price_was_read_on_the_page(self):
        self.add_item(name='Chaises pliables')
        verified = {
            'url': OFFER_PAGE['url'], 'domain': 'shop.example',
            'title': OFFER_PAGE['title'], 'price': 12.5, 'currency': 'EUR',
            'verified': True, 'price_verified': True, 'available': True,
        }

        def choose_first(prompt, *args, **kwargs):
            payload = priced_results(prompt, price='12')
            payload['results'][0]['chosen_index'] = 0
            return payload

        with analysis_mocks(priced=choose_first, validate=verified):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.price_source, 'real_offer')
        self.assertEqual(item.offer_price, Decimal('12.5'))
        self.assertEqual(item.product_url, OFFER_PAGE['url'])

    def test_offer_index_outside_the_found_pages_yields_no_link(self):
        self.add_item(name='Chaises pliables')

        def choose_invalid(prompt, *args, **kwargs):
            payload = priced_results(prompt, price='12')
            payload['results'][0]['chosen_index'] = 42
            return payload

        with analysis_mocks(priced=choose_invalid):
            response = self.analyze()
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.product_url, '')
        self.assertEqual(item.provider, '')

    def test_long_urls_are_kept_intact_never_truncated(self):
        self.add_item(name='Chaises pliables')
        long_url = 'https://shop.example/products/chaises/' + 'a' * 560
        self.assertIn(len(long_url), range(590, 600))
        candidate = dict(OFFER_PAGE, url=long_url, domain='shop.example')

        def choose_first(prompt, *args, **kwargs):
            payload = priced_results(prompt, price='12')
            payload['results'][0]['chosen_index'] = 0
            return payload

        def only_this(query, session=None):
            return websearch.SearchOutcome(results=[candidate])

        # Page vérifiée : seul un lien vérifié est conservé (politique « aucun
        # lien non confirmé »). Le test porte sur la longueur, pas sur la
        # vérification.
        verified = {'verdict': 'verified', 'verified': True, 'url': long_url,
                    'title': 'Chaises pliables', 'price': None}
        with analysis_mocks(priced=choose_first, search=only_this, validate=verified):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.product_url, long_url)

    def test_search_failure_is_never_treated_as_ambiguity(self):
        self.add_item(name='Chaises pliables')

        def broken_search(query, session=None):
            session.record_failure()
            return websearch.SearchOutcome(results=[], failed=True)

        with analysis_mocks(search=broken_search):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.analysis_status, 'priced')
        self.assertFalse(item.is_ambiguous)
        self.assertEqual(item.price_source, 'ai_estimate')
        self.assertEqual(response.json()['web_search']['failed'], 1)

    def test_failed_search_without_any_price_is_search_unavailable(self):
        """Recherche en panne + aucun tarif : on dit « recherche indisponible ».

        Ce n'est ni une ambiguïté (le nom est parfaitement compris) ni un
        refus du modèle : l'organisateur sait que relancer l'analyse est utile.
        """
        self.add_item(name='Chaises pliables')

        def broken_search(query, session=None):
            session.record_failure()
            return websearch.SearchOutcome(results=[], failed=True)

        def understood_but_unpriced(prompt, *args, **kwargs):
            payload = priced_results(prompt, price=None)
            payload['results'][0].update({
                'unit_price_estimate': None,
                'unpriced_reason': 'Tarif dépendant de la durée.',
            })
            return payload

        with analysis_mocks(priced=understood_but_unpriced, search=broken_search):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.analysis_status, 'search_unavailable')
        self.assertFalse(item.is_ambiguous)
        self.assertIsNone(item.total)
        body = response.json()
        self.assertEqual(body['computed']['total_expenses'], 0)
        counts = body['computed']['analysis_status_counts']
        self.assertEqual(counts.get('search_unavailable'), 1)

    # --- agrégats de compatibilité ---------------------------------------------

    def test_compat_budget_shows_the_real_target_budget(self):
        self.add_item(name='Chaises', unit_price=Decimal('10'), total=Decimal('100'),
                      analysis_status='priced')
        response = self.api.get('/api/budgets/', {'event': str(self.event.id)})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()[0]
        self.assertEqual(payload['total_budget'], '1000.00')
        self.assertEqual(payload['estimated_total'], '100.00')

    def test_compat_categories_do_not_present_planned_as_actual(self):
        self.add_item(name='Chaises', category='tables_chaises', unit_price=Decimal('10'),
                      total=Decimal('100'), analysis_status='priced')
        self.add_item(name='Ambiguë', category='tables_chaises', analysis_status='ambiguous')
        self.add_item(name='Non chiffrée', category='decoration',
                      analysis_status='understood_unpriced')
        response = self.api.get('/api/budget-categories/', {'event': str(self.event.id)})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        by_name = {row['name']: row for row in response.json()}
        self.assertEqual(by_name['Tables et chaises']['planned_amount'], '100.00')
        self.assertIsNone(by_name['Tables et chaises']['actual_amount'])
        self.assertEqual(by_name['Tables et chaises']['ambiguous_count'], 1)
        self.assertEqual(by_name['Décoration et fleurs']['unpriced_count'], 1)

    def test_summary_counts_each_priced_resource_once(self):
        self.add_item(name='Chaises', category='tables_chaises', unit_price=Decimal('10'),
                      quantity=Decimal('2'), analysis_status='priced')
        self.add_item(name='Ambiguë', analysis_status='ambiguous')
        self.add_item(name='En attente', analysis_status='pending')
        response = self.summary()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body['priced_count'], 1)
        self.assertEqual(body['total_expenses'], 20.0)
        self.assertEqual(body['ambiguous_count'], 1)
        self.assertEqual(body['pending_count'], 1)
        self.assertTrue(body['incomplete'])

    def test_full_pipeline_produces_prices_and_a_budget_analysis(self):
        self.add_item(name='Chaises pliables', quantity=Decimal('10'))
        self.add_item(name='Sonorisation', quantity=Decimal('1'))

        def results_for(prompt, *args, **kwargs):
            payload = priced_results(prompt, price='15')
            payload['results'][0]['unit_price_estimate'] = '12'
            return payload

        with analysis_mocks(priced=results_for) as mocks:
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body['computed']['total_expenses'], 135.0)
        self.assertFalse(body['incomplete'])
        self.assertEqual(mocks.estimations.call_count, 1)
        self.assertEqual(mocks.budget.call_count, 1)
        self.assertEqual(body['ai_calls'], 2)
        self.assertEqual(len(body['items']), 2)

    def test_http_analysis_exposes_figures_and_quantity_only_scenarios(self):
        """Le chemin HTTP expose les chiffres distincts et des scénarios réels."""
        item = self.add_item(name='Chaises pliables', quantity=Decimal('10'))

        def pricey(prompt, *args, **kwargs):
            # 200 € × 10 = 2000 € : nettement au-dessus du budget de 1000 €.
            return priced_results(prompt, price='200')

        budget = {
            'summary': 'Budget dépassé.',
            'main_recommendation': {'title': 'Réduire les chaises', 'reason': 'Trop cher.'},
            'scenarios': [{
                'name': 'Moins de chaises',
                'description': 'Ne garder que le nécessaire.',
                'changes': [{
                    'expense_id': str(item.id),
                    'new_quantity': 4,
                    'reason': 'Besoin réel estimé à 4.',
                }],
            }],
            'recommendations': [],
        }

        with analysis_mocks(priced=pricey, budget=budget):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()

        # Chiffres distincts, recalculés par le backend.
        figures = body['figures']
        self.assertEqual(figures['budget_max'], 1000.0)
        self.assertEqual(figures['initial_cost'], 2000.0)
        self.assertEqual(figures['initial_overage'], 1000.0)
        self.assertEqual(figures['savings'], 1200.0)
        self.assertEqual(figures['final_cost'], 800.0)
        self.assertEqual(figures['final_remaining'], 200.0)
        self.assertTrue(figures['respects_budget'])

        # Le scénario reprend une **quantité**, jamais un prix inventé par l'IA.
        scenario = body['scenarios'][0]
        self.assertEqual(scenario['new_total'], 800.0)
        self.assertEqual(scenario['saving'], 1200.0)
        self.assertTrue(scenario['budget_respected'])
        change = scenario['changes'][0]
        self.assertEqual(change['new_quantity'], 4.0)
        self.assertEqual(change['unit_price'], 200.0)
        self.assertEqual(change['saving'], 1200.0)
        self.assertEqual(change['strategy'], 'reduce_quantity')

    # --- scénarios issus des ressources réelles de l'événement ----------------

    def test_failed_resource_is_reported_per_resource(self):
        """Un échec par ressource n'est plus silencieux : il remonte au front."""
        self.add_item(name='Musicien')

        def silent(prompt, *args, **kwargs):
            # Le modèle ne renvoie aucune entrée : la ressource part en échec.
            return {'results': []}

        with analysis_mocks(priced=silent):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertTrue(body['estimate_errors'])
        errors = {entry['resource']: entry['error'] for entry in body['estimate_errors']}
        self.assertIn('Musicien', errors)
        self.assertIn('pas répondu', errors['Musicien'])
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.analysis_status, 'analysis_failed')

    def test_irrelevant_chosen_page_rejects_the_price_and_the_link(self):
        """Cas « musicien / geo.tv » : une page non pertinente invalide le prix."""
        self.add_item(name='Musicien', quantity=Decimal('1'))

        def choose_first(prompt, *args, **kwargs):
            payload = priced_results(prompt, price='12.5')
            payload['results'][0]['chosen_index'] = 0
            payload['results'][0]['match_note'] = 'Fiche produit correspondant'
            return payload

        rejected = {
            'verdict': 'rejected',
            'reason': 'la page ne mentionne pas musicien',
        }
        with analysis_mocks(priced=choose_first, validate=rejected):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.analysis_status, 'understood_unpriced')
        self.assertIsNone(item.unit_price)
        self.assertIsNone(item.total)
        self.assertEqual(item.product_url, '')
        self.assertEqual(item.price_source, '')
        self.assertEqual(response.json()['computed']['total_expenses'], 0)

    def test_identical_lines_are_reported_but_never_merged(self):
        """Doublons signalés, jamais créés ni fusionnés par l'analyse."""
        self.add_item(name='Musicien', description='guitariste', quantity=Decimal('1'))
        self.add_item(name='Musicien', description='guitariste', quantity=Decimal('1'))
        before = BudgetItem.objects.filter(event=self.event).count()
        with analysis_mocks():
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(BudgetItem.objects.filter(event=self.event).count(), before)
        self.assertEqual(len(body['duplicates']), 1)
        self.assertEqual(body['duplicates'][0]['name'], 'Musicien')
        self.assertEqual(body['duplicates'][0]['count'], 2)

    def test_totals_are_written_in_french_with_two_decimals(self):
        """Le montant textuel et le montant numérique disent la même chose."""
        self.add_item(name='Musicien', quantity=Decimal('1'))

        def priced_12_5(prompt, *args, **kwargs):
            return priced_results(prompt, price='12.5')

        with analysis_mocks(priced=priced_12_5):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body['computed']['total_expenses'], 12.5)
        self.assertIn('12,50 €', body['summary'])

    def test_understand_and_price_are_independent_states(self):
        """Être comprise et être chiffrée sont deux états distincts."""
        self.add_item(name='Mlsdjf', quantity=Decimal('3'))

        def understood_without_price(prompt, *args, **kwargs):
            payload = priced_results(prompt, price=None)
            payload['results'][0].update({
                'unit_price_estimate': None,
                'unpriced_reason': 'Aucune base tarifaire trouvée pour ce nom.',
            })
            return payload

        with analysis_mocks(priced=understood_without_price):
            response = self.analyze()
        body = response.json()
        self.assertEqual(body['computed']['analysis_status_counts'].get('understood_unpriced'), 1)
        # La ressource n'est pas ambiguë, mais elle n'est pas chiffrée non plus.
        self.assertEqual(body['ambiguous'], [])
        self.assertEqual(len(body['unpriced']), 1)
        self.assertEqual(body['computed']['total_expenses'], 0)

    def test_unpriced_resources_still_get_a_qualitative_recommendation(self):
        """Sans poste chiffré, l'IA propose quand même des conseils qualitatifs."""
        self.add_item(
            name='Chaises pliables',
            description='location pour un séminaire',
            quantity=Decimal('100'),
        )

        def understood_without_price(prompt, *args, **kwargs):
            payload = priced_results(prompt, price=None)
            for entry in payload['results']:
                entry['unpriced_reason'] = 'Durée et capacité non précisées.'
            return payload

        qualitative = {
            'summary': 'Budget non consommé : des postes restent à préciser.',
            'main_recommendation': {'title': '', 'reason': ''},
            'scenarios': [],
            'recommendations': [{
                'title': 'Préciser la durée de location',
                'kind': 'improvement',
                'estimated_cost': None,
                'reason': 'Le tarif d’un loueur dépend de la durée.',
                'benefit': 'Décision plus rapide.',
            }],
        }
        with analysis_mocks(priced=understood_without_price, budget=qualitative):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body['computed']['analysis_status_counts'].get('understood_unpriced'), 1)
        # Deux appels au maximum : lot de ressources + analyse budgétaire.
        self.assertEqual(body['ai_calls'], 2)
        self.assertEqual(len(body['recommendations']), 1)
        self.assertIsNone(body['recommendations'][0]['estimated_cost'])
        # Une recommandation sans coût vérifié n’affiche aucun solde.
        self.assertIsNone(body['recommendations'][0]['balance_after'])

    def test_budget_analysis_failure_never_breaks_the_resources(self):
        """Une panne de l'analyse budgétaire laisse l'analyse des ressources intacte."""
        self.add_item(name='Chaises pliables', description='location', quantity=Decimal('10'))

        def understood_without_price(prompt, *args, **kwargs):
            payload = priced_results(prompt, price=None)
            for entry in payload['results']:
                entry['unpriced_reason'] = 'Durée non précisée.'
            return payload

        with patch('apps.budgets.estimations.generate_json',
                   side_effect=understood_without_price), \
                patch('apps.budgets.websearch.search_offers',
                      return_value=websearch.SearchOutcome(results=[])), \
                patch('apps.budgets.ai_analysis.generate_json',
                      side_effect=ollama_client.OllamaError('injoignable')):
            response = self.analyze()
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        item = BudgetItem.objects.get(event=self.event)
        self.assertEqual(item.analysis_status, 'understood_unpriced')
        self.assertIn('Aucune recommandation', body['recommendations_notice'])
