import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import {
  validatePassword,
  validateConfirm,
  passwordStrength,
  strengthLabel
} from '../../../../shared/validators';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
<div class="auth">
  <div class="auth-story">
    <div class="logo" style="margin-bottom: 30px; text-align: left;">
      <img src="/assets/images/logo-eventtwin.png" alt="EventTwin Logo" style="height: 100px;">
    </div>
    <div style="margin-top: 30px;">
      <h1 class="auth-head">Définissez votre <span>nouveau mot de passe</span>.</h1>
      <p class="auth-sub">Votre nouveau mot de passe est chiffré de bout en bout et sécurise l'accès à votre espace et à vos justificatifs.</p>
    </div>
    <div class="stage" style="margin-top: 30px; display: flex; justify-content: center;">
      <img src="/assets/images/mascot.svg" alt="Twin Mascot" width="280" height="280">
    </div>
  </div>

  <div class="auth-panel">
    <div class="auth-card">
      <h2>Nouveau mot de passe</h2>
      <p *ngIf="email">Compte associé : <strong>{{ email }}</strong></p>
      <p *ngIf="!email">Indiquez votre nouveau mot de passe ci-dessous.</p>

      <!-- Erreur globale -->
      <div class="form-alert" role="alert" *ngIf="errorMsg">
        {{ errorMsg }}
      </div>

      <!-- Succès -->
      <div *ngIf="successMsg" class="alert-box alert-success" style="margin-bottom: 20px; padding: 18px 20px; border-radius: 16px; background: rgba(16, 185, 129, 0.1); border: 1.5px solid rgba(16, 185, 129, 0.35); color: #059669; font-size: 14px; line-height: 1.5;">
        <div style="font-weight: 800; font-size: 16px; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
          <span>🎉</span> Mot de passe mis à jour !
        </div>
        {{ successMsg }}
        <div style="margin-top: 18px;">
          <a routerLink="/participant-login" class="btn btn-ai" style="display: block; text-align: center; text-decoration: none; padding: 14px 20px; font-weight: 700;">
            Se connecter maintenant →
          </a>
        </div>
      </div>

      <form *ngIf="!successMsg" (ngSubmit)="submitReset()">
        <!-- Champ 1 : Nouveau mot de passe -->
        <div class="field">
          <label for="new-pass">Nouveau mot de passe</label>
          <div class="in-wrap">
            <input 
              class="in" 
              id="new-pass" 
              [type]="passwordVisible ? 'text' : 'password'" 
              name="newPassword"
              [(ngModel)]="newPassword" 
              (blur)="touch('password')" 
              maxlength="64"
              [class.invalid]="showError('password', passwordError)" 
              [class.valid]="touched['password'] && !passwordError"
              placeholder="Créez votre nouveau mot de passe" 
              autocomplete="new-password"
              [disabled]="isLoading">
            <button 
              type="button" 
              class="eye" 
              (click)="passwordVisible = !passwordVisible" 
              [attr.aria-label]="passwordVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'">
              <svg *ngIf="!passwordVisible" xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <svg *ngIf="passwordVisible" xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          </div>
          <div class="field-error" *ngIf="showError('password', passwordError)">{{ passwordError }}</div>
          
          <!-- Jauge de robustesse -->
          <div class="strength" *ngIf="newPassword">
            <i *ngFor="let n of [1,2,3,4]" [class.on]="strength >= n" [ngClass]="strength >= n ? 's' + strength : ''"></i>
          </div>
          <div class="strength-label" *ngIf="newPassword">Robustesse : {{ strengthText }}</div>
          
          <!-- Règles du mot de passe -->
          <div class="pw-rules" *ngIf="newPassword || touched['password']">
            <span *ngFor="let r of passwordRules" [class.ok]="r.ok">{{ r.label }}</span>
          </div>
        </div>

        <!-- Champ 2 : Confirmer le mot de passe -->
        <div class="field">
          <label for="confirm-pass">Confirmer le mot de passe</label>
          <div class="in-wrap">
            <input 
              class="in" 
              id="confirm-pass" 
              [type]="confirmVisible ? 'text' : 'password'" 
              name="confirmPassword"
              [(ngModel)]="confirmPassword" 
              (blur)="touch('confirm')" 
              maxlength="64"
              (keyup.enter)="submitReset()"
              [class.invalid]="showError('confirm', confirmError)" 
              [class.valid]="touched['confirm'] && !confirmError"
              placeholder="Retapez votre mot de passe à l'identique" 
              autocomplete="new-password"
              [disabled]="isLoading">
            <button 
              type="button" 
              class="eye" 
              (click)="confirmVisible = !confirmVisible" 
              [attr.aria-label]="confirmVisible ? 'Masquer la confirmation' : 'Afficher la confirmation'">
              <svg *ngIf="!confirmVisible" xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <svg *ngIf="confirmVisible" xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          </div>
          <div class="field-error" *ngIf="showError('confirm', confirmError)">{{ confirmError }}</div>
        </div>

        <button 
          type="submit" 
          class="btn btn-ai btn-lg" 
          [disabled]="isLoading" 
          style="cursor: pointer; margin-top: 10px;">
          <span *ngIf="!isLoading">Enregistrer mon nouveau mot de passe</span>
          <span *ngIf="isLoading">Enregistrement en cours... ⏳</span>
        </button>
      </form>

      <p class="alt" *ngIf="!successMsg" style="margin-top: 22px;">
        <a class="link" routerLink="/participant-login">← Retour à la connexion</a>
      </p>
    </div>
  </div>
