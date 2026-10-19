# EventTwin Architecture

## Overview

EventTwin is composed of:

- Angular frontend for user interaction and dashboards
- Django REST API for business logic and persistence
- PostgreSQL for transactional data
- Optional AI service for persona generation, scoring, and recommendations
- Simulation engine for scenarios and optimization logic

## High-level flow

```text
Angular UI
   ↓
Django REST API
   ↓
PostgreSQL
   ↘
Simulation / optimization engine
   ↘
AI service (optional)
```

## Domains

### 1. Event & Organization
- organization
- event
- dates
- location
- status
- schedule

### 2. Participants & Preferences
- participant
- questionnaire
- constraints
- dietary requirements
- preferences

### 3. Budget & Resources
- budget
- cost categories
- allocations
- actual vs planned
- resource planning

### 4. Digital Twin & Simulation
- scenario
- baseline model
- what-if simulation
- comparison dashboard
- satisfaction scoring

### 5. Sponsoring
- sponsor (CRM, créé par un organisateur)
- sponsorship package, deal et pipeline
- contreparties (deliverables) et paiements
- score de pertinence, conflits, alertes
- budget net et impact sur scénario (lecture seule)
- portail sponsor par lien signé (voir `docs/sponsors.md`)

## Backend app structure

```text
backend/eventwin_api/
  eventwin_api/
    settings.py
    urls.py
    wsgi.py
    asgi.py
  apps/
    organizations/
    events/
    participants/
    budgets/
    simulation/
    transport/
    sponsors/
    ai/
```

## Frontend structure

```text
frontend/src/app/
  core/
  shared/
  features/
    events/
    participants/
    budgets/
    simulation/
    dashboard/
```

## Shared principles

- AI is optional and non-blocking.
- Core functionality must work without AI.
- Each feature owner is responsible for both frontend and backend implementation.
- Shared schema and API contracts should stay documented.

## Phase 0 target

The architecture should support a minimal working system:

- create an event
- import participants
- define a schedule
- capture a budget
- simulate a baseline scenario
- compare alternatives
