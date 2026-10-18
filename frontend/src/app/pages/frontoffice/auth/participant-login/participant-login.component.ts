import { Component } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../../services/auth.service';
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
    private authService: AuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  onLogin() {
    if (!this.email || !this.password) {
      this.errorMessage = 'Veuillez entrer votre email et votre mot de passe.';
      return;
    }

    this.authService.login(this.email, this.password).subscribe({
      next: (response: any) => {
        // Stocke le jeton + le rôle (le rôle sert à l'UI ; le contrôle réel
        // reste serveur via RBAC + propriété).
        this.authService.saveSession(response);

        const redirect = this.route.snapshot.queryParamMap.get('redirect');
        const role = response.participant.role;
        if (redirect) {
          this.router.navigateByUrl(redirect);
        } else if (role === 'admin' || role === 'organizer') {
          this.router.navigate(['/app/home']);
        } else {
          this.router.navigate(['/app/profile']);
        }
      },
      error: (err: any) => {
        this.errorMessage = this.participantService.loginErrorMessage(err);
      }
    });
  }
}
