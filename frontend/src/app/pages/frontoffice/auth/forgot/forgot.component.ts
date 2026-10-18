import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-forgot',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
<div class="auth">
  <div class="auth-story">
    <div class="logo"><div class="mark"></div>Event<em>Twin</em></div>
    <div>
      <h1 class="auth-head">Vos simulations vous <span>attendent</span>.</h1>
      <p class="auth-sub">Scénarios, budgets et listes de participants restent intacts pendant la récupération.</p>
    </div>
    <div class="proofs">
      <div class="proof">
        <b>Instantanné</b>
        <small>par e-mail sécurisé</small>
      </div>
    </div>
  </div>

  <div class="auth-panel">
    <div class="auth-card">
      <h2>Réinitialiser le mot de passe</h2>
      <p>Indiquez votre adresse e-mail, nous vous enverrons un lien sécurisé valable une heure pour définir votre nouveau mot de passe.</p>

      <!-- Message d'erreur -->
      <div *ngIf="errorMsg" class="alert-box alert-error" style="margin-bottom: 16px; padding: 12px 16px; border-radius: 12px; background: rgba(232, 69, 95, 0.1); border: 1px solid rgba(232, 69, 95, 0.3); color: #E8455F; font-size: 13.5px;">
        ⚠️ {{ errorMsg }}
      </div>

      <!-- Message de succès -->
      <div *ngIf="successMsg" class="alert-box alert-success" style="margin-bottom: 16px; padding: 12px 16px; border-radius: 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #10B981; font-size: 13.5px; line-height: 1.5;">
        ✅ {{ successMsg }}
      </div>

      <form (ngSubmit)="submitForgot()">
        <div class="field">
          <label for="fg-m">Adresse e-mail</label>
          <input 
            class="in" 
            id="fg-m" 
            type="email" 
            name="email"
            [(ngModel)]="email" 
            (keydown.enter)="submitForgot()"
            placeholder="votre.email@exemple.com" 
            required
            [disabled]="isLoading">
        </div>

        <button type="submit" class="btn btn-ai btn-lg" [disabled]="isLoading" style="cursor: pointer;">
          <span *ngIf="!isLoading">Envoyer le lien de réinitialisation</span>
          <span *ngIf="isLoading">Envoi en cours... ⏳</span>
        </button>
      </form>

      <p class="alt" style="margin-top: 20px;">
        <a class="link" routerLink="/participant-login">← Retour à la connexion</a>
      </p>
    </div>
  </div>
</div>
  `
})
export class ForgotComponent {
  email: string = '';
  isLoading: boolean = false;
  successMsg: string = '';
  errorMsg: string = '';

  constructor(private http: HttpClient) {}

  submitForgot(): void {
    if (!this.email || !this.email.trim()) {
      this.errorMsg = "Veuillez saisir votre adresse e-mail.";
      return;
    }

    this.errorMsg = '';
    this.successMsg = '';
    this.isLoading = true;

    this.http.post<any>('http://localhost:8000/api/participants/reset_password/', {
      email: this.email.trim()
    }).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.successMsg = res.message || "Un e-mail contenant votre lien sécurisé de réinitialisation vous a été envoyé !";
      },
      error: (err) => {
        this.isLoading = false;
        if (err.error && err.error.error) {
          this.errorMsg = err.error.error;
        } else {
          this.errorMsg = "Une erreur est survenue lors de l'envoi de l'e-mail. Veuillez réessayer.";
        }
      }
    });
  }
}
