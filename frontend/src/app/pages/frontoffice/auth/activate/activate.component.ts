import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParticipantService } from '../../../../services/participant.service';

/**
 * Activation d'un compte organisateur invité.
 * Reçoit le jeton via `?token=...` (lien de l'e-mail) et laisse
 * l'utilisateur choisir son propre mot de passe. Aucun mot de passe
 * n'a jamais transité par e-mail.
 */
@Component({
  selector: 'app-activate',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './activate.component.html',
  styleUrls: ['./activate.component.css']
})
export class ActivateComponent implements OnInit {
  token = '';
  password = '';
  confirm = '';
  errorMessage = '';
  successMessage = '';
  loading = false;

  constructor(
    private participantService: ParticipantService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!this.token) {
      this.errorMessage = 'Lien d’activation invalide : jeton manquant.';
    }
  }

  onSubmit(): void {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.token) {
      this.errorMessage = 'Lien d’activation invalide : jeton manquant.';
      return;
    }
    if (!this.password || this.password.length < 8) {
      this.errorMessage = 'Le mot de passe doit contenir au moins 8 caractères.';
      return;
    }
    if (this.password !== this.confirm) {
      this.errorMessage = 'Les deux mots de passe ne correspondent pas.';
      return;
    }

    this.loading = true;
    this.participantService.acceptInvitation(this.token, this.password).subscribe({
      next: () => {
        this.loading = false;
        this.successMessage = 'Compte activé ! Vous pouvez maintenant vous connecter.';
        setTimeout(() => this.router.navigate(['/login']), 1500);
      },
      error: (err: any) => {
        this.loading = false;
        this.errorMessage = this.participantService.invitationErrorMessage(err);
      }
    });
  }
}
