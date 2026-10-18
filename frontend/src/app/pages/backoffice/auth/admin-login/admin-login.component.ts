import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../../services/auth.service';
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
    private authService: AuthService,
    private router: Router
  ) {}

  onLogin() {
    this.participantService.login(this.email, this.password).subscribe({
      next: (response: any) => {
        // Le contrôle réel est serveur ; on vérifie ici pour l'UI.
        if (response.participant.role !== 'admin') {
           this.errorMessage = 'Accès refusé. Droits administrateur requis.';
           return;
        }

        this.authService.saveSession(response);
        this.router.navigate(['/app/home']);
      },
      error: (err: any) => {
        this.errorMessage = this.participantService.loginErrorMessage(err);
      }
    });
  }
}
