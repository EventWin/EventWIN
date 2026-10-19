import { Component, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, TopbarComponent],
  template: `
    <div class="halo"></div>
    <div class="app">
      <app-sidebar></app-sidebar>
      
      <div class="main">
        <app-topbar></app-topbar>
        <main class="content">
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>
  `
})
export class MainLayoutComponent {
  constructor(private auth: AuthService) {}

  ngOnInit() {
    // Réaligne le rôle affiché sur la vérité serveur (anti-altération locale).
    this.auth.refresh();

    // Le thème visuel suit le rôle dès qu'il change (y compris après refresh).
    this.auth.state$.subscribe((state) => {
      document.body.setAttribute('data-role', state.role || 'client');
    });
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    document.body.classList.remove('nav-open');
  }
}
