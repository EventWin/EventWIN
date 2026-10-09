import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParticipantService } from '../../../../services/participant.service';

@Component({
  selector: 'app-organizer-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './organizer-login.component.html',
  styleUrls: ['./organizer-login.component.css']
})
export class OrganizerLoginComponent {
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
        if (response.participant.role !== 'organizer' && response.participant.role !== 'admin') {
           this.errorMessage = 'Accès refusé. Vous n\'êtes pas organisateur.';
           return;
        }
        
        localStorage.setItem('participant_id', response.participant.id);
        localStorage.setItem('participant_role', response.participant.role);
        localStorage.setItem('participant_name', response.participant.full_name || 'Organisateur');
        
        this.router.navigate(['/app/home']);
      },
      error: (err: any) => {
        this.errorMessage = 'Identifiants incorrects.';
      }
    });
  }
}
