import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Garde d'authentification : limite l'accès aux espaces protégés.
 *
 * ATTENTION — c'est un confort d'interface, pas une sécurité. Le masquage
 * d'une route ou d'un bouton ne protège rien : chaque endpoint sensible est
 * protégé côté serveur (rôle + propriété). Ces gardes évitent simplement
 * d'afficher une page à un utilisateur non connecté.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated) {
    return true;
  }
  return router.createUrlTree(['/participant-login'], {
    queryParams: { redirect: state.url },
  });
};

/** Garde réservée aux organisateurs et administrateurs (espace back-office). */
export const organizerGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated) {
    return router.createUrlTree(['/participant-login'], {
      queryParams: { redirect: state.url },
    });
  }
  if (auth.isOrganizer) {
    return true;
  }
  // Un participant connecté n'a pas accès au back-office.
  return router.createUrlTree(['/app/profile']);
};

/** Garde réservée au super-administrateur. */
export const adminGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated) {
    return router.createUrlTree(['/admin-login'], {
      queryParams: { redirect: state.url },
    });
  }
  return auth.isAdmin ? true : router.createUrlTree(['/app/home']);
};
