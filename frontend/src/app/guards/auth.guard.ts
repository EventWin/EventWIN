import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Gardes de routes Angular.
 *
 * ATTENTION — c'est un confort d'interface, pas une sécurité. Le masquage
 * d'une route ou d'un bouton ne protège rien : chaque endpoint sensible est
 * protégé côté serveur (rôle + propriété). Ces gardes évitent simplement
 * d'afficher une page à un utilisateur qui n'y a pas droit.
 */

/** Redirige vers la connexion unique en mémorisant la cible. */
function toLogin(router: Router, url: string) {
  return router.createUrlTree(['/login'], { queryParams: { redirect: url } });
}

/** Utilisateur connecté requis. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated ? true : toLogin(router, state.url);
};

/** Pages publiques (accueil) : un utilisateur connecté va directement dans son espace. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated ? router.createUrlTree([auth.homeRoute()]) : true;
};

/** Espace back-office : organisateurs et super-administrateurs. */
export const organizerGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated) {
    return toLogin(router, state.url);
  }
  // Un participant connecté n'a pas accès au back-office : on le renvoie
  // dans son propre espace.
  return auth.isOrganizer ? true : router.createUrlTree([auth.homeRoute()]);
};

/**
 * Sélectionne la variante « participant » d'une route partagée (même URL,
 * interface différente selon le rôle). Sinon, la route suivante est essayée.
 */
export const participantMatch: CanMatchFn = () => inject(AuthService).isParticipant;

/** Espace réservé au super-administrateur. */
export const adminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated) {
    return toLogin(router, state.url);
  }
  return auth.isAdmin ? true : router.createUrlTree([auth.homeRoute()]);
};
