import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card">
      <div class="pro-head">
        <div class="big-av">LM</div>
        <div style="flex:1;min-width:210px">
          <h1 style="font-size:22px;font-weight:600">Léa Marchand</h1>
          <p class="muted tiny">Responsable événementiel · Atlas Group · Lyon</p>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <span class="chip ai">Administratrice</span><span class="chip">Membre depuis mars 2024</span><span class="chip gain">22 simulations</span>
          </div>
        </div>
        <div style="display:flex;gap:9px"><button class="btn btn-sm">Changer la photo</button>
          <button class="btn btn-ai btn-sm">Enregistrer</button></div>
      </div>
    </div>

    <div class="tabs mt-l" role="tablist">
      <button role="tab" [attr.aria-selected]="activeTab === 't-id'" (click)="activeTab = 't-id'" [class.active]="activeTab === 't-id'">Identité</button>
      <button role="tab" [attr.aria-selected]="activeTab === 't-disp'" (click)="activeTab = 't-disp'" [class.active]="activeTab === 't-disp'">Affichage</button>
      <button role="tab" [attr.aria-selected]="activeTab === 't-ai'" (click)="activeTab = 't-ai'" [class.active]="activeTab === 't-ai'">Comportement de l'IA</button>
      <button role="tab" [attr.aria-selected]="activeTab === 't-sec'" (click)="activeTab = 't-sec'" [class.active]="activeTab === 't-sec'">Sécurité</button>
      <button role="tab" [attr.aria-selected]="activeTab === 't-bill'" (click)="activeTab = 't-bill'" [class.active]="activeTab === 't-bill'">Abonnement</button>
    </div>

    <div class="card tabpane" *ngIf="activeTab === 't-id'">
      <div class="grid g2">
        <div class="field"><label for="p-f">Prénom</label><input class="in" id="p-f" value="Léa"></div>
        <div class="field"><label for="p-l">Nom</label><input class="in" id="p-l" value="Marchand"></div>
        <div class="field"><label for="p-m">E-mail</label><input class="in" id="p-m" value="lea.marchand@atlas-group.fr"></div>
        <div class="field"><label for="p-t">Téléphone</label><input class="in" id="p-t" value="+33 6 12 34 56 78"></div>
        <div class="field"><label for="p-o">Organisation</label><input class="in" id="p-o" value="Atlas Group"></div>
        <div class="field"><label for="p-j">Fonction</label><input class="in" id="p-j" value="Responsable événementiel"></div>
      </div>
      <div class="field" style="margin-bottom:0"><label for="p-b">Présentation</label>
        <textarea class="in" id="p-b" rows="3">J'organise des séminaires et journées d'équipe de 50 à 300 personnes. J'utilise EventTwin pour arbitrer transport et hébergement avant de signer les devis.</textarea></div>
    </div>

    <div class="card tabpane" *ngIf="activeTab === 't-disp'">
      <div class="setting"><div><b>Thème sombre</b><small>Plus confortable en soirée.</small></div>
        <button class="toggle" aria-pressed="false" data-theme-toggle></button></div>
      <div class="setting"><div><b>Animations d'interface</b><small>Transitions et compteurs animés.</small></div>
        <button class="toggle" aria-pressed="true"></button></div>
      <div class="setting"><div><b>Densité compacte</b><small>Plus de lignes visibles dans les tableaux.</small></div>
        <button class="toggle" aria-pressed="false"></button></div>
      <div class="setting"><div><b>Écran d'ouverture</b><small>Page affichée à la connexion.</small></div>
        <select class="in" style="max-width:220px"><option>Optimiser</option><option>Mon tableau de bord</option><option>Budgets</option></select></div>
      <div class="setting"><div><b>Langue</b><small>Interface et documents exportés.</small></div>
        <select class="in" style="max-width:220px"><option>Français</option><option>English</option><option>Español</option></select></div>
    </div>

    <div class="card tabpane" *ngIf="activeTab === 't-ai'">
      <div class="setting"><div><b>Recommandations automatiques</b><small>Le jumeau recalcule dès qu'un devis ou une inscription change.</small></div>
        <button class="toggle" aria-pressed="true"></button></div>
      <div class="setting"><div><b>M'alerter en cas de dépassement</b><small>Notification dès que la projection franchit le plafond.</small></div>
        <button class="toggle" aria-pressed="true"></button></div>
      <div class="setting"><div><b>Masquer les suggestions peu fiables</b><small>Cache celles dont la confiance est sous 60 %.</small></div>
        <button class="toggle" aria-pressed="false"></button></div>
      <div class="setting"><div><b>Ce que l'IA optimise par défaut</b><small>Utilisé quand vous ne précisez rien.</small></div>
        <select class="in" style="max-width:270px"><option>Satisfaction sous contrainte de budget</option><option>Coût minimal</option><option>Empreinte carbone</option></select></div>
    </div>

    <div class="card tabpane" *ngIf="activeTab === 't-sec'">
      <div class="grid g2">
        <div class="field"><label for="s-o">Mot de passe actuel</label><input class="in" id="s-o" type="password" placeholder="••••••••"></div>
        <div class="field"><label for="s-n">Nouveau mot de passe</label><input class="in" id="s-n" type="password" placeholder="12 caractères minimum"></div>
      </div>
      <div class="setting"><div><b>Double authentification</b><small>Code à usage unique via application mobile.</small></div>
        <button class="toggle" aria-pressed="true"></button></div>
      <div class="setting"><div><b>Sessions actives</b><small>Chrome sur macOS · Lyon · maintenant. Safari sur iPhone · il y a 2 jours.</small></div>
        <button class="btn btn-sm">Fermer les autres</button></div>
      <div class="setting"><div><b>Supprimer le compte</b><small>Vos jumeaux et simulations seront effacés sous 30 jours.</small></div>
        <button class="btn btn-sm btn-danger">Supprimer</button></div>
    </div>

    <div class="card tabpane" *ngIf="activeTab === 't-bill'">
      <div class="grid g3">
        <div class="stat"><div class="lab">Formule</div><div class="val" style="font-size:21px">Studio</div><div class="foot">299 € / mois</div></div>
        <div class="stat"><div class="lab">Crédits restants</div><div class="val n">1 280</div><div class="foot">sur 2 000 · recharge le 1er oct.</div></div>
        <div class="stat"><div class="lab">Événements actifs</div><div class="val n">3<sup>/10</sup></div><div class="foot">inclus dans la formule</div></div>
      </div>
      <div class="tw mt"><table>
        <thead><tr><th>Facture</th><th>Période</th><th>Montant</th><th>État</th><th></th></tr></thead>
        <tbody>
          <tr><td><b>FA-2026-0912</b></td><td class="n">Sept. 2026</td><td class="n">299,00 €</td><td><span class="chip gain">Payée</span></td><td><a class="link tiny" href="#">Télécharger</a></td></tr>
          <tr><td><b>FA-2026-0812</b></td><td class="n">Août 2026</td><td class="n">299,00 €</td><td><span class="chip gain">Payée</span></td><td><a class="link tiny" href="#">Télécharger</a></td></tr>
          <tr><td><b>FA-2026-0712</b></td><td class="n">Juil. 2026</td><td class="n">299,00 €</td><td><span class="chip gain">Payée</span></td><td><a class="link tiny" href="#">Télécharger</a></td></tr>
        </tbody></table></div>
    </div>
  `
})
export class ProfileComponent {
  activeTab = 't-id';
}
