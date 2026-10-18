# AUDIT.md — Intégrité de bout en bout EventWIN

> Réalisé dans le cadre de la remise à niveau du projet (branche
> `fix/fullstack-integrity`). Chaque constat est vérifié sur le code ou sur la
> base réelle ; rien n'est affirmé sans avoir été observé.

---

## 1. Cartographie

### Backend (Django 5.2 + DRF)
- `apps.core` — permissions RBAC (source unique de vérité).
- `apps.participants` — comptes, profils, préférences/contraintes, invitations,
  jetons (reset), quiz (modèles + vues + agrégats).
- `apps.events` — événements, planning, ressources, inscriptions.
- `apps.organizations` — organisations.
- `apps.budgets` — postes budgétaires, analyse IA (Ollama), recherche web.
- `apps.simulation` — scénarios du jumeau numérique.
- `apps.transport` — catalogue/évaluations transport.

### Frontend (Angular, standalone components)
- Front-office : landing, login/reset/activation participant, onboarding, profil.
- Back-office (`/app`) : jumeau (twin-home), supervision, optim, events,
  participants, budgets, teams.

---

## 2. Incohérences trouvées (et traitées)

### 2.1 Base de données — dérive de schéma (PHASE 1)
- **Colonnes orphelines** sur `events_event` : `capacity`, `created_by_id`,
  `organizer_id` présentes en base mais **déclarées par aucune migration**.
  - `capacity` adoptée (`SeparateDatabaseAndState`, NOT NULL défaut 0) ;
  - `created_by_id` / `organizer_id` supprimées (redondantes avec `owner`,
    non lues par le code ; sauvegarde `pg_dump` effectuée avant).
- **Tables orphelines vides** : `organizations_organizerinvitation`,
  `organizations_passwordresettoken` (ancien design abandonné, 0 ligne) →
  supprimées par migration justifiée et réversible.
- **Tables quiz** (`participants_eventquiz/quizquestion/quizanswer`)
  préexistantes et vides → **réutilisées** par les modèles (pas de doublon).

### 2.2 Authentification absente (PHASE 3)
- Aucune authentification réelle : `login` ne vérifiait rien de fiable.
- **Corrigé** : `login` crée une vraie session Django + jeton DRF ;
  `logout` détruit les deux ; `register` force `role='participant'` côté
  serveur (aucune élévation de privilège).

### 2.3 Mots de passe en clair (PHASE 4)
- Le flux « create_organizer » transmettait un mot de passe en clair par
  e-mail et le stockait tel quel.
- **Corrigé** : invitations à jeton haché (SHA-256), usage unique, expirable,
  révocable ; l'organisateur choisit son propre mot de passe via un lien.
  L'échec SMTP est **enregistré et affiché** (jamais d'envoi présumé).

### 2.4 Contrôle d'accès (IDOR / RBAC) (PHASE 2)
- Aucun contrôle de rôle ni de propriété : tout utilisateur authentifié
  pouvait lire/modifier les données d'autrui (budgets, événements, etc.).
- **Corrigé** : `apps/core/permissions.py` — source unique. Chaque endpoint
  sensible vérifie le rôle **et** la propriété (`can_manage_event`).
  Les budgets sont des données d'organisation → participants refusés.

### 2.5 Compteurs et capacité (PHASE 5)
- `registered_count` parfois stocké/dupliqué ; pas de protection contre le
  dépassement de capacité concurrent.
- **Corrigé** : compteur toujours calculé ; capacité verrouillée en base
  (`select_for_update`) ; contrainte d'unicité `(event, participant)`.

### 2.6 Quiz (PHASE 6)
- Aucun modèle/vue de quiz.
- **Corrigé** : modèles réutilisant les tables existantes ; réponses liées à
  l'inscription ; reprise d'un quiz inachevé ; distinction stricte
  « non répondu » ≠ « aucune allergie » dans l'agrégat.

### 2.7 Frontend — session fragile (PHASE 12)
- Jeton/rôlestockés directement, aucun intercepteur, aucune garde.
- **Corrigé** : `AuthService`, intercepteur HTTP (jeton + purge sur 401),
  gardes de route (confort UI — la protection réelle reste serveur).

---

## 3. Contrôles de sécurité appliqués

| Domaine | Contrôle |
|---|---|
| Rôle | Toujours lu côté serveur (profil `Participant` / `is_superuser`) |
| Propriété | `can_manage_event` objet par objet (anti-IDOR) |
| Élévation | `register` force `participant` côté serveur |
| Jetons | Hachés (SHA-256), usage unique, expirables, révocables |
| Mots de passe | Jamais en clair, jamais par e-mail |
| E-mail | Échec SMTP enregistré + affiché (honnêteté) |
| Invitation | Réponse générique anti-énumération + échec réel exposé |

---

## 4. Sauvegarde

- `pg_dump` complet avant toute migration :
  `C:\Users\CHAIMA\AppData\Local\Temp\opencode\db-backups\eventwin-20261018-133004.sql`

---

## 5. Configuration manquante / limitations

- **SMTP non configuré** (`.env` sans `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD`)
  → tous les envois d'e-mail échoueront en l'état. L'application signale
  honnêtement cet échec (jamais d'envoi présumé).
- **Ollama** (`llama3.2:3b`) requis pour l'analyse IA budgétaire ; sans lui,
  les analyses échouent proprement (statut `failed`), sans prix inventé.
