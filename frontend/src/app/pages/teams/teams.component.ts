import { Component } from '@angular/core';

@Component({
  selector: 'app-teams',
  standalone: true,
  template: `
    <div class="page-head"><div><h1 class="title">Équipes &amp; accès</h1><p class="lede">Qui peut voir quoi, et qui peut engager de l'argent.</p></div>
      <div class="acts"><button class="btn btn-ai btn-sm">Inviter un membre</button></div></div>
    <div class="card">
      <div class="card-head"><h3>Membres</h3><p>6 personnes · 3 rôles</p></div>
      <div class="tw"><table>
        <thead><tr><th>Membre</th><th>Rôle</th><th>Accès</th><th>Dernière activité</th><th>État</th></tr></thead>
        <tbody>
          <tr><td><div class="who"><i>LM</i><div><b>Léa Marchand</b><small>lea.marchand&#64;atlas-group.fr</small></div></div></td>
            <td><span class="chip ai">Administratrice</span></td><td>Tous les événements</td><td class="n">à l'instant</td><td><span class="chip gain">Active</span></td></tr>
          <tr><td><div class="who"><i>FB</i><div><b>Farid Benali</b><small>f.benali&#64;atlas-group.fr</small></div></div></td>
            <td><span class="chip">Organisateur</span></td><td>2 événements</td><td class="n">hier</td><td><span class="chip gain">Actif</span></td></tr>
          <tr><td><div class="who"><i>ID</i><div><b>Inès Dartois</b><small>ines.d&#64;atlas-studio.fr</small></div></div></td>
            <td><span class="chip">Lecture seule</span></td><td>Séminaire printemps</td><td class="n">il y a 3 j</td><td><span class="chip gain">Active</span></td></tr>
          <tr><td><div class="who"><i>MT</i><div><b>Marc Teixeira</b><small>m.teixeira&#64;atlas-group.fr</small></div></div></td>
            <td><span class="chip">Organisateur</span></td><td>1 événement</td><td class="n">—</td><td><span class="chip warn">Invitation en attente</span></td></tr>
        </tbody></table></div>
    </div>
  `
})
export class TeamsComponent {}
