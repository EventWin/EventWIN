EventTwin — Project Organization

Django + PostgreSQL + Angular • Digital Twin • Optional AI

1. Project idea

EventTwin is a management and decision-support platform for agencies and large project owners who organize events, trips, conferences, team activities, etc. The platform models the event as a digital twin: participants, activities, transport, accommodation, schedule, constraints and budget are represented digitally so organizers can compare scenarios before making decisions.

Main objective: maximize client/participant satisfaction while respecting and optimizing the available budget.

2. Main features

3. Team rule: everyone touches Frontend + Backend

No person is permanently 'the frontend developer' or 'the backend developer'. Each person owns a functional module and implements both its Angular side and Django/API/database side. The AI member additionally owns the shared AI layer.

4. Phase 0 — Build the architecture together

Create the GitHub repository together.

Agree on the project structure, naming conventions and coding standards.

Define the main database entities and relationships.

Define the Django REST API structure and endpoint conventions.

Create the Angular application structure and shared components.

Set up PostgreSQL and environment/configuration files.

Set up Git branches and pull-request rules.

Create a minimal working application: Angular → Django API → PostgreSQL.

Create initial README with setup instructions.

Recommended workflow: each person creates a feature branch → commits → opens a Pull Request → another teammate reviews → merge to main.

5. Four people — functional ownership

Person 1 — Event & Organization Management

Main task (no AI): Build the core event-management module: organizations/clients, events, event details, dates, locations, event status and basic schedules. Implement the Angular pages, Django APIs, models and PostgreSQL tables.

Main deliverables:

Create/edit/delete events

Organization/client management

Event dashboard

Basic schedule/timeline

Event permissions/access

Reusable event components

Optional AI addition: AI-assisted event creation: user gives a natural-language description such as '3-day company trip for 80 people' and AI proposes a draft event structure/schedule.

Person 2 — Participants & Preferences

Main task (no AI): Build participant management: employee/guest records, imports, preferences, constraints and feedback forms. Implement both frontend and backend for this module.

Main deliverables:

Participant CRUD

CSV/Excel participant import

Preference management

Dietary/accessibility constraints

Questionnaire form

Participant statistics

Optional AI addition: Persona generation: transform questionnaire/preferences into a structured participant profile such as activity preference, social preference and interests. Keep this as a separate service so the normal questionnaire works without AI.

Person 3 — Budget, Resources & Optimization

Main task (no AI): Build the financial/resource-management module: budget categories, costs, allocations, limits and comparison between planned and actual spending. Also create the first rule-based optimization/simulation logic without AI.

Main deliverables:

Budget creation

Cost items and categories

Budget allocation

Planned vs actual costs

Budget alerts

Rule-based scenario comparison

Basic cost optimization

Optional AI addition: AI budget assistant: explain where money is being spent, suggest cost-saving ideas and answer questions about the event budget using the project's data.

Person 4 — Digital Twin, Simulation & AI

Main task: Own the digital-twin/simulation module. Build the model that combines event, participants, activities, schedule, resources and budget into a simulation. Create scenario duplication and comparison. This module must work without AI.

Main deliverables:

Digital Twin data model

Scenario creation / cloning

What-if simulation

Scenario comparison

Satisfaction rules using explicit preferences

Simulation results dashboard

Expose simulation APIs for the other modules

AI addition — primary responsibility: Build the AI layer: satisfaction prediction, persona-based simulation, recommendations and/or AI planner. Integrate it with the digital twin rather than making AI a separate chatbot-only feature.

6. Important design principle: AI is an extension

The application must remain useful if the AI service is disabled. Core CRUD, event management, participants, budgets, rules, simulations and reporting should work normally. AI should improve the experience rather than become a hard dependency.

Example: satisfaction can first be calculated with explicit rules (preferences + activity matching). Later, the AI/ML service can replace or improve that calculation. This lets the team develop in parallel.

7. Suggested shared architecture

Angular — UI, dashboards, forms, simulation interface and charts.

Django + Django REST Framework — authentication, business logic and REST API.

PostgreSQL — persistent application data.

Python AI/ML service or Django-integrated AI module — optional AI capabilities.

GitHub — source control, Issues, Projects, Pull Requests and documentation.

High-level flow:

Angular → Django REST API → PostgreSQL

↘ AI/ML service (optional)

↘ Simulation / optimization engine

8. Development order

9. Example final demo

Create a company event for 100 employees.

Import the participant list and their preferences.

Create a 3-day schedule with transport, hotel and activities.

Set a €50,000 budget.

Open the Digital Twin and run the baseline simulation.

Compare two or more alternative scenarios.

Show predicted cost, satisfaction and constraints.

Enable AI and generate personas/recommendations.

Ask: 'Can we increase satisfaction without exceeding €50,000?'

Show the recommended scenario and explain the trade-off.

10. GitHub collaboration rules

main stays stable; do not directly push feature work to main.

Use feature branches: feature/events, feature/participants, feature/budget, feature/digital-twin, etc.

Small, meaningful commits; avoid one giant commit at the end.

Every feature is merged through a Pull Request.

At least one teammate reviews each Pull Request.

Do not commit passwords, API keys or .env files.

Keep API/database changes documented when they affect another module.

If two modules need the same change, discuss it before modifying shared architecture.

11. Definition of success

The minimum successful project is a working event-management platform in which an organizer can create an event, manage participants, define a schedule and budget, run a digital-twin scenario, compare alternatives and obtain a useful decision. AI is an advanced layer on top, except for Person 4, whose main responsibility includes the AI component.