# EventTwin — Next Steps

## Phase 0: architecture and setup

### 1. Repository setup
- Create GitHub repo
- Define branch protection for main
- Add PR review policy
- Add README and contribution notes

### 2. Shared standards
- Define Python naming conventions and Django app conventions
- Define Angular component/service/module conventions
- Agree on API response shape and error handling
- Define database naming conventions

### 3. Backend foundation
- Create Django project and apps
- Configure PostgreSQL and environment variables
- Add Django REST Framework
- Define base models and migrations strategy
- Create health-check endpoints and project status endpoint

### 4. Frontend foundation
- Scaffold Angular app
- Set up app shell, shared layout, and navigation
- Create reusable UI components
- Add API service layer and environment configuration
- Prepare dashboard page structure

### 5. Database foundation
- Define core entities:
  - Organization
  - Event
  - EventSchedule
  - Participant
  - Preference
  - Budget
  - Resource
  - Scenario
- Define relationships and cardinality
- Prepare migration plan

### 6. First working end-to-end flow
- Create an event via API
- Display it in Angular UI
- Add participant data
- Prepare a simple budget and timeline
- Validate the full Angular → Django → PostgreSQL flow

## Functional module ownership

### Person 1 — Event & Organization Management
- organizations
- events
- event status
- schedule basics
- permissions/core access

### Person 2 — Participants & Preferences
- participant CRUD
- import tools
- constraints and questionnaires
- statistics

### Person 3 — Budget, Resources & Optimization
- budget categories and costs
- allocation and alerts
- planning vs actual
- basic rule-based optimization

### Person 4 — Digital Twin, Simulation & AI
- digital twin structure
- scenario cloning/comparison
- satisfaction rules
- AI integration layer

## Immediate next actions

1. Agree on schemas and naming conventions.
2. Create Django project structure and base settings.
3. Generate the initial database migrations and lock the shared ERD.
4. Add Docker Compose for PostgreSQL and the Django API once the schema is stable.
5. Create Angular app shell and service structure.
6. Draft initial endpoint list.
7. Start the first feature branch and first PR.

## Definition of done for Phase 0

- Project repo exists and main branch is protected.
- Django backend runs locally with PostgreSQL.
- Angular frontend runs locally.
- Initial core entities are planned and documented.
- At least one end-to-end CRUD flow works.
- Team has a shared architecture and working process.