import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParticipantService } from '../../../../services/participant.service';
import { validateEmail, validateLoginPassword } from '../../../../shared/validators';

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
  passwordVisible: boolean = false;
  loading: boolean = false;
  touched: { [k: string]: boolean } = {};

  constructor(
    private participantService: ParticipantService,
    private router: Router
  ) {}

  get emailError(): string { return validateEmail(this.email); }
  get passwordError(): string { return validateLoginPassword(this.password); }

  touch(field: string) { this.touched[field] = true; }

  showError(field: string, error: string): boolean {
    return !!error && !!this.touched[field];
  }

  get formValid(): boolean { return !this.emailError && !this.passwordError; }

  onLogin() {
    this.touched['email'] = this.touched['password'] = true;
    this.errorMessage = '';
    if (!this.formValid) return;

    this.loading = true;
    this.participantService.login(this.email.trim(), this.password).subscribe({
      next: (response: any) => {
        this.loading = false;
        // Enregistrer l'ID du participant (très simple pour la phase 0)
        localStorage.setItem('participant_id', response.participant.id);
        localStorage.setItem('participant_role', response.participant.role);
        localStorage.setItem('participant_name', response.participant.full_name || 'Participant');
        
        // Redirection logique :
        if (response.participant.role === 'admin' || response.participant.role === 'organizer') {
          this.router.navigate(['/app/home']); // Dashboard organisateur / admin
        } else {
          this.router.navigate(['/app/profile']); // Mon profil
        }
      },
      error: (err: any) => {
        this.loading = false;
        this.errorMessage = err?.status === 0
          ? 'Serveur injoignable. Réessayez dans un instant.'
          : (err?.error?.error || 'E-mail ou mot de passe incorrect.');
      }
    });
  }
}
