import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-forgot',
  standalone: true,
  imports: [RouterLink],
  template: `
<div class="auth">
  <div class="auth-story">
    <div class="logo"><div class="mark"></div>Event<em>Twin</em></div>
    <div><h1 class="auth-head">Vos simulations vous <span>attendent</span>.</h1>
      <p class="auth-sub">Scénarios, budgets et listes de participants restent intacts pendant la récupération.</p></div>
    <div class="proofs"><div class="proof"><b>2 min</b><small>pour retrouver l'accès</small></div></div>
  </div>
  <div class="auth-panel">
    <div class="auth-card">
      <h2>Réinitialiser le mot de passe</h2>
      <p>Indiquez votre e-mail, nous envoyons un lien valable une heure.</p>
      <div class="field"><label for="fg-m">Adresse e-mail</label><input class="in" id="fg-m" type="email" placeholder="lea.marchand@atlas-group.fr"></div>
      <button class="btn btn-ai btn-lg">Envoyer le lien</button>
      <p class="alt"><a class="link" routerLink="/participant-login">Retour à la connexion</a></p>
    </div>
  </div>
</div>
  `
})
export class ForgotComponent {}
