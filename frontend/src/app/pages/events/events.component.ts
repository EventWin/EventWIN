import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-events',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="page-head">
      <div><h1 class="title">Événements</h1><p class="lede">Chaque événement possède son jumeau. Créez-le, décrivez ses contraintes, puis simulez.</p></div>
      <div class="acts"><button class="btn btn-sm">Importer une édition passée</button>
        <button class="btn btn-ai btn-sm" routerLink="/app/optim">Créer un événement</button></div>
    </div>
    <div class="grid g4">
      <div class="stat"><div class="lab">En préparation</div><div class="val n">3</div><div class="foot">dont 1 à moins de 40 jours</div></div>
      <div class="stat"><div class="lab">Organisations</div><div class="val n">4</div><div class="foot">rattachées à votre compte</div></div>
      <div class="stat"><div class="lab">Éditions archivées</div><div class="val n">8</div><div class="foot">alimentent le modèle</div></div>
      <div class="stat lit"><div class="lab"><span class="dotlive"></span> Jumeaux prêts</div><div class="val n">3<sup>/3</sup></div><div class="foot">Simulation disponible</div></div>
    </div>
    <div class="card mt">
      <div class="card-head"><h3>Vos événements</h3><p>cliquez pour ouvrir le jumeau</p><button class="btn btn-sm">Filtrer</button></div>
      <div class="tw"><table>
        <thead><tr><th>Événement</th><th>Date et lieu</th><th>Participants</th><th>Budget</th><th>Avancement</th><th>Jumeau</th></tr></thead>
        <tbody>
          <tr><td><div class="who"><i>SP</i><div><b>Séminaire printemps</b><small>Résidentiel · 2 jours</small></div></div></td>
            <td class="n">20 avr. 2026<br><span class="tiny muted">Domaine de Chantilly</span></td><td class="n">64 / 80</td>
            <td class="n">27,2k / 40k</td><td><span class="chip gain">68 %</span></td><td><span class="chip ai">Actif</span></td></tr>
          <tr><td><div class="who"><i>JP</i><div><b>Journée portes ouvertes</b><small>Public externe</small></div></div></td>
            <td class="n">12 juin 2026<br><span class="tiny muted">Siège, Lyon</span></td><td class="n">210 / 300</td>
            <td class="n">18,4k / 25k</td><td><span class="chip warn">34 %</span></td><td><span class="chip ai">Actif</span></td></tr>
          <tr><td><div class="who"><i>SN</i><div><b>Soirée de fin d'année</b><small>Interne</small></div></div></td>
            <td class="n">18 déc. 2026<br><span class="tiny muted">À définir</span></td><td class="n">0 / 150</td>
            <td class="n">— / 30k</td><td><span class="chip">Brouillon</span></td><td><span class="chip">En apprentissage</span></td></tr>
        </tbody></table></div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-head"><h3>Organisations</h3><button class="btn btn-sm">Ajouter</button></div>
        <div class="tl">
          <div class="tl-item"><div class="tl-date">3 év.</div><div><h4>Atlas Group</h4><p>Siège Lyon · contact : Léa Marchand</p></div></div>
          <div class="tl-item"><div class="tl-date">2 év.</div><div><h4>Atlas Studio</h4><p>Filiale design · Paris</p></div></div>
          <div class="tl-item"><div class="tl-date">1 év.</div><div><h4>Fondation Atlas</h4><p>Mécénat · Lyon</p></div></div>
        </div></div>
      <div class="card"><div class="card-head"><h3>Prochaines échéances</h3><p>ce que le jumeau attend</p></div>
        <div class="tl">
          <div class="tl-item"><div class="tl-date">25 mars</div><div><h4>Confirmer les points de collecte</h4><p>Bloque l'optimisation du transport.</p></div></div>
          <div class="tl-item"><div class="tl-date">30 mars</div><div><h4>Verser l'acompte traiteur</h4><p>5 400 € · Maison Berger</p></div></div>
          <div class="tl-item"><div class="tl-date">05 avr.</div><div><h4>Clôturer les inscriptions</h4><p>80 places, 16 encore libres.</p></div></div>
        </div></div>
    </div>
  `
})
export class EventsComponent {}
