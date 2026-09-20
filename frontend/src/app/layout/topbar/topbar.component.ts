import { Component, HostListener } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [RouterLink, CommonModule],
  template: `
    <header class="top">
      <button class="burger" id="burger" aria-label="Navigation" (click)="toggleNav($event)">
        <svg viewBox="0 0 24 24" width="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <div class="crumb">Atlas Group / <b id="crumb">Accueil</b></div>
      <label class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/></svg>
        <input placeholder="Chercher un événement…" aria-label="Recherche">
      </label>
      <div class="spacer"></div>
      <div class="roles" role="group" aria-label="Rôle">
        <button [attr.aria-pressed]="role === 'client'" (click)="setRole('client')">Client</button>
        <button [attr.aria-pressed]="role === 'admin'" (click)="setRole('admin')">Organisateur</button>
      </div>
      <button class="ico-btn" id="theme" aria-label="Thème" (click)="flipTheme()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>
      </button>
      <button class="me" id="me" [attr.aria-expanded]="menuOpen" (click)="toggleMenu($event)">
        <i>LM</i><span>Léa Marchand<small id="rolelab">{{ role === 'admin' ? 'Organisatrice — Atlas Group' : 'Cliente — Atlas Group' }}</small></span>
      </button>
    </header>

    <div class="menu" id="menu" *ngIf="menuOpen">
      <a routerLink="/app/profile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg> Profil et préférences</a>
      <a routerLink="/app/profile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M2.5 11h19"/></svg> Abonnement et crédits</a>
      <a href="#"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6M12 17h.01"/></svg> Aide</a>
      <hr>
      <button class="out" routerLink="/logout"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M15 17l5-5-5-5M20 12H9M11 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/></svg> Se déconnecter</button>
    </div>
  `
})
export class TopbarComponent {
  menuOpen = false;
  role = 'client';

  toggleMenu(event: Event) {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    const target = event.target as HTMLElement;
    if (!target.closest('#me')) {
      this.menuOpen = false;
    }
  }

  setRole(newRole: string) {
    this.role = newRole;
    document.body.dataset['role'] = newRole;
  }

  flipTheme() {
    const isDark = document.documentElement.dataset['theme'] === 'dark';
    document.documentElement.dataset['theme'] = isDark ? 'light' : 'dark';
  }

  toggleNav(event: Event) {
    event.stopPropagation();
    document.body.classList.toggle('nav-open');
  }
}
