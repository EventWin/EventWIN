import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
    private router: Router
  ) {}

  onRegister() {
    if (!this.email || !this.fullName || !this.password) {
      this.errorMessage = 'Veuillez remplir tous les champs (Nom, Email, Mot de passe).';
      return;
    }

    this.participantService.register(this.fullName, this.email, this.password).subscribe({
      next: (response: any) => {
        // Enregistrer l'ID pour la session
        localStorage.setItem('participant_id', response.participant.id);
        localStorage.setItem('participant_role', response.participant.role);
        
        // Redirection vers l'onboarding puisqu'il vient de s'inscrire
        this.router.navigate(['/participant-onboarding']);
      },
      error: (err: any) => {
        this.errorMessage = 'Cet e-mail est déjà utilisé ou invalide.';
      }
    });
  }
}
