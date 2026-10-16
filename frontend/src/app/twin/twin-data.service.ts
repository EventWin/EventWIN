import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, firstValueFrom, forkJoin, map, of } from 'rxjs';
import {
  ApiBudget,
  ApiBudgetCategory,
  ApiEvent,
  ApiEventParticipant,
  ApiParticipant,
  ApiResource,
  ApiScenario,
  ApiScheduleItem,
  TwinSource
} from './twin.models';

/** Loads and persists the real API data behind an event's digital twin. */
@Injectable({ providedIn: 'root' })
export class TwinDataService {
  constructor(private readonly http: HttpClient) {}

  listEvents(): Observable<ApiEvent[]> {
    return this.http.get<ApiEvent[]>('/api/events/');
  }

  /**
   * Loads every source for one event. Secondary sources degrade gracefully:
   * a failing endpoint is reported in `partial` instead of breaking the twin.
   */
  loadTwin(event: ApiEvent): Observable<TwinSource> {
    const partial: string[] = [];
    const soft = <T>(label: string, request: Observable<T[]>) =>
      request.pipe(catchError(() => {
        partial.push(label);
        return of([] as T[]);
      }));

    const q = `?event=${encodeURIComponent(event.id)}`;
    return forkJoin({
      links: soft('participants inscrits', this.http.get<ApiEventParticipant[]>(`/api/event-participants/${q}`)),
      participants: soft('profils participants', this.http.get<ApiParticipant[]>('/api/participants/')),
      resources: soft('ressources', this.http.get<ApiResource[]>(`/api/resources/${q}`)),
      schedule: soft('programme', this.http.get<ApiScheduleItem[]>(`/api/event-schedule-items/${q}`)),
      budgets: soft('budgets', this.http.get<ApiBudget[]>(`/api/budgets/${q}`)),
      budgetCategories: soft('catégories budgétaires', this.http.get<ApiBudgetCategory[]>(`/api/budget-categories/${q}`)),
      scenarios: soft('scénarios', this.http.get<ApiScenario[]>(`/api/scenarios/${q}`))
    }).pipe(
      map((data) => ({
        event,
        ...data,
        // Older backends ignore ?event=, so filter again client-side.
        links: data.links.filter((l) => l.event === event.id),
        resources: data.resources.filter((r) => r.event === event.id),
        schedule: data.schedule.filter((s) => s.event === event.id),
        budgets: data.budgets.filter((b) => b.event === event.id),
        scenarios: data.scenarios.filter((s) => s.event === event.id),
        partial,
        loadedAt: new Date()
      }))
    );
  }

  async createEvent(payload: Partial<ApiEvent>): Promise<ApiEvent> {
    const organization = await this.ensureOrganization();
    return firstValueFrom(this.http.post<ApiEvent>('/api/events/', { ...payload, organization }));
  }

  updateEvent(id: string, patch: Partial<ApiEvent>): Promise<ApiEvent> {
    return firstValueFrom(this.http.patch<ApiEvent>(`/api/events/${id}/`, patch));
  }

  linkParticipant(eventId: string, participantId: string): Promise<ApiEventParticipant> {
    return firstValueFrom(this.http.post<ApiEventParticipant>('/api/event-participants/', {
      event: eventId,
      participant: participantId,
      attendance_status: 'registered'
    }));
  }

  saveScenario(eventId: string, name: string, description: string): Promise<ApiScenario> {
    return firstValueFrom(this.http.post<ApiScenario>('/api/scenarios/', {
      event: eventId,
      name,
      description,
      status: 'draft'
    }));
  }

  upsertHallResource(eventId: string, existing: ApiResource | undefined, capacity: number): Promise<ApiResource> {
    if (existing) {
      return firstValueFrom(this.http.patch<ApiResource>(`/api/resources/${existing.id}/`, { capacity }));
    }
    return firstValueFrom(this.http.post<ApiResource>('/api/resources/', {
      event: eventId,
      resource_type: 'room',
      name: 'Salle principale',
      capacity,
      unit_cost: '0'
    }));
  }

  /** Events require an organization; reuse the first one or create a default. */
  private async ensureOrganization(): Promise<string> {
    const organizations = await firstValueFrom(this.http.get<{ id: string }[]>('/api/organizations/'));
    if (organizations.length) {
      return organizations[0].id;
    }
    const created = await firstValueFrom(this.http.post<{ id: string }>('/api/organizations/', {
      name: 'Mon organisation',
      legal_name: ''
    }));
    return created.id;
  }
}
