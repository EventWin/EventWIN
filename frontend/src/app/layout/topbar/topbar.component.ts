import { Component, HostListener, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ParticipantService } from '../../services/participant.service';
import { EventContextService } from '../../twin/event-context.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [RouterLink, CommonModule],
  template: `
    <header class="top">
      <button class="burger" id="burger" aria-label="Navigation" (click)="toggleNav($event)">
        <svg viewBox="0 0 24 24" width="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <div class="crumb">EventTwin / <b id="crumb">Accueil</b></div>
      <a class="ev-chip" *ngIf="context.selected$ | async as ev" routerLink="/app/home" [queryParams]="{ event: ev.id }" title="Événement sélectionné — ouvrir son jumeau">
        <i></i><span>{{ ev.name }}</span>
      </a>
      <label class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/></svg>
        <input placeholder="Chercher un événement…" aria-label="Recherche">
      </label>
      <div class="spacer"></div>
      <button class="ico-btn" id="theme" aria-label="Thème" (click)="flipTheme()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>
      </button>
      <button class="me" id="me" [attr.aria-expanded]="menuOpen" (click)="toggleMenu($event)">
        <img *ngIf="avatarUrl" [src]="avatarUrl" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;">
        <i *ngIf="!avatarUrl">{{ initials }}</i>
        <span>{{ fullName }}<small id="rolelab">{{ role }}</small></span>
      </button>
    </header>

    <div class="menu" id="menu" *ngIf="menuOpen">
      <a routerLink="/app/profile" [queryParams]="{ tab: 'identity' }" (click)="goToProfile()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg> Mon Profil</a>
      <hr>
      <button class="out" (click)="logout()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M15 17l5-5-5-5M20 12H9M11 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/></svg> Se déconnecter</button>
    </div>
  `
})
export class TopbarComponent implements OnInit {
  menuOpen = false;
  role = 'Participant';
  fullName = 'Chargement...';
  initials = '';
  avatarUrl: string | null = null;

  constructor(
    private participantService: ParticipantService,
    private router: Router,
    readonly context: EventContextService
  ) {}

  ngOnInit() {
    const id = localStorage.getItem('participant_id');
    const role = localStorage.getItem('participant_role');
    const name = localStorage.getItem('participant_name') || 'Utilisateur';

    if (id && role) {
      this.fullName = name;
      this.role = role === 'admin' ? 'Administrateur' : (role === 'organizer' ? 'Organisateur' : 'Participant');
      this.initials = this.fullName.split(' ').filter(Boolean).map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'U';
      this.loadAvatar(id);

      this.participantService.getParticipant(id).subscribe({
        next: (p) => {
          if (p?.full_name) {
            this.fullName = p.full_name;
            localStorage.setItem('participant_name', p.full_name);
            this.initials = this.fullName.split(' ').filter(Boolean).map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'U';
          }
          if (p?.photo) {
            this.avatarUrl = p.photo;
          }
        }
      });

      window.addEventListener('profile_name_updated', (e: any) => {
        if (e.detail?.name) {
          this.fullName = e.detail.name;
          this.initials = this.fullName.split(' ').filter(Boolean).map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'U';
        }
      });

      window.addEventListener('profile_photo_updated', (e: any) => {
        this.avatarUrl = e.detail?.photo || null;
      });
    } else {
      this.logout();
    }
  }

  private loadAvatar(id: string) {
    this.avatarUrl = localStorage.getItem('participant_avatar_' + id) || localStorage.getItem('participant_avatar_current') || null;
  }

  goToProfile() {
    this.menuOpen = false;
    window.dispatchEvent(new CustomEvent('switch_profile_tab', { detail: { tab: 't-id' } }));
  }

  logout() {
    localStorage.removeItem('participant_id');
    localStorage.removeItem('participant_role');
    localStorage.removeItem('participant_name');
    this.router.navigate(['/participant-login']);
  }

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

  flipTheme() {
    const isDark = document.documentElement.dataset['theme'] === 'dark';
    document.documentElement.dataset['theme'] = isDark ? 'light' : 'dark';
  }

  toggleNav(event: Event) {
    event.stopPropagation();
    document.body.classList.toggle('nav-open');
  }
}
