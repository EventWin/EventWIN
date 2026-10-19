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

/**
 * Interface d'accueil associée à chaque rôle. Le rôle est renvoyé par le
 * serveur à la connexion ; l'utilisateur ne le choisit jamais.
 *  - admin, organizer → jumeau numérique 3D (écran d'ouverture) ;
 *  - participant→ espace Participant.
 */
export const ROLE_HOME: Record<'admin' | 'organizer' | 'participant', string> = {
  admin: '/app/home',
  organizer: '/app/home',
  participant: '/app/profile',
};

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

  /**
   * Recharge l'identité **depuis le serveur** (``/me``). Le rôle local reste
   * un simple confort d'affichage : il est réaligné sur la vérité serveur à
   * chaque entrée dans l'espace protégé, ce qui neutralise toute altération du
   * ``localStorage``. En cas de jeton invalide, l'intercepteur déconnecte.
   */
  refresh(): void {
    if (!this.state.token) {
      return;
    }
    this.participantService.me().subscribe({
      next: (profile: any) =>
        this.commit({
          role: profile?.role || 'participant',
          participantId: profile?.id || null,
          fullName: profile?.full_name || null,
          email: profile?.email || null,
        }),
      error: () => {
        /* L'intercepteur gère le 401 ; on ignore les autres erreurs réseau. */
      },
    });
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

  /** Route d'accueil du rôle courant (redirection après connexion). */
  homeRoute(): string {
    return ROLE_HOME[this.state.role ?? 'participant'];
  }

  get token(): string | null {
    return this.state.token;
  }

  get role(): AuthState['role'] {
    return this.state.role;
  }

  get participantId(): string | null {
    return this.state.participantId;
  }

  get fullName(): string | null {
    return this.state.fullName;
  }

  get email(): string | null {
    return this.state.email;
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

  get isParticipant(): boolean {
    return this.state.role === 'participant';
  }
}
