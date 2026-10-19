import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParticipantService } from '../../../services/participant.service';
import { AuthService } from '../../../services/auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-participant-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './participant-profile.component.html'
})
export class ParticipantProfileComponent implements OnInit {
  participant: any = null;
  activeTab: string = 't-id';

  // Préférences
  newPrefType: string = 'Activités';
  newPrefValue: string = '';
  savedPreferences: any[] = [];

  // Contraintes
  newConstType: string = 'Alimentaire';
  newConstValue: string = '';
  newConstIsHard: boolean = false;
  savedConstraints: any[] = [];

  // Description des profils
  profileDescriptions: any = {
    'Social Butterfly 🦋': "Vous êtes l'âme de l'événement ! Votre but principal est d'agrandir votre réseau, d'échanger des idées et de partager des moments conviviaux.",
    'Geek / Tech Lover 💻': "La technologie et l'innovation n'ont aucun secret pour vous. Vous recherchez du contenu pointu, des nouveautés et des discussions techniques.",
    'Élève Studieux 📚': "Vous êtes ici pour apprendre et progresser. Vous privilégiez les ateliers pratiques et les masterclasses pour développer vos compétences.",
    'Explorateur Équilibré 🧭': "Polyvalent et curieux, vous aimez toucher à tout. Un peu de conférence, un peu de réseau, et beaucoup de découvertes."
  };

  getProfileType() {
    const prof = this.savedPreferences.find(p => p.type === 'Type de Profil');
    if (!prof) return null;
    
    // Le format est "Nom du Profil (Score: X)"
    const nameStr = prof.value.split(' (Score:')[0];
    const scoreStr = prof.value.match(/Score: (\d+)/)?.[1] || '';
    
    return {
      name: nameStr,
      score: scoreStr,
      desc: this.profileDescriptions[nameStr] || "Un profil unique et mystérieux prêt à découvrir l'événement."
    };
  }

  getEditablePreferences() {
    return this.savedPreferences.filter(p => p.type !== 'Type de Profil');
  }

  constructor(
    private participantService: ParticipantService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit() {
    const id = localStorage.getItem('participant_id');
    if (!id) {
      this.router.navigate(['/login']);
      return;
    }

    this.participantService.getParticipant(id).subscribe({
      next: (data) => {
        this.participant = data;
        if (data.preferences) this.savedPreferences = data.preferences;
        if (data.constraints) this.savedConstraints = data.constraints;
      },
      error: () => {
        this.router.navigate(['/login']);
      }
    });
  }

  getInitials(name: string): string {
    if (!name) return '';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  savePreference(type: string, value: string) {
    if (!value) return;
    this.participantService.addPreference(this.participant.id, type, value).subscribe({
      next: (res) => {
        this.savedPreferences.push({ id: res.id, type, value, isEditing: false });
      }
    });
  }

  updatePreference(pref: any) {
    this.participantService.updatePreference(pref.id, pref.value).subscribe({
      next: () => pref.isEditing = false
    });
  }

  saveConstraint(type: string, value: string, isHard: boolean) {
    if (!value) return;
    this.participantService.addConstraint(this.participant.id, type, value, isHard).subscribe({
      next: (res) => {
        this.savedConstraints.push({ id: res.id, type, value, isHard, isEditing: false });
      }
    });
  }

  updateConstraint(constObj: any) {
    this.participantService.updateConstraint(constObj.id, constObj.value).subscribe({
      next: () => constObj.isEditing = false
    });
  }

  deleteAccount() {
    if (confirm('Voulez-vous vraiment supprimer votre compte ? Cette action est irréversible.')) {
      this.participantService.deleteParticipant(this.participant.id).subscribe({
        next: () => {
          // Purge complète de la session locale (jeton + identité).
          this.authService.clear();
          this.router.navigate(['/login']);
        }
      });
    }
  }
}
