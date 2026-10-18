import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService, AuthState } from '../../services/auth.service';

/**
 * Navigation latérale : ne présente que les modules accessibles au rôle
 * courant. Le masquage d'un lien n'est pas une sécurité — chaque route est
 * re-vérifiée par les gardes et, surtout, chaque endpoint par le serveur.
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule],
  template: `
  <aside class="side">
    <div class="logo">
      <div class="mark"></div>
      <div>Event<em>Twin</em><div class="tiny" style="color:var(--tx-3);margin-top:-3px;font-family:Inter">{{ roleLabel }}</div></div>
    </div>

    <a class="nav" routerLink="/app/home" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M4 7.4l8 4.6 8-4.6M12 12v9.2"/></svg>
      Jumeau numérique
    </a>
    <a class="nav" *ngIf="isOrganizer" routerLink="/app/supervision" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>
      Supervision
    </a>

    <div class="nav-group">Modules</div>
    <a class="nav" routerLink="/app/events" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
      Événements
    </a>
    <a class="nav" *ngIf="isAdmin" routerLink="/app/participants" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.5A3 3 0 0 1 16 11M18 19.5c0-2.4-1-4.2-2.6-5.2"/></svg>
      Participants
    </a>
    <a class="nav" *ngIf="isOrganizer" routerLink="/app/budgets" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M2.5 11h19M6.5 15.5h4"/></svg>
      Budgets &amp; ressources
    </a>
    <a class="nav" *ngIf="isOrganizer" routerLink="/app/optim" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z"/><path d="M18 17l.9 2.4L21 20l-2.1.7L18 23l-.9-2.3L15 20l2.1-.6z"/></svg>
      Optimiser <span class="tag">IA</span>
    </a>

    <ng-container *ngIf="isAdmin">
      <div class="nav-group">Administration</div>
      <a class="nav" routerLink="/app/teams" routerLinkActive="active">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/><circle cx="12" cy="7" r="3.4"/></svg>
        Équipes &amp; accès
      </a>
    </ng-container>

    <div class="side-foot">
      <a class="nav" routerLink="/app/profile" routerLinkActive="active" style="margin-top:8px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>
        Mon profil
      </a>
    </div>
  </aside>
  `
})
export class SidebarComponent {
  role: AuthState['role'] = null;

  constructor(private auth: AuthService) {
    this.role = auth.role;
    auth.state$.subscribe((state) => (this.role = state.role));
  }

  get isAdmin(): boolean {
    return this.role === 'admin';
  }

  get isOrganizer(): boolean {
    return this.role === 'organizer' || this.role === 'admin';
  }

  get roleLabel(): string {
    if (this.role === 'admin') return 'Super administrateur';
    if (this.role === 'organizer') return 'Organisateur';
    return 'Participant';
  }
}
