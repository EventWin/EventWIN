# Module Sponsors

## Règle métier

Les sponsors n’ont **pas de compte**. Ils sont créés et gérés uniquement par un organisateur (`Participant.role = organizer`) ou un administrateur (`role = admin`). Un sponsor accède à son dossier uniquement via un lien de portail signé (tâche 6).

## Sécurité provisoire (`X-Participant-Id`)

Le projet n’a pas d’authentification DRF globale : le rôle est renvoyé par `POST /api/participants/login/` et stocké en `localStorage` (`participant_id`, `participant_role`).

Le module sponsors n’utilise **pas** ce mécanisme global. Il s’appuie sur une solution **isolée** dans `apps/sponsors/permissions.py` :

- `get_acting_participant(request)` lit l’en-tête HTTP `X-Participant-Id`.
- `IsOrganizerOrAdmin` n’autorise que si le participant existe et a `role` dans `organizer` / `admin` (un superutilisateur Django est aussi traité comme admin, comme `/login/`).
- `OrganizationScopedMixin` filtre sur l’organisation de l’organisateur ; un admin voit tout. Un organisateur sans organisation reçoit une liste vide et une erreur explicite à la création.

**Limite :** cet en-tête est falsifiable (le client peut envoyer n’importe quel UUID). Il **doit** être remplacé par une vraie authentification (session Django ou JWT) décidée par l’équipe. **Seul `permissions.py` est à changer** pour ce remplacement ; les viewsets continuent d’utiliser `IsOrganizerOrAdmin` et `OrganizationScopedMixin`.

Le portail sponsor (tâche 6) n’utilise pas cet en-tête : accès par token signé uniquement.

## Endpoints fondation (tâche 1)

Tous protégés par `IsOrganizerOrAdmin` + cloisonnement organisation, filtrables avec `?event=<uuid>` :

| Méthode | URL |
| --- | --- |
| CRUD | `/api/sponsors/` |
| CRUD | `/api/sponsorship-packages/` |
| CRUD | `/api/sponsorship-deals/` |
| GET, POST | `/api/sponsorship-activities/` (journal : pas de PATCH/DELETE) |
| CRUD | `/api/sponsor-deliverables/` |
| CRUD | `/api/sponsor-payments/` |
| CRUD | `/api/sponsor-fit-evaluations/` |

Création d’un sponsor : `created_by` et `organization` sont posés par le serveur. Doublon (nom normalisé ou domaine) → `409 { "duplicates": [...] }` sauf `?force=true`.