</div>
  `
})
export class ResetPasswordComponent implements OnInit {
  email: string = '';
  token: string = '';
  newPassword: string = '';
  confirmPassword: string = '';

  passwordVisible: boolean = false;
  confirmVisible: boolean = false;
  isLoading: boolean = false;
  successMsg: string = '';
  errorMsg: string = '';

  touched: { [k: string]: boolean } = {};

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.email = params['email'] || '';
      this.token = params['token'] || '';

      if (!this.token) {
        this.errorMsg = "Lien incomplet ou manquant. Veuillez refaire une demande depuis la page mot de passe oublié.";
      }
    });
  }

  // Contrôles de saisie réutilisés
  get passwordError() { return validatePassword(this.newPassword); }
  get confirmError() { return validateConfirm(this.newPassword, this.confirmPassword); }
  get strength() { return passwordStrength(this.newPassword); }
  get strengthText() { return strengthLabel(this.strength); }

  get passwordRules() {
    const p = this.newPassword;
    return [
      { label: '8 caractères min.', ok: p.length >= 8 },
      { label: 'Majuscule', ok: /[A-Z]/.test(p) },
      { label: 'Minuscule', ok: /[a-z]/.test(p) },
      { label: 'Chiffre', ok: /\d/.test(p) }
    ];
  }

  get formValid() {
    return !this.passwordError && !this.confirmError;
  }

  touch(field: string) {
    this.touched[field] = true;
  }

  showError(field: string, error: string): boolean {
    return !!error && !!this.touched[field];
  }

  submitReset(): void {
    this.touched['password'] = true;
    this.touched['confirm'] = true;

    if (!this.formValid) {
      if (this.passwordError) {
        this.errorMsg = this.passwordError;
      } else if (this.confirmError) {
        this.errorMsg = this.confirmError;
      }
      return;
    }

    if (!this.token) {
      this.errorMsg = "Lien de réinitialisation manquant ou expiré. Veuillez refaire une demande.";
      return;
    }

    this.errorMsg = '';
    this.isLoading = true;

    this.http.post<any>('http://localhost:8000/api/participants/confirm_reset_password/', {
      email: this.email,
      token: this.token,
      new_password: this.newPassword
    }).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.successMsg = res.message || "Votre mot de passe a été modifié avec succès !";
      },
      error: (err) => {
        this.isLoading = false;
        if (err.error && err.error.error) {
          this.errorMsg = err.error.error;
        } else {
          this.errorMsg = "Échec de la réinitialisation. Le lien est peut-être expiré. Veuillez refaire une demande.";
        }
      }
    });
  }
}
