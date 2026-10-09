import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParticipantService } from '../../../../services/participant.service';

@Component({
  selector: 'app-participant-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './participant-login.component.html',
  styleUrls: ['./participant-login.component.css']
})
export class ParticipantLoginComponent {
  email: string = '';
  password: string = '';
  errorMessage: string = '';

  constructor(
    private participantService: ParticipantService,
    private router: Router
  ) {}

  onLogin() {
    if (!this.email || !this.password) {
      this.errorMessage = 'Veuillez entrer votre email et votre mot de passe.';
      return;
    }

    this.participantService.login(this.email, this.password).subscribe({
      next: (response: any) => {
        // Enregistrer l'ID du participant (très simple pour la phase 0)
        localStorage.setItem('participant_id', response.participant.id);
        localStorage.setItem('participant_role', response.participant.role);
        localStorage.setItem('participant_name', response.participant.full_name || 'Participant');
        
        // Redirection logique :
        if (response.participant.role === 'admin') {
          this.router.navigate(['/app/participants']); // Dashboard admin
        } else {
          this.router.navigate(['/app/profile']); // Mon profil
        }
      },
      error: (err: any) => {
        this.errorMessage = 'Aucun compte trouvé avec cet e-mail.';
      }
    });
  }
}
