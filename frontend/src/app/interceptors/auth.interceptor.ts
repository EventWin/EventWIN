import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Attache le jeton d'authentification à chaque requête sortante et gère le
 * rejet 401 (session expirée / jeton invalide) en déconnectant le client.
 *
 * Le serveur reste la seule autorité : ce jeton ne fait que transportérer
 * l'identité, le contrôle rôle + propriété est toujours vérifié en Django.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token;

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Token ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        // Jeton refusé : on purge la session locale pour éviter une boucle.
        auth.clear();
        router.navigate(['/login']);
      }
      return throwError(() => error);
    })
  );
};
