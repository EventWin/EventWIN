import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [RouterLink],
  template: `
<div class="auth">
  <div class="auth-story">
    <div class="logo"><div class="mark"></div>Event<em>Twin</em></div>
    <div>
      <h1 class="auth-head">Votre premier jumeau tourne en <span>6 minutes</span>.</h1>
      <p class="auth-sub">Décrivez votre événement, fixez votre budget, laissez le moteur chercher la meilleure combinaison. Aucune donnée de départ n'est nécessaire.</p>
    </div>
    <div class="proofs">
      <div class="proof"><b>30 jours</b><small>d'essai, sans carte bancaire</small></div>
      <div class="proof"><b>RGPD</b><small>données hébergées à Paris</small></div>
    </div>
  </div>
  <div class="auth-panel">
    <div class="auth-card">
      <h2>Créer votre espace</h2>
      <p>Dites-nous qui vous êtes, l'interface s'adapte.</p>
      <div class="choice">
        <button [attr.aria-pressed]="role === 'client'" (click)="role = 'client'"><b>J'organise mes événements</b><small>Optimisation et budget</small></button>
        <button [attr.aria-pressed]="role === 'admin'" (click)="role = 'admin'"><b>Je pilote une agence</b><small>Portefeuille et supervision</small></button>
      </div>
      <div class="g2 grid">
        <div class="field"><label for="rg-f">Prénom</label><input class="in" id="rg-f" placeholder="Léa"></div>
        <div class="field"><label for="rg-l">Nom</label><input class="in" id="rg-l" placeholder="Marchand"></div>
      </div>
      <div class="field"><label for="rg-o">Organisation</label><input class="in" id="rg-o" placeholder="Atlas Group"></div>
      <div class="field"><label for="rg-m">E-mail professionnel</label><input class="in" id="rg-m" type="email" placeholder="lea.marchand@atlas-group.fr"></div>
      <div class="field"><label for="rg-p">Mot de passe</label>
        <input class="in" id="rg-p" type="password" placeholder="12 caractères minimum">
        <div class="strength"><i class="on"></i><i class="on"></i><i class="on"></i><i></i></div></div>
      <label class="check tiny muted" style="margin:12px 0 18px"><input type="checkbox"> J'accepte les conditions d'utilisation.</label>
      <button class="btn btn-ai btn-lg" routerLink="/app/optim">Créer mon espace</button>
      <p class="alt">Déjà inscrit ? <a class="link" routerLink="/login">Se connecter</a></p>
    </div>
  </div>
</div>
  `
})
export class RegisterComponent {
  role = 'client';
}
