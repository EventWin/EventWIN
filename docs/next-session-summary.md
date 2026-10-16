# Next Session Handoff

## State (2026-10-16)

Branch `participant-fixed` has the `participant` work merged by hand onto `main`; all changes are **staged, not committed**.
`participant` shares no history with `main` (orphan snapshot), so git cannot merge it; that's why the earlier cherry-pick blew up.

### What was merged
- Backend from `participant`: participants app (User-linked `Participant`, `Organizer` proxy, login/register/organizer views, admin), events/organizations admin, email templates, jazzmin + CORS + email settings.
- Kept from `main`: events model/serializer/migrations 0002-0004, transport app, n8n doc, frontend proxy (`proxy.conf.json`), the 761-line events page (moved to `pages/backoffice/events`).
- Frontend from `participant`: frontoffice/backoffice restructure, landing, participant login/register/onboarding/profile, admin/organizer login, `/admin-login` route, root `package.json` (`npm run dev`).
- `participant.service.ts` now uses relative `/api/...` URLs (goes through the dev proxy).
- `participants/0001_initial.py` uses the participant version because that is what Neon has applied. Local DBs built from main's old 0001 need a reset.
- Added `participants/0002_organizer.py` (proxy model, no schema change).
- `requirements.txt`: added `django-cors-headers`, `django-jazzmin`.
- Added `.gitignore`; untracked ~38.7k generated files (node_modules, dist, .angular, __pycache__). Local copies untouched.
- `backend/eventwin_api/.env` restored locally from `participant` (ignored, not committed).

### Verified
- `manage.py check`: no issues; `makemigrations --check`: clean.
- `ng build --configuration development`: OK.
- `POST /api/participants/login/` with the test admin: `Login successful`.

## Open items
1. Neon is missing `events` 0002-0004 and `transport` 0001, so `/api/events/` returns 500 until `manage.py migrate` is run against the shared DB.
2. Commit, push `participant-fixed`, open PR into `main`.
3. Neon/Gmail credentials were committed in the `participant` branch history; rotate them.

## Useful commands
- Frontend: `npm run dev` (repo root)
- Backend (from `backend/eventwin_api`):
  - `& 'D:\STAGE KNOWLEPSY\Environment folder\venv311\Scripts\python.exe' manage.py check`
  - `& 'D:\STAGE KNOWLEPSY\Environment folder\venv311\Scripts\python.exe' manage.py runserver 8000`
