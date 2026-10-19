import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../../services/auth.service';

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
export class LogoutComponent implements OnInit {
  constructor(private authService: AuthService) {}

  ngOnInit(): void {
    // Détruit la session côté serveur (jeton + session) et purge le client.
    this.authService.logout();
  }
}
