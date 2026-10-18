import { Component, OnDestroy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParticipantService } from '../../../../services/participant.service';
import {
  validateFullName, validateEmail, validatePassword, validateConfirm, validateOtp,
  passwordStrength, strengthLabel
} from '../../../../shared/validators';

@Component({
  selector: 'app-participant-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './participant-register.component.html'
})
export class ParticipantRegisterComponent implements OnDestroy {
  fullName: string = '';
  email: string = '';
  password: string = '';
  confirmPassword: string = '';
  otp: string = '';
  errorMessage: string = '';
  infoMessage: string = '';
  passwordVisible: boolean = false;
  confirmVisible: boolean = false;
  touched: { [k: string]: boolean } = {};

  // 1 = formulaire, 2 = saisie du code OTP
  step: number = 1;
  loading: boolean = false;
  resendCooldown: number = 0;
  private timer: any;

  constructor(
    private participantService: ParticipantService,
    private router: Router
  ) {}

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  // --- Contrôle de saisie ---
  get nameError() { return validateFullName(this.fullName); }
  get emailError() { return validateEmail(this.email); }
  get passwordError() { return validatePassword(this.password); }
  get confirmError() { return validateConfirm(this.password, this.confirmPassword); }
  get otpError() { return validateOtp(this.otp); }
  get strength() { return passwordStrength(this.password); }
  get strengthText() { return strengthLabel(this.strength); }

  get passwordRules() {
    const p = this.password;
    return [
      { label: '8 caractères min.', ok: p.length >= 8 },
      { label: 'Majuscule', ok: /[A-Z]/.test(p) },
      { label: 'Minuscule', ok: /[a-z]/.test(p) },
      { label: 'Chiffre', ok: /\d/.test(p) }
    ];
  }

  get formValid() {
    return !this.nameError && !this.emailError && !this.passwordError && !this.confirmError;
  }

  touch(field: string) { this.touched[field] = true; }

  showError(field: string, error: string): boolean {
    return !!error && !!this.touched[field];
  }

  /** Autorise uniquement les chiffres dans le champ OTP. */
  onOtpInput() {
    this.otp = this.otp.replace(/\D/g, '').slice(0, 6);
  }

  onRegister() {
    this.errorMessage = '';
    ['name', 'email', 'password', 'confirm'].forEach(f => this.touched[f] = true);
    if (!this.formValid) return;
    this.sendOtp();
  }

  sendOtp() {
    this.loading = true;
    this.errorMessage = '';
    this.participantService.sendOtp(this.email.trim(), this.fullName.trim()).subscribe({
      next: () => {
        this.loading = false;
        this.step = 2;
        this.otp = '';
        this.touched['otp'] = false;
        this.infoMessage = `Un code à 6 chiffres a été envoyé à ${this.email.trim()}.`;
        this.startCooldown();
      },
      error: (err: any) => {
        this.loading = false;
        this.errorMessage = err?.error?.error || "Impossible d'envoyer le code.";
      }
    });
  }

  confirmOtp() {
    this.errorMessage = '';
    this.touched['otp'] = true;
    if (this.otpError) return;
    this.loading = true;
    this.participantService.register(this.fullName.trim(), this.email.trim(), this.password, this.otp).subscribe({
      next: (response: any) => {
        this.loading = false;
        localStorage.setItem('participant_id', response.participant.id);
        localStorage.setItem('participant_role', response.participant.role);
        this.router.navigate(['/participant-onboarding']);
      },
      error: (err: any) => {
        this.loading = false;
        this.errorMessage = err?.error?.error || 'Inscription impossible.';
      }
    });
  }

  backToForm() {
    this.step = 1;
    this.errorMessage = '';
    this.infoMessage = '';
  }

  private startCooldown() {
    this.resendCooldown = 30;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.resendCooldown--;
      if (this.resendCooldown <= 0) clearInterval(this.timer);
    }, 1000);
  }
}
