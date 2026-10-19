import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subscription, filter } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { EventContextService } from '../../twin/event-context.service';
import { applyTheme, currentTheme } from '../../theme';

interface SearchEvent { id: string; name: string; location: string; start_date: string | null; status: string; }

/** Libellé du fil d'Ariane selon le premier segment après /app/. */
const CRUMBS: Record<string, string> = {
  home: 'Jumeau numérique 3D',
  supervision: 'Supervision',
  events: 'Événements',
  participants: 'Participants',
  budgets: 'Budgets & ressources',
  optim: 'Optimiser',
  fit: 'Adéquation IA',
  sponsors: 'Sponsors',
  teams: 'Équipes & accès',
  profile: 'Mon profil',
};

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule],
  template: `
    <header class="top">
      <button class="burger" id="burger" aria-label="Navigation" (click)="toggleNav($event)">
        <svg viewBox="0 0 24 24" width="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <div class="crumb">EventTwin <span class="crumb-sep">/</span> <b>{{ crumb }}</b></div>
      <a class="ev-chip" *ngIf="context.selected$ | async as ev" routerLink="/app/home" [queryParams]="{ event: ev.id }" title="Événement sélectionné — ouvrir son jumeau">
        <i></i><span>{{ ev.name }}</span>
      </a>

      <div class="search" id="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/></svg>
        <input #searchInput [(ngModel)]="query" (focus)="openSearch()" (keydown)="onSearchKey($event)"
               placeholder="Chercher un événement…" aria-label="Chercher un événement" autocomplete="off"
               role="combobox" [attr.aria-expanded]="searchOpen" aria-controls="search-results">
        <kbd *ngIf="!query">/</kbd>
        <div class="search-pop" id="search-results" role="listbox" *ngIf="searchOpen">
          <div class="search-empty" *ngIf="searchLoading">Chargement…</div>
          <ng-container *ngIf="!searchLoading">
            <button *ngFor="let e of results; let i = index" type="button" role="option" class="search-item"
                    [class.on]="i === activeIndex" [attr.aria-selected]="i === activeIndex"
                    (mouseenter)="activeIndex = i" (mousedown)="$event.preventDefault()" (click)="pick(e)">
              <i></i>
              <span><b>{{ e.name }}</b><small>{{ e.location || 'Lieu à définir' }}<ng-container *ngIf="e.start_date"> · {{ e.start_date | date:'d MMM yyyy' }}</ng-container></small></span>
            </button>
            <div class="search-empty" *ngIf="!results.length">{{ query ? 'Aucun événement ne correspond.' : 'Aucun événement disponible.' }}</div>
          </ng-container>
        </div>
      </div>

      <div class="spacer"></div>
      <button class="ico-btn" id="theme" [attr.aria-label]="dark ? 'Passer en thème clair' : 'Passer en thème sombre'" [title]="dark ? 'Thème clair' : 'Thème sombre'" (click)="flipTheme()">
        <svg *ngIf="!dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>
        <svg *ngIf="dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      </button>
      <button class="me" id="me" [attr.aria-expanded]="menuOpen" (click)="toggleMenu($event)">
        <i>{{ initials }}</i><span>{{ fullName }}<small>{{ role }}</small></span>
      </button>
    </header>

    <div class="menu" id="menu" *ngIf="menuOpen">
      <div class="menu-who"><b>{{ fullName }}</b><small>{{ email }}</small></div>
      <hr>
      <a routerLink="/app/profile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg> Mon profil</a>
      <hr>
      <button class="out" (click)="logout()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M15 17l5-5-5-5M20 12H9M11 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/></svg> Se déconnecter</button>
    </div>
  `
})
export class TopbarComponent implements OnInit, OnDestroy {
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  menuOpen = false;
  role = 'Participant';
  fullName = '';
  email = '';
  initials = '';
  crumb = 'Accueil';
  dark = currentTheme() === 'dark';

  query = '';
  searchOpen = false;
  searchLoading = false;
  activeIndex = 0;
  private events: SearchEvent[] | null = null;
  private subs: Subscription[] = [];

