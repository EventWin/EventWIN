import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParticipantService } from '../../../../services/participant.service';

/**
 * Réinitialisation de mot de passe à deux étapes :
 * 1. l'utilisateur saisit son e-mail → un jeton temporaire est envoyé ;
 * 2. il ouvre le lien reçu (`?token=...`) et choisit son nouveau mot de passe.
 * Aucun mot de passe n'est transmis par e-mail, seul un jeton à usage unique.
 */
@Component({
  selector: 'app-reset',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reset.component.html',
  styleUrls: ['./reset.component.css']
})
export class ResetComponent implements OnInit {
  token = '';
  email = '';
  password = '';
  confirm = '';
  errorMessage = '';
  infoMessage = '';
  successMessage = '';
  loading = false;
  step: 'request' | 'confirm' = 'request';

  constructor(
    private participantService: ParticipantService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Présence d'un jeton dans l'URL → on est sur l'étape de confirmation.
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    if (this.token) {
      this.step = 'confirm';
    }
  }

  onRequest(): void {
    this.errorMessage = '';
    this.infoMessage = '';
    if (!this.email) {
      this.errorMessage = 'Veuillez entrer votre adresse e-mail.';
      return;
    }
    this.loading = true;
    this.participantService.requestPasswordReset(this.email).subscribe({
      next: () => {
        this.loading = false;
        // Réponse volontairement générique (anti-énumération) : on indique
        // simplement de consulter sa boîte mail si un compte existe.
        this.infoMessage = 'Si un compte est associé à cet e-mail, un lien de réinitialisation a été envoyé.';
      },
      error: (err: any) => {
        this.loading = false;
        this.errorMessage = this.participantService.resetErrorMessage(err);
      }
    });
  }

  onConfirm(): void {
    this.errorMessage = '';
    this.successMessage = '';
    if (!this.password || this.password.length < 8) {
      this.errorMessage = 'Le mot de passe doit contenir au moins 8 caractères.';
      return;
    }
    if (this.password !== this.confirm) {
      this.errorMessage = 'Les deux mots de passe ne correspondent pas.';
      return;
    }
    this.loading = true;
    this.participantService.confirmPasswordReset(this.token, this.password).subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = 'Mot de passe mis à jour. Vous pouvez vous connecter.';
        setTimeout(() => this.router.navigate(['/login']), 1500);
      },
      error: (err: any) => {
        this.loading = false;
        this.errorMessage = this.participantService.resetErrorMessage(err);
      }
    });
  }
}
