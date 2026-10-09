import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParticipantService } from '../../../services/participant.service';

@Component({
  selector: 'app-teams',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h1 class="title">Gestion des Organisateurs (Admin)</h1>
        <p class="lede">C'est ici que l'Administrateur crée et gère les accès des organisateurs partenaires.</p>
      </div>
    </div>
    
    <div class="grid g2">
      <!-- Formulaire de création (Vue Admin) -->
      <div class="card">
        <div class="card-head">
          <h3>Créer un compte Organisateur</h3>
          <p>Générez un accès pour un nouveau partenaire</p>
        </div>
        <div class="form-container" style="padding: 20px;">
          <div *ngIf="successMessage" class="success-msg" style="color: #10B981; margin-bottom: 15px; font-weight: bold;">
            {{ successMessage }}
          </div>
          <div *ngIf="errorMessage" class="error-msg" style="color: #E8455F; margin-bottom: 15px; font-weight: bold;">
            {{ errorMessage }}
          </div>

          <form (ngSubmit)="onCreateOrganizer()">
            <div class="field" style="margin-bottom: 15px;">
              <label>Nom de l'organisateur / Entreprise</label>
              <input class="in" type="text" [(ngModel)]="newFullName" name="fullName" placeholder="Ex: Jean Dupont" required>
            </div>
            <div class="field" style="margin-bottom: 15px;">
              <label>E-mail professionnel</label>
              <input class="in" type="email" [(ngModel)]="newEmail" name="email" placeholder="jean@entreprise.com" required>
            </div>
            <button type="submit" class="btn btn-ai" [disabled]="isLoading">
              Générer les accès & Envoyer l'invitation
            </button>
          </form>
        </div>
      </div>

      <!-- Liste des partenaires -->
      <div class="card">
        <div class="card-head">
          <h3>Partenaires existants</h3>
          <p>{{ organizers.length }} compte(s) créé(s)</p>
        </div>
        <div class="tw">
          <table>
            <thead><tr><th>Organisateur</th><th>ID / Rôle</th><th>État</th></tr></thead>
            <tbody>
              <tr *ngFor="let org of organizers">
                <td>
                  <div class="who">
                    <i>{{ org.full_name.substring(0, 2).toUpperCase() }}</i>
                    <div>
                      <b>{{ org.full_name }}</b>
                      <small>{{ org.email }}</small>
                    </div>
                  </div>
                </td>
                <td>{{ org.role }}</td>
                <td><span class="chip gain">{{ org.status }}</span></td>
              </tr>
              <tr *ngIf="organizers.length === 0">
                <td colspan="3" style="text-align: center; padding: 20px; color: #9CA3C0;">Aucun organisateur partenaire n'a encore été créé.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class TeamsComponent implements OnInit {
  organizers: any[] = [];
  
  newFullName: string = '';
  newEmail: string = '';
  
  isLoading: boolean = false;
  successMessage: string = '';
  errorMessage: string = '';

  constructor(private participantService: ParticipantService) {}

  ngOnInit() {
    this.loadOrganizers();
  }

  loadOrganizers() {
    this.participantService.getOrganizers().subscribe({
      next: (data: any) => this.organizers = data,
      error: (err: any) => console.error('Erreur chargement organisateurs', err)
    });
  }

  onCreateOrganizer() {
    if (!this.newFullName || !this.newEmail) {
      this.errorMessage = 'Veuillez remplir tous les champs.';
      return;
    }
    
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    
    this.participantService.createOrganizer(this.newFullName, this.newEmail).subscribe({
      next: (response: any) => {
        this.successMessage = "Compte créé ! L'organisateur va recevoir ses accès par e-mail.";
        this.newFullName = '';
        this.newEmail = '';
        this.isLoading = false;
        this.loadOrganizers(); // Rafraichir la liste
      },
      error: (err: any) => {
        this.errorMessage = err.error?.error || "Une erreur s'est produite lors de la création.";
        this.isLoading = false;
      }
    });
  }
}
