import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
  <aside class="side">
    <div class="logo">
      <div class="mark"></div>
      <div>Event<em>Twin</em><div class="tiny" style="color:var(--tx-3);margin-top:-3px;font-family:Inter">Atlas Group</div></div>
    </div>

    <a class="nav" routerLink="/app/home" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>
      <span class="only-client">Mon tableau de bord</span><span class="only-admin">Supervision</span>
    </a>

    <div class="nav-group only-client">Modules</div>
    <a class="nav only-client" routerLink="/app/events" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
      Événements
    </a>
    <a class="nav only-client" routerLink="/app/participants" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.5A3 3 0 0 1 16 11M18 19.5c0-2.4-1-4.2-2.6-5.2"/></svg>
      Participants
    </a>
    <a class="nav only-client" routerLink="/app/budgets" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M2.5 11h19M6.5 15.5h4"/></svg>
      Budgets &amp; ressources
    </a>
    <a class="nav only-client" routerLink="/app/optim" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z"/><path d="M18 17l.9 2.4L21 20l-2.1.7L18 23l-.9-2.3L15 20l2.1-.6z"/></svg>
      Optimiser <span class="tag">IA</span>
    </a>

    <div class="nav-group only-admin">Administration</div>
    <a class="nav only-admin" routerLink="/app/teams" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/><circle cx="12" cy="7" r="3.4"/></svg>
      Équipes &amp; accès
    </a>

    <div class="side-foot">
      <div class="credit"><b>1 280 crédits</b><small>Se recharge le 1er octobre</small><div class="bar"><i></i></div></div>
      <a class="nav" routerLink="/app/profile" routerLinkActive="active" style="margin-top:8px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>
        Mon profil
      </a>
    </div>
  </aside>
  `
})
export class SidebarComponent {}
