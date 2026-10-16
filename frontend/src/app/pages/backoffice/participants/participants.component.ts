import { Component } from '@angular/core';

@Component({
  selector: 'app-participants',
  standalone: true,
  template: `
    <div class="page-head">
      <div><h1 class="title">Participants</h1><p class="lede">Les préférences déclarées alimentent directement le score de satisfaction. Plus elles sont renseignées, plus le jumeau voit juste.</p></div>
      <div class="acts"><button class="btn btn-sm">Importer un CSV</button>
        <button class="btn btn-ai btn-sm">Relancer le questionnaire</button></div>
    </div>
    <div class="grid g4">
      <div class="stat"><div class="lab">Inscrits confirmés</div><div class="val n">64</div><div class="foot"><span class="up">+9</span> cette semaine</div></div>
      <div class="stat"><div class="lab">Préférences renseignées</div><div class="val n">71<sup>%</sup></div><div class="foot">45 questionnaires complétés</div></div>
      <div class="stat"><div class="lab">Régimes particuliers</div><div class="val n">11</div><div class="foot">dont 3 allergies sévères</div></div>
      <div class="stat lit"><div class="lab"><span class="dotlive"></span> Segments détectés</div><div class="val n">4</div><div class="foot">regroupement automatique</div></div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-head"><h3>Ce que les participants veulent</h3><p>sur 45 réponses</p></div>
        <div class="pref">
          <div class="pref-row"><span class="muted">Réseautage</span><span class="track"><i style="width: 88%"></i></span><span class="nn">88%</span></div>
          <div class="pref-row"><span class="muted">Ateliers courts</span><span class="track"><i style="width: 76%"></i></span><span class="nn">76%</span></div>
          <div class="pref-row"><span class="muted">Restauration</span><span class="track"><i style="width: 69%"></i></span><span class="nn">69%</span></div>
          <div class="pref-row"><span class="muted">Confort hôtel</span><span class="track"><i style="width: 64%"></i></span><span class="nn">64%</span></div>
          <div class="pref-row"><span class="muted">Trajet court</span><span class="track"><i style="width: 57%"></i></span><span class="nn">57%</span></div>
          <div class="pref-row"><span class="muted">Plénière longue</span><span class="track"><i style="width: 23%"></i></span><span class="nn">23%</span></div>
        </div>
        <p class="tiny muted mt">Ces réponses expliquent pourquoi l'IA propose de raccourcir les temps assis.</p></div>
      <div class="card"><div class="card-head"><h3>Segments identifiés</h3></div>
        <div class="tl">
          <div class="tl-item"><div class="tl-date n">24</div><div><h4>Les connecteurs</h4><p>Viennent pour rencontrer. Sensibles au format debout.</p></div></div>
          <div class="tl-item"><div class="tl-date n">18</div><div><h4>Les studieux</h4><p>Priorisent le contenu, tolèrent mal les journées longues.</p></div></div>
          <div class="tl-item"><div class="tl-date n">14</div><div><h4>Les navetteurs</h4><p>À plus de 200 km. Leur venue dépend du transport.</p></div></div>
          <div class="tl-item"><div class="tl-date n">8</div><div><h4>Les décideurs</h4><p>Présence partielle, à placer sur les temps forts.</p></div></div>
        </div></div>
    </div>
    <div class="card mt">
      <div class="card-head"><h3>Liste des participants</h3><p>64 inscrits</p><button class="btn btn-sm">Exporter</button></div>
      <div class="tw"><table>
        <thead><tr><th>Participant</th><th>Équipe</th><th>Segment</th><th>Trajet</th><th>Contraintes</th><th>État</th></tr></thead>
        <tbody>
          <tr><td><div class="who"><i>AM</i><div><b>Amina Meziane</b><small>Direction</small></div></div></td><td>Comité</td>
            <td><span class="chip">Décideurs</span></td><td class="n">Lille · 225 km</td><td>Sans gluten</td><td><span class="chip gain">Confirmée</span></td></tr>
          <tr><td><div class="who"><i>TL</i><div><b>Thomas Lefèvre</b><small>Ingénieur</small></div></div></td><td>Produit</td>
            <td><span class="chip">Studieux</span></td><td class="n">Grenoble · 110 km</td><td>Navette demandée</td><td><span class="chip gain">Confirmé</span></td></tr>
          <tr><td><div class="who"><i>SK</i><div><b>Sofia Kovač</b><small>Marque</small></div></div></td><td>Marketing</td>
            <td><span class="chip">Connecteurs</span></td><td class="n">Lyon · 6 km</td><td>—</td><td><span class="chip gain">Confirmée</span></td></tr>
          <tr><td><div class="who"><i>NB</i><div><b>Nadia Brunet</b><small>Consultante</small></div></div></td><td>Externe</td>
            <td><span class="chip">Navetteurs</span></td><td class="n">Rennes · 350 km</td><td>Aucun transport prévu</td><td><span class="chip risk">À traiter</span></td></tr>
          <tr><td><div class="who"><i>ED</i><div><b>Éric Daoudi</b><small>Technique</small></div></div></td><td>IT</td>
            <td><span class="chip">Studieux</span></td><td class="n">Lyon · 12 km</td><td>Accessibilité PMR</td><td><span class="chip gain">Confirmé</span></td></tr>
        </tbody></table></div>
    </div>
  `
})
export class ParticipantsComponent {}
