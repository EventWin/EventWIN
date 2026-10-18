import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ParticipantService } from './participant.service';

/**
 * État d'authentification côté client.
 *
 * Le rôle est **informations de confort** pour l'UI uniquement : la seule
 * protection réelle est le contrôle serveur (RBAC + propriété). Masquer un
 * bouton n'est pas une sécurité — chaque endpoint sensible vérifie le rôle
 * côté Django.
 */
export interface AuthState {
  token: string | null;
  role: 'admin' | 'organizer' | 'participant' | null;
  participantId: string | null;
  fullName: string | null;
  email: string | null;
}

const KEY_TOKEN = 'auth_token';
const KEY_ROLE = 'participant_role';
const KEY_ID = 'participant_id';
const KEY_NAME = 'participant_name';
const KEY_EMAIL = 'participant_email';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private state: AuthState = this.readStorage();
  private subject = new BehaviorSubject<AuthState>(this.state);

  readonly state$: Observable<AuthState> = this.subject.asObservable();

  constructor(private participantService: ParticipantService) {}

  private readStorage(): AuthState {
    return {
      token: localStorage.getItem(KEY_TOKEN),
      role: (localStorage.getItem(KEY_ROLE) as AuthState['role']) || null,
      participantId: localStorage.getItem(KEY_ID),
      fullName: localStorage.getItem(KEY_NAME),
      email: localStorage.getItem(KEY_EMAIL),
    };
  }

  private commit(next: Partial<AuthState>): void {
    this.state = { ...this.state, ...next };
    if (next.token !== undefined) {
      this.setItem(KEY_TOKEN, next.token);
    }
    if (next.role !== undefined) {
      this.setItem(KEY_ROLE, next.role);
    }
    if (next.participantId !== undefined) {
      this.setItem(KEY_ID, next.participantId);
    }
    if (next.fullName !== undefined) {
      this.setItem(KEY_NAME, next.fullName);
    }
    if (next.email !== undefined) {
      this.setItem(KEY_EMAIL, next.email);
    }
    this.subject.next(this.state);
  }

  private setItem(key: string, value: string | null): void {
    if (value === null || value === '') {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  }

  /** Enregistre la charge utile renvoyée par login/register/me. */
  saveSession(response: any): void {
    const participant = response?.participant || {};
    this.commit({
      token: response?.token || null,
      role: participant.role || 'participant',
      participantId: participant.id || null,
      fullName: participant.full_name || null,
      email: participant.email || null,
    });
  }

  /** Connexion : appelle l'API et stocke la session si succès. */
  login(email: string, password: string): Observable<any> {
    return this.participantService.login(email, password);
  }

  logout(): void {
    // Le serveur détruit session + jeton ; on nettoie le client quoi qu'il arrive.
    this.participantService.logout().subscribe({ error: () => {} });
    this.clear();
  }

  clear(): void {
    this.commit({
      token: null,
      role: null,
      participantId: null,
      fullName: null,
      email: null,
    });
  }

  get token(): string | null {
    return this.state.token;
  }

  get role(): AuthState['role'] {
    return this.state.role;
  }

  get isAuthenticated(): boolean {
    return !!this.state.token;
  }

  get isOrganizer(): boolean {
    return this.state.role === 'organizer' || this.state.role === 'admin';
  }

  get isAdmin(): boolean {
    return this.state.role === 'admin';
  }
}
