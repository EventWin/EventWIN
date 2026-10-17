import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/** Autorise l'accès aux pages sponsors aux organisateurs et aux admins seulement. */
export const organizerGuard: CanActivateFn = () => {
  const role = localStorage.getItem('participant_role');
  if (role === 'organizer' || role === 'admin') {
    return true;
  }
  return inject(Router).createUrlTree(['/organizer-login']);
};
