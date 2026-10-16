import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/frontoffice/landing/landing.component').then(m => m.LandingComponent), pathMatch: 'full' },
  { path: 'participant-login', loadComponent: () => import('./pages/frontoffice/auth/participant-login/participant-login.component').then(m => m.ParticipantLoginComponent) },
  { path: 'admin-login', loadComponent: () => import('./pages/backoffice/auth/admin-login/admin-login.component').then(m => m.AdminLoginComponent) },
  { path: 'participant-onboarding', loadComponent: () => import('./pages/frontoffice/participant-onboarding/participant-onboarding.component').then(m => m.ParticipantOnboardingComponent) },
  { path: 'organizer-login', loadComponent: () => import('./pages/backoffice/auth/organizer-login/organizer-login.component').then(m => m.OrganizerLoginComponent) },
  { path: 'participant-register', loadComponent: () => import('./pages/frontoffice/auth/participant-register/participant-register.component').then(m => m.ParticipantRegisterComponent) },
  { path: 'forgot', loadComponent: () => import('./pages/frontoffice/auth/forgot/forgot.component').then(m => m.ForgotComponent) },
  { path: 'logout', loadComponent: () => import('./pages/frontoffice/auth/logout/logout.component').then(m => m.LogoutComponent) },
  {
    path: 'app',
    loadComponent: () => import('./layout/main-layout/main-layout.component').then(m => m.MainLayoutComponent),
    children: [
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      { path: 'home', loadComponent: () => import('./pages/backoffice/twin-home/twin-home.component').then(m => m.TwinHomeComponent) },
      { path: 'supervision', loadComponent: () => import('./pages/backoffice/home/home.component').then(m => m.HomeComponent) },
      { path: 'optim', loadComponent: () => import('./pages/backoffice/optim/optim.component').then(m => m.OptimComponent) },
      { path: 'events', loadComponent: () => import('./pages/backoffice/events/events.component').then(m => m.EventsComponent) },
      { path: 'participants', loadComponent: () => import('./pages/backoffice/participants/participants.component').then(m => m.ParticipantsComponent) },
      { path: 'budgets', loadComponent: () => import('./pages/backoffice/budgets/budgets.component').then(m => m.BudgetsComponent) },
      { path: 'teams', loadComponent: () => import('./pages/backoffice/teams/teams.component').then(m => m.TeamsComponent) },
      { path: 'profile', loadComponent: () => import('./pages/frontoffice/participant-profile/participant-profile.component').then(m => m.ParticipantProfileComponent) }
    ]
  }
];
