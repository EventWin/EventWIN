import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParticipantService } from '../../../../services/participant.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-login.component.html',
  styleUrls: ['./admin-login.component.css']
})
export class AdminLoginComponent {
  email: string = '';
  password: string = '';
  errorMessage: string = '';

  constructor(
    private participantService: ParticipantService,
    private router: Router
  ) {}

  onLogin() {
    this.participantService.login(this.email, this.password).subscribe({
      next: (response: any) => {
        if (response.participant.role !== 'admin') {
           this.errorMessage = 'Accès refusé. Droits administrateur requis.';
           return;
        }
        
        localStorage.setItem('participant_id', response.participant.id);
        localStorage.setItem('participant_role', response.participant.role);
        localStorage.setItem('participant_name', response.participant.full_name || 'Admin');
        
        this.router.navigate(['/app/home']);
      },
      error: (err: any) => {
        this.errorMessage = this.participantService.loginErrorMessage(err);
      }
    });
  }
}
