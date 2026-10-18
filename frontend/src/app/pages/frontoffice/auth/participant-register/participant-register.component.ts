import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../../services/auth.service';
import { ParticipantService } from '../../../../services/participant.service';

@Component({
  selector: 'app-participant-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './participant-register.component.html'
})
export class ParticipantRegisterComponent {
  fullName: string = '';
  email: string = '';
  password: string = '';
  errorMessage: string = '';
  passwordVisible: boolean = false;

  constructor(
    private participantService: ParticipantService,
    private authService: AuthService,
    private router: Router
  ) {}

  onRegister() {
    if (!this.email || !this.fullName || !this.password) {
      this.errorMessage = 'Veuillez remplir tous les champs (Nom, Email, Mot de passe).';
      return;
    }

    this.participantService.register(this.fullName, this.email, this.password).subscribe({
      next: (response: any) => {
        // Le rôle est forcé « participant » côté serveur (aucune élévation).
        this.authService.saveSession(response);
        // Redirection vers l'onboarding puisqu'il vient de s'inscrire
        this.router.navigate(['/participant-onboarding']);
      },
      error: (err: any) => {
        // On remonte le message exact du serveur (mot de passe trop faible,
        // e-mail déjà utilisé, format invalide…) plutôt qu'un texte générique.
        this.errorMessage = err?.error?.error || 'Cet e-mail est déjà utilisé ou invalide.';
      }
    });
  }
}
