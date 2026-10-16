import { Component, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';

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
  ngOnInit() {
    const role = localStorage.getItem('participant_role') || 'client';
    document.body.setAttribute('data-role', role);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    document.body.classList.remove('nav-open');
  }
}
