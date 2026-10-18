import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-logout',
  standalone: true,
  imports: [RouterLink],
  template: `
<div class="leaving">
  <div class="card">
    <div class="mark" style="margin:0 auto;width:44px;height:44px;border-radius:14px"></div>
    <h2>Vous êtes déconnectée</h2>
    <p>Vos jumeaux continuent de tourner. Les simulations en cours seront prêtes à votre retour.</p>
    <button class="btn btn-ai btn-lg" routerLink="/login">Se reconnecter</button>
    <button class="btn btn-lg mt">Donner un avis</button>
  </div>
</div>
  `
})
export class LogoutComponent {}
