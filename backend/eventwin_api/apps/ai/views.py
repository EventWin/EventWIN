from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.budgets.ollama_client import OllamaError

from . import fit


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def participant_fit_options(request):
    """Événements et participants que l'utilisateur peut analyser."""
    return Response(fit.options(request.user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def participant_fit(request):
    """Adéquation IA participants × événements.

    Corps : ``{"event_ids": [...], "participant_ids": [...]?, "refresh": bool?}``.
    Sans ``participant_ids`` : tous les participants visibles. Un participant
    (non organisateur) ne peut analyser que son propre profil.
    """
    event_ids = request.data.get('event_ids') or []
    participant_ids = request.data.get('participant_ids') or None
    if not isinstance(event_ids, list) or (participant_ids is not None and not isinstance(participant_ids, list)):
        return Response(
            {'error': '« event_ids » et « participant_ids » doivent être des listes.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        result = fit.analyze(
            request.user, event_ids, participant_ids,
            refresh=bool(request.data.get('refresh')),
        )
    except ValueError as error:
        return Response({'error': str(error)}, status=status.HTTP_400_BAD_REQUEST)
    except LookupError as error:
        return Response({'error': str(error)}, status=status.HTTP_404_NOT_FOUND)
    except OllamaError as error:
        return Response(
            {'error': f'IA indisponible : {error}'}, status=status.HTTP_503_SERVICE_UNAVAILABLE
        )
    return Response(result)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def event_participant_fit(request, event_id):
    """Adéquation Gemini des inscrits d'un événement (jumeau 3D).

    GET : résultats en cache, sans appel IA. POST ``{"refresh": bool}`` :
    analyse les inscrits sans résultat (tous si ``refresh``).
    """
    try:
        if request.method == 'GET':
            return Response(fit.event_results(request.user, str(event_id)))
        return Response(fit.analyze_event(request.user, str(event_id), refresh=bool(request.data.get('refresh'))))
    except LookupError as error:
        return Response({'error': str(error)}, status=status.HTTP_404_NOT_FOUND)
    except OllamaError as error:
        return Response({'error': f'IA indisponible : {error}'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
