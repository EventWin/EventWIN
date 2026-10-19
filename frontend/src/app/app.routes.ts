import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard, organizerGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/frontoffice/landing/landing.component').then(m => m.LandingComponent), pathMatch: 'full', canActivate: [guestGuard] },
  // Interface de connexion **unique** pour tous les rôles : l'utilisateur ne
  // choisit pas son rôle, le serveur le détermine et l'app redirige.
  { path: 'login', loadComponent: () => import('./pages/frontoffice/auth/login/login.component').then(m => m.LoginComponent) },
  // Anciennes URL conservées pour les liens déjà partagés ou mis en favori.
  { path: 'participant-login', redirectTo: 'login', pathMatch: 'full' },
  { path: 'admin-login', redirectTo: 'login', pathMatch: 'full' },
  { path: 'organizer-login', redirectTo: 'login', pathMatch: 'full' },
  { path: 'participant-onboarding', loadComponent: () => import('./pages/frontoffice/participant-onboarding/participant-onboarding.component').then(m => m.ParticipantOnboardingComponent) },
  { path: 'participant-register', loadComponent: () => import('./pages/frontoffice/auth/participant-register/participant-register.component').then(m => m.ParticipantRegisterComponent) },
  // « Mot de passe oublié » : la page /reset gère la demande de lien puis le
  // nouveau mot de passe. /reset-password est l'URL envoyée par e-mail.
  { path: 'forgot', redirectTo: 'reset', pathMatch: 'full' },
  { path: 'reset-password', redirectTo: 'reset', pathMatch: 'full' },
  // Activation d'un compte organisateur invité + réinitialisation de mot de passe :
  // deux flux à jeton, lisus dans l'URL (?token=...).
  { path: 'activate', loadComponent: () => import('./pages/frontoffice/auth/activate/activate.component').then(m => m.ActivateComponent) },
  { path: 'reset', loadComponent: () => import('./pages/frontoffice/auth/reset/reset.component').then(m => m.ResetComponent) },
  { path: 'logout', loadComponent: () => import('./pages/frontoffice/auth/logout/logout.component').then(m => m.LogoutComponent) },
  {
    path: 'app',
    loadComponent: () => import('./layout/main-layout/main-layout.component').then(m => m.MainLayoutComponent),
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      // Le jumeau numérique 3D est l'écran d'ouverture du back-office.
      { path: 'home', canActivate: [organizerGuard], loadComponent: () => import('./pages/backoffice/twin-home/twin-home.component').then(m => m.TwinHomeComponent) },
      { path: 'supervision', canActivate: [organizerGuard], loadComponent: () => import('./pages/backoffice/home/home.component').then(m => m.HomeComponent) },
      { path: 'optim', canActivate: [organizerGuard], loadComponent: () => import('./pages/backoffice/optim/optim.component').then(m => m.OptimComponent) },
      { path: 'fit', canActivate: [organizerGuard], loadComponent: () => import('./pages/backoffice/fit/fit.component').then(m => m.FitComponent) },
      { path: 'events', loadComponent: () => import('./pages/backoffice/events/events.component').then(m => m.EventsComponent) },
      { path: 'participants', canActivate: [organizerGuard], loadComponent: () => import('./pages/backoffice/participants/participants.component').then(m => m.ParticipantsComponent) },
      { path: 'budgets', canActivate: [organizerGuard], loadComponent: () => import('./pages/backoffice/budgets/budgets.component').then(m => m.BudgetsComponent) },
      { path: 'budgets/:eventId', canActivate: [organizerGuard], loadComponent: () => import('./pages/backoffice/budgets/budget-detail.component').then(m => m.BudgetDetailComponent) },
      { path: 'teams', canActivate: [adminGuard], loadComponent: () => import('./pages/backoffice/teams/teams.component').then(m => m.TeamsComponent) },
      { path: 'profile', loadComponent: () => import('./pages/frontoffice/participant-profile/participant-profile.component').then(m => m.ParticipantProfileComponent) }
    ]
  },
  { path: '**', redirectTo: '' }
];
