import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const STORAGE_KEY = 'eventwin_selected_event';

/** The event the organizer is currently working on, shared across pages and reloads. */
@Injectable({ providedIn: 'root' })
export class EventContextService {
  private readonly selected = new BehaviorSubject<{ id: string; name: string } | null>(this.read());
  readonly selected$ = this.selected.asObservable();

  get current(): { id: string; name: string } | null {
    return this.selected.value;
  }

  select(id: string, name: string): void {
    if (this.current?.id === id && this.current?.name === name) {
      return;
    }
    this.selected.next({ id, name });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, name }));
    } catch {
      // storage unavailable: selection still works for this session
    }
  }

  clear(): void {
    this.selected.next(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  private read(): { id: string; name: string } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}
