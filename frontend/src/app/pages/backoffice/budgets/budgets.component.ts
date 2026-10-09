import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="page-head">
      <div><h1 class="title">Budgets &amp; ressources</h1><p class="lede">Suivi des engagements réels, poste par poste. Le jumeau signale un écart dès qu'un devis change.</p></div>
      <div class="acts"><button class="btn btn-sm">Ajouter une dépense</button>
        <button class="btn btn-ai btn-sm" routerLink="/app/optim">Optimiser avec l'IA</button></div>
    </div>
    <div class="grid g4">
      <div class="stat"><div class="lab">Budget voté</div><div class="val n">40 000<sup>€</sup></div><div class="foot">Séminaire printemps 2026</div></div>
      <div class="stat"><div class="lab">Engagé</div><div class="val n">27 200<sup>€</sup></div><div class="foot">68 % · 5 devis signés</div></div>
      <div class="stat"><div class="lab">Reste à engager</div><div class="val n">12 800<sup>€</sup></div><div class="foot">dont 4 200 € non chiffrés</div></div>
      <div class="stat lit"><div class="lab"><span class="dotlive"></span> Économie identifiée</div><div class="val n">3 900<sup>€</sup></div><div class="foot">sur 3 recommandations</div></div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-head"><h3>Ressources mobilisées</h3><p>humaines et matérielles</p></div>
        <div class="pref">
          <div class="pref-row"><span class="muted">Équipe terrain</span><span class="track"><i style="width: 70%"></i></span><span class="nn">7</span></div>
          <div class="pref-row"><span class="muted">Hôtes d'accueil</span><span class="track"><i style="width: 40%"></i></span><span class="nn">4</span></div>
          <div class="pref-row"><span class="muted">Techniciens</span><span class="track"><i style="width: 30%"></i></span><span class="nn">3</span></div>
          <div class="pref-row"><span class="muted">Navettes</span><span class="track"><i style="width: 50%"></i></span><span class="nn">5</span></div>
          <div class="pref-row"><span class="muted">Salles réservées</span><span class="track"><i style="width: 60%"></i></span><span class="nn">6</span></div>
        </div>
        <div class="empty mt"><h4>Aucun conflit de ressource</h4><p>Le jumeau revérifie à chaque modification.</p>
          <button class="btn btn-sm" routerLink="/app/optim">Tester un scénario</button></div></div>
      <div class="card"><div class="card-head"><h3>Écarts détectés</h3></div>
        <div class="tl">
          <div class="tl-item"><div class="tl-date">Alerte</div><div><h4>Restauration +1 400 €</h4><p>Devis révisé par Maison Berger le 17 mars.</p></div></div>
          <div class="tl-item"><div class="tl-date">Gain</div><div><h4>Transport −2 800 €</h4><p>Navettes groupées, si validées avant le 25 mars.</p></div></div>
          <div class="tl-item"><div class="tl-date">Risque</div><div><h4>Animation non chiffrée</h4><p>4 200 € estimés, aucun devis reçu.</p></div></div>
        </div></div>
    </div>
    <div class="card mt">
      <div class="card-head"><h3>Postes de dépense</h3><p>prévu, engagé et projection</p><button class="btn btn-sm">Exporter</button></div>
      <div class="tw"><table>
        <thead><tr><th>Poste</th><th>Prestataire</th><th>Prévu</th><th>Engagé</th><th>Projection</th><th>Écart</th></tr></thead>
        <tbody>
          <tr><td><b>Lieu et salles</b></td><td>Domaine de Chantilly</td><td class="n">11 000 €</td><td class="n">11 000 €</td><td class="n">11 000 €</td><td><span class="chip">0 €</span></td></tr>
          <tr><td><b>Hébergement</b></td><td>Hôtel du Parc</td><td class="n">12 000 €</td><td class="n">11 500 €</td><td class="n">11 500 €</td><td><span class="chip gain">−500 €</span></td></tr>
          <tr><td><b>Restauration</b></td><td>Maison Berger</td><td class="n">6 700 €</td><td class="n">4 700 €</td><td class="n">8 100 €</td><td><span class="chip risk">+1 400 €</span></td></tr>
          <tr><td><b>Transport</b></td><td>Cars Delmas</td><td class="n">6 100 €</td><td class="n">0 €</td><td class="n">3 300 €</td><td><span class="chip gain">−2 800 €</span></td></tr>
          <tr><td><b>Activités</b></td><td>À définir</td><td class="n">4 200 €</td><td class="n">0 €</td><td class="n">4 200 €</td><td><span class="chip warn">non chiffré</span></td></tr>
        </tbody></table></div>
    </div>
  `
})
export class BudgetsComponent {}
