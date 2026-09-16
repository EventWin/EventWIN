# EventTwin

EventTwin is a digital-twin event planning and decision-support platform for agencies and large project owners.

## Stack

- Backend: Django + Django REST Framework
- Database: PostgreSQL
- Frontend: Angular
- Optional AI layer: Python service or Django-integrated AI module

## Repository structure

```text
backend/
  eventwin_api/
    eventwin_api/
    apps/
    requirements.txt
    manage.py
    .env.example
frontend/
  src/
  angular.json
  package.json
  tsconfig.json
  .editorconfig

docs/
  architecture.md
  next-steps.md
database/
  schema/
  migrations/
```

## Local development

1. Create and activate a virtual environment.
2. Install backend dependencies.
3. Configure PostgreSQL and environment variables.
4. Install frontend dependencies.
5. Run Django migrations and the Angular app.

## Team workflow

- Work on feature branches
- Open pull requests for review
- Keep main stable
- Document shared API and schema changes

## Goal

Provide a working event-management platform with digital-twin simulation, participant management, budget planning, and optional AI assistance.
