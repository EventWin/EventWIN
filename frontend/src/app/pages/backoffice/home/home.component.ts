import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="page-head">
      <div>
        <h1 class="title only-client">Bonjour Léa</h1>
        <h1 class="title only-admin">Supervision du portefeuille</h1>
        <p class="lede only-client">Votre séminaire de printemps a 34 jours devant lui. Deux arbitrages vous attendent.</p>
        <p class="lede only-admin">12 événements actifs, 3 dépassements à arbitrer, 48 simulations cette semaine.</p>
      </div>
      <div class="acts">
        <button class="btn btn-sm">Exporter</button>
        <button class="btn btn-ai btn-sm" routerLink="/app/optim">Optimiser mon budget</button>
      </div>
    </div>

    <div class="only-client">
      <div class="grid g4">
        <div class="stat"><div class="lab">Jours restants</div><div class="val n">34</div><div class="foot">Séminaire · 20 avril 2026</div></div>
        <div class="stat"><div class="lab">Budget engagé</div><div class="val n">68<sup>%</sup></div><div class="foot"><span class="up">27 200 €</span> sur 40 000 €</div></div>
        <div class="stat"><div class="lab">Inscrits</div><div class="val n">64<sup>/80</sup></div><div class="foot"><span class="up">+9</span> cette semaine</div></div>
        <div class="stat lit"><div class="lab"><span class="dotlive"></span> Satisfaction prévue</div><div class="val n">82<sup>/100</sup></div><div class="foot">+6 pts possibles selon l'IA</div></div>
      </div>

      <div class="grid g2 mt">
        <div class="card">
          <div class="card-head"><h3>Budget dans le temps</h3><button class="btn btn-sm" routerLink="/app/budgets">Détail</button></div>
          <svg class="chart" viewBox="0 0 500 200" role="img" aria-label="Consommation du budget comparée au plafond">
            <defs><linearGradient id="gAI" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#22D3EE"/></linearGradient>
            <linearGradient id="fAI" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7C5CFF" stop-opacity=".28"/><stop offset="1" stop-color="#22D3EE" stop-opacity="0"/></linearGradient></defs>
            <g class="gridline"><line x1="34" y1="30" x2="490" y2="30"/><line x1="34" y1="72" x2="490" y2="72"/><line x1="34" y1="114" x2="490" y2="114"/><line x1="34" y1="156" x2="490" y2="156"/></g>
            <text class="axis" x="2" y="34">40k</text><text class="axis" x="2" y="76">30k</text><text class="axis" x="2" y="118">20k</text><text class="axis" x="2" y="160">10k</text>
            <line x1="34" y1="30" x2="490" y2="30" stroke="#E8455F" stroke-dasharray="6 5" stroke-width="1.3" opacity=".8"/>
            <text class="axis" x="416" y="24" fill="#E8455F">plafond voté</text>
            <path d="M34 168 L92 160 L150 150 L208 138 L266 124 L324 110 L382 96 L440 84 L490 76 L490 180 L34 180 Z" fill="url(#fAI)"/>
            <path d="M34 168 L92 160 L150 150 L208 138 L266 124 L324 110 L382 96 L440 84 L490 76" fill="none" stroke="url(#gAI)" stroke-width="2.4" stroke-linecap="round"/>
            <circle cx="490" cy="76" r="4.5" fill="#22D3EE"/>
            <text class="axis" x="40" y="196">janv.</text><text class="axis" x="250" y="196">févr.</text><text class="axis" x="450" y="196">mars</text>
          </svg>
          <div class="legend"><span><b style="background:var(--ai)"></b> Projection du jumeau</span><span><b style="background:#E8455F"></b> Plafond</span></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Ce qui bouge</h3></div>
          <div class="tl">
            <div class="tl-item"><div class="tl-date">Aujourd'hui</div><div><h4>Le traiteur a révisé son devis</h4><p>+1 400 € sur la restauration. Trois scénarios recalculés.</p></div></div>
            <div class="tl-item"><div class="tl-date">Hier</div><div><h4>9 nouvelles inscriptions</h4><p>Dont 6 depuis Lyon — le poste transport se tend.</p></div></div>
            <div class="tl-item"><div class="tl-date">12 mars</div><div><h4>Navettes groupées simulées</h4><p>2 800 € économisés, satisfaction maintenue.</p></div></div>
            <div class="tl-item"><div class="tl-date">08 mars</div><div><h4>Domaine confirmé</h4><p>Acompte de 6 000 € versé, capacité 100 places.</p></div></div>
          </div>
        </div>
      </div>
    </div>

    <div class="only-admin">
      <div class="grid g4">
        <div class="stat"><div class="lab">Événements actifs</div><div class="val n">12</div><div class="foot"><span class="up">+3</span> ce trimestre</div></div>
        <div class="stat"><div class="lab">Volume piloté</div><div class="val n">1,42<sup>M€</sup></div><div class="foot">18 organisations</div></div>
        <div class="stat"><div class="lab">En dépassement</div><div class="val n">3</div><div class="foot"><span class="down">à arbitrer</span> avant vendredi</div></div>
        <div class="stat lit"><div class="lab"><span class="dotlive"></span> Économies validées</div><div class="val n">94 300<sup>€</sup></div><div class="foot">sur 48 simulations</div></div>
      </div>
      <div class="card mt">
        <div class="card-head"><h3>Portefeuille</h3><p>trié par urgence</p><button class="btn btn-sm">Filtrer</button></div>
        <div class="tw"><table>
          <thead><tr><th>Événement</th><th>Client</th><th>Date</th><th>Budget</th><th>Satisfaction</th><th>État</th></tr></thead>
          <tbody>
            <tr><td><b>Séminaire printemps</b></td><td>Atlas Group</td><td class="n">20 avr. 2026</td><td class="n">27,2k / 40k</td><td><span class="chip ai">82 / 100</span></td><td><span class="chip gain">Dans les clous</span></td></tr>
            <tr><td><b>Lancement Helios</b></td><td>Vertex</td><td class="n">02 oct. 2026</td><td class="n">68,4k / 62k</td><td><span class="chip">74 / 100</span></td><td><span class="chip risk">Dépassement 10 %</span></td></tr>
            <tr><td><b>Convention annuelle</b></td><td>Nova Events</td><td class="n">14 nov. 2026</td><td class="n">81,6k / 120k</td><td><span class="chip ai">87 / 100</span></td><td><span class="chip gain">Optimisé</span></td></tr>
            <tr><td><b>Salon recrutement</b></td><td>Campus Lumière</td><td class="n">08 déc. 2026</td><td class="n">12,1k / 48k</td><td><span class="chip">62 / 100</span></td><td><span class="chip warn">Peu de données</span></td></tr>
          </tbody></table></div>
      </div>
    </div>
  `
})
export class HomeComponent {}
