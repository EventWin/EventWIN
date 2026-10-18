import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterLink],
  template: `
<div class="auth">
  <div class="auth-story">
    <div class="logo"><div class="mark"></div>Event<em>Twin</em></div>
    <div>
      <h1 class="auth-head">Testez votre événement <span>avant</span> de le payer.</h1>
      <p class="auth-sub">Participants, transport, hébergement, budget : tout devient un jumeau numérique. Vous comparez, vous ajustez, vous décidez.</p>
    </div>
    <div class="proofs">
      <div class="proof"><b>18 %</b><small>de budget récupéré en moyenne</small></div>
      <div class="proof"><b>4 200</b><small>simulations lancées ce mois-ci</small></div>
      <div class="proof"><b>±3 pts</b><small>d'écart entre prédiction et réalité</small></div>
    </div>
  </div>
  <div class="auth-panel">
    <div class="auth-card">
      <h2>Content de vous revoir</h2>
      <p>Votre séminaire de printemps attend deux arbitrages.</p>
      <div class="field"><label for="lg-mail">Adresse e-mail</label>
        <input class="in" id="lg-mail" type="email" value="lea.marchand@atlas-group.fr" autocomplete="email"></div>
      <div class="field"><label for="lg-pass">Mot de passe</label>
        <input class="in" id="lg-pass" type="password" placeholder="••••••••••" autocomplete="current-password"></div>
      <div class="inline">
        <label class="check"><input type="checkbox" checked> Rester connectée</label>
        <a class="link" routerLink="/forgot">Mot de passe oublié ?</a>
      </div>
      <button class="btn btn-ai btn-lg" routerLink="/app/optim">Ouvrir mon espace</button>
      <div class="sep">ou continuer avec</div>
      <div class="sso"><button class="btn">Google</button><button class="btn">Microsoft 365</button></div>
      <p class="alt">Pas encore de compte ? <a class="link" routerLink="/register">Créer un espace</a></p>
    </div>
  </div>
</div>
  `
})
export class LoginComponent {}
