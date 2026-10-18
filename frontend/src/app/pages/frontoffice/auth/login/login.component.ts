import { Component } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../../services/auth.service';
import { ParticipantService } from '../../../../services/participant.service';

/**
 * Interface de connexion **unique** pour tous les utilisateurs d'EventTwin.
 *
 * L'utilisateur saisit seulement son e-mail et son mot de passe : il ne
 * choisit jamais son rôle. Le rôle est renvoyé par le serveur à la connexion,
 * puis l'application redirige automatiquement vers l'interface correspondante
 * (Super Administrateur, Organisateur ou Participant).
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  email = '';
  password = '';
  errorMessage = '';
  loading = false;

  constructor(
    private participantService: ParticipantService,
    private authService: AuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  onLogin(): void {
    if (!this.email || !this.password) {
      this.errorMessage = 'Veuillez entrer votre email et votre mot de passe.';
      return;
    }

    this.errorMessage = '';
    this.loading = true;

    this.authService.login(this.email.trim(), this.password).subscribe({
      next: (response: any) => {
        this.loading = false;
        // Le rôle vient du serveur : l'utilisateur ne le choisit jamais.
        this.authService.saveSession(response);

        const redirect = this.route.snapshot.queryParamMap.get('redirect');
        // Seule une route interne est acceptée (anti-redirection ouverte).
        if (redirect && redirect.startsWith('/')) {
          this.router.navigateByUrl(redirect);
        } else {
          this.router.navigateByUrl(this.authService.homeRoute());
        }
      },
      error: (err: any) => {
        this.loading = false;
        this.errorMessage = this.participantService.loginErrorMessage(err);
      }
    });
  }
}
