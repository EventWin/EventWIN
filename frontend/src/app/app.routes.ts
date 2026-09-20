import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'login', loadComponent: () => import('./pages/auth/login/login.component').then(m => m.LoginComponent) },
  { path: 'register', loadComponent: () => import('./pages/auth/register/register.component').then(m => m.RegisterComponent) },
  { path: 'forgot', loadComponent: () => import('./pages/auth/forgot/forgot.component').then(m => m.ForgotComponent) },
  { path: 'logout', loadComponent: () => import('./pages/auth/logout/logout.component').then(m => m.LogoutComponent) },
  {
    path: 'app',
    loadComponent: () => import('./layout/main-layout/main-layout.component').then(m => m.MainLayoutComponent),
    children: [
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      { path: 'home', loadComponent: () => import('./pages/home/home.component').then(m => m.HomeComponent) },
      { path: 'optim', loadComponent: () => import('./pages/optim/optim.component').then(m => m.OptimComponent) },
      { path: 'events', loadComponent: () => import('./pages/events/events.component').then(m => m.EventsComponent) },
      { path: 'participants', loadComponent: () => import('./pages/participants/participants.component').then(m => m.ParticipantsComponent) },
      { path: 'budgets', loadComponent: () => import('./pages/budgets/budgets.component').then(m => m.BudgetsComponent) },
      { path: 'teams', loadComponent: () => import('./pages/teams/teams.component').then(m => m.TeamsComponent) },
      { path: 'profile', loadComponent: () => import('./pages/profile/profile.component').then(m => m.ProfileComponent) }
    ]
  }
];
