# EventTwin

EventTwin is a digital-twin event planning and decision-support platform for agencies and large project owners.

## Stack

- Backend: Django + Django REST Framework
- Database: PostgreSQL
- Frontend: Angular
- Optional AI layer: Python service or Django-integrated AI module

## Architecture

```mermaid
flowchart TD
  UI[Angular Frontend]
  API[Django REST API]
  DB[(PostgreSQL)]
  SIM[Simulation Engine]
  AI[Optional AI Service]

  UI --> API
  API --> DB
  API --> SIM
  SIM --> DB
  SIM --> AI
  AI --> DB
```

## Data Model

```mermaid
erDiagram
  ORGANIZATION ||--o{ EVENT : owns
  ORGANIZATION ||--o{ PARTICIPANT : has
  EVENT ||--o{ EVENT_SCHEDULE_ITEM : contains
  EVENT ||--o{ RESOURCE : uses
  EVENT ||--o{ BUDGET : has
  EVENT ||--o{ SCENARIO : simulates
  EVENT ||--o{ EVENT_PARTICIPANT : includes
  PARTICIPANT ||--o{ EVENT_PARTICIPANT : attends
  PARTICIPANT ||--o{ PARTICIPANT_PREFERENCE : defines
  PARTICIPANT ||--o{ PARTICIPANT_CONSTRAINT : defines
  BUDGET ||--o{ BUDGET_CATEGORY : contains
  BUDGET_CATEGORY ||--o{ COST_ITEM : tracks
  SCENARIO ||--o{ SCENARIO_RESULT : produces
  EVENT ||--o{ TRANSPORT_AVAILABILITY_SNAPSHOT : checks
  EVENT ||--o{ TRANSPORT_EVALUATION : scores
  ORGANIZATION ||--o{ SPONSOR : manages
  EVENT ||--o{ SPONSORSHIP_PACKAGE : offers
  EVENT ||--o{ SPONSORSHIP_DEAL : funded_by
  SPONSOR ||--o{ SPONSORSHIP_DEAL : signs
  SPONSORSHIP_PACKAGE ||--o{ SPONSORSHIP_DEAL : sold_as
  SPONSORSHIP_DEAL ||--o{ SPONSOR_DELIVERABLE : owes
  SPONSORSHIP_DEAL ||--o{ SPONSOR_PAYMENT : pays
  SPONSORSHIP_DEAL ||--o{ SPONSORSHIP_ACTIVITY : logs
  EVENT ||--o{ SPONSOR_FIT_EVALUATION : scores
```

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
  sponsors.md
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

## Docker development

Use Docker after the shared schema is agreed and the first migrations exist, before separate module work starts.

1. Start PostgreSQL and the Django API with `docker compose up --build`.
2. Let the API container run migrations on startup.
3. Keep feature work pointing at the same containerized database so the team shares one runtime.

## Team workflow

- Work on feature branches
- Open pull requests for review
- Keep main stable
- Document shared API and schema changes

## Goal

Provide a working event-management platform with digital-twin simulation, participant management, budget planning, and optional AI assistance.