  constructor(
    private authService: AuthService,
    private router: Router,
    private http: HttpClient,
    readonly context: EventContextService
  ) {}

  ngOnInit() {
    // Un super-administrateur n'a **pas** de profil Participant : on se fie au
    // rôle (et non à l'identifiant de profil) pour valider la session.
    if (!this.authService.isAuthenticated) {
      this.logout();
      return;
    }
    // L'identité est réalignée par /me après chargement : on suit l'état.
    this.subs.push(this.authService.state$.subscribe(state => {
      this.fullName = state.fullName || 'Utilisateur';
      this.email = state.email || '';
      this.role = state.role === 'admin' ? 'Administrateur' : (state.role === 'organizer' ? 'Organisateur' : 'Participant');
      this.initials = this.fullName.replace(/@.*/, '').split(/[\s.]+/).filter(Boolean).slice(0, 2)
        .map(n => n[0]).join('').toUpperCase() || 'U';
    }));
    this.updateCrumb(this.router.url);
    this.subs.push(this.router.events.pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(e => {
        this.updateCrumb((e as NavigationEnd).urlAfterRedirects);
        document.body.classList.remove('nav-open');
      }));
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  logout() {
    // Le serveur détruit la session + le jeton ; on purge le client.
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  // --- Recherche d'événements ----------------------------------------------------

  get results(): SearchEvent[] {
    const q = this.normalize(this.query);
    return (this.events ?? [])
      .filter(e => !q || this.normalize(`${e.name} ${e.location}`).includes(q))
      .slice(0, 7);
  }

  openSearch() {
    this.searchOpen = true;
    this.activeIndex = 0;
    if (this.events === null && !this.searchLoading) {
      this.searchLoading = true;
      this.http.get<SearchEvent[]>('/api/events/').subscribe({
        next: (events) => {
          this.events = events.filter(e => e.status !== 'cancelled')
            .sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999'));
          this.searchLoading = false;
        },
        error: () => { this.events = []; this.searchLoading = false; },
      });
    }
  }

  onSearchKey(event: KeyboardEvent) {
    const count = this.results.length;
    if (event.key === 'ArrowDown') { event.preventDefault(); this.activeIndex = (this.activeIndex + 1) % Math.max(count, 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); this.activeIndex = (this.activeIndex - 1 + count) % Math.max(count, 1); }
    else if (event.key === 'Enter' && count) { event.preventDefault(); this.pick(this.results[this.activeIndex] ?? this.results[0]); }
    else if (event.key === 'Escape') { this.closeSearch(); this.searchInput?.nativeElement.blur(); }
    else { this.activeIndex = 0; this.searchOpen = true; }
  }

  pick(e: SearchEvent) {
    this.closeSearch();
    this.query = '';
    this.searchInput?.nativeElement.blur();
    if (this.authService.isOrganizer) {
      this.context.select(e.id, e.name);
      this.router.navigate(['/app/home'], { queryParams: { event: e.id } });
    } else {
      this.router.navigate(['/app/events']);
    }
  }

  private closeSearch() {
    this.searchOpen = false;
  }

  /** « / » ou Ctrl+K : focus sur la recherche (hors saisie en cours). */
  @HostListener('document:keydown', ['$event'])
  onShortcut(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName) || target?.isContentEditable;
    if ((event.key === '/' && !typing) || (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      this.searchInput?.nativeElement.focus();
    }
  }

  // --- Menu, thème, navigation -----------------------------------------------------

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
    if (!target.closest('#search')) {
      this.closeSearch();
    }
  }

  flipTheme() {
    this.dark = !this.dark;
    applyTheme(this.dark ? 'dark' : 'light', true);
  }

  toggleNav(event: Event) {
    event.stopPropagation();
    document.body.classList.toggle('nav-open');
  }

  private updateCrumb(url: string) {
    const segment = url.split('?')[0].split('/')[2] || 'home';
    this.crumb = CRUMBS[segment] ?? 'Accueil';
  }

  private normalize(value: string): string {
    return (value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
}
