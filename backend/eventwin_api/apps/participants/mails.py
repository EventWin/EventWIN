"""Envoi d'e-mails — chaque échec est **retourné**, jamais absorbé.

Aucune fonction ici ne prétend à un envoi : le résultat est ``(ok, erreur)``.
Le rôle de l'application est d'afficher l'état réel à l'utilisateur
(« e-mail envoyé » ou « échec : raison »), jamais d'inventer un succès.
"""
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string


def send_template_email(subject: str, template: str, context: dict, recipient: str):
    """Envoie un e-mail HTML. Retourne ``(envoyé, message_erreur)``.

    Une configuration SMTP absente ou un refus du serveur devient un échec
    explicite — jamais un envoi présumé.
    """
    try:
        html_content = render_to_string(template, context)
        plain_body = (
            'EventTwin — si vous ne parvenez pas à ouvrir le lien, '
            'copiez-le intégralement dans votre navigateur.'
        )
        message = EmailMultiAlternatives(
            subject,
            plain_body,
            settings.EMAIL_FROM or None,
            [recipient],
        )
        message.attach_alternative(html_content, 'text/html')
        message.send(fail_silently=False)
        return True, ''
    except Exception as exc:  # noqa: BLE001 — tout échec devient un message
        return False, f'{type(exc).__name__}: {exc}'
