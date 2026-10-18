import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ParticipantService } from '../../../services/participant.service';

@Component({
  selector: 'app-participant-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './participant-onboarding.component.html',
  styleUrls: ['./participant-onboarding.component.css']
})
export class ParticipantOnboardingComponent implements OnInit {
  participantId: string = '';
  step: number = 0; // 0 = Intro, 1-5 = Quiz, 6 = Score & Success
  totalSteps = 5;
  
  // Profiling score
  score: number = 0;
  profileType: string = '';

  // 20 Questions
  answers: any = {
    // Étape 1 : Alimentation (3)
    food: '', foodAllergy: '', foodDrink: '',
    // Étape 2 : Mobilité & Transport (4)
    access: '', transport: '', arrivalTime: '', transferNeed: '',
    // Étape 3 : Hébergement & Budget (4)
    budget: '', accomType: '', roomShare: '', invoice: '',
    // Étape 4 : Pro & Intérêts (5)
    goal: '', format: '', expLevel: '', actTech: 5, actSport: 5,
    // Étape 5 : Ambiance & Social (4)
    vibe: '', workspace: '', actSocial: 5, afterwork: ''
  };

  constructor(
    private router: Router,
    private participantService: ParticipantService
  ) {}

  ngOnInit() {
    this.participantId = localStorage.getItem('participant_id') || '';
    if (!this.participantId) {
      this.router.navigate(['/participant-login']);
    }
  }

  nextStep() {
    this.step++;
    if (this.step === 6) {
      this.calculateScoreAndSubmit();
    }
  }

  prevStep() {
    if (this.step > 0) this.step--;
  }

  calculateScoreAndSubmit() {
    this.score = (this.answers.actTech + this.answers.actSocial + this.answers.actSport) * 10 + 
                 (this.answers.afterwork === 'Oui' ? 20 : 0);
    
    if (this.answers.goal === 'Réseauter' || this.answers.actSocial >= 8) {
      this.profileType = 'Social Butterfly 🦋';
    } else if (this.answers.actTech > 7) {
      this.profileType = 'Geek / Tech Lover 💻';
    } else if (this.answers.goal === 'Apprendre') {
      this.profileType = 'Élève Studieux 📚';
    } else {
      this.profileType = 'Explorateur Équilibré 🧭';
    }

    // Sauvegarde Contraintes (IsHard = true)
    const constraints = [
      { t: 'Alimentaire', v: this.answers.food + (this.answers.foodAllergy ? ' ('+this.answers.foodAllergy+')' : '') },
      { t: 'Accessibilité', v: this.answers.access },
      { t: 'Transport', v: this.answers.transport },
      { t: 'Budget (Max)', v: this.answers.budget }
    ];
    constraints.forEach(c => {
      if (c.v && c.v !== '') {
        this.participantService.addConstraint(this.participantId, c.t, c.v, true).subscribe();
      }
    });

    // Sauvegarde Préférences
    const prefs = [
      { t: 'Boisson', v: this.answers.foodDrink },
      { t: 'Arrivée', v: this.answers.arrivalTime },
      { t: 'Hébergement', v: this.answers.accomType + (this.answers.roomShare === 'Oui' ? ' (Partagé)' : '') },
      { t: 'Facturation', v: this.answers.invoice === 'Oui' ? 'Besoins d\'une facture pro' : 'Pas de facture' },
      { t: 'Objectif', v: this.answers.goal },
      { t: 'Format', v: this.answers.format },
      { t: 'Niveau', v: this.answers.expLevel },
      { t: 'Ambiance', v: this.answers.vibe },
      { t: 'Espace', v: this.answers.workspace === 'Oui' ? 'Besoin d\'un espace calme' : 'Pas besoin d\'espace calme' },
      { t: 'Intérêt Tech', v: this.answers.actTech + '/10' },
      { t: 'Intérêt Social', v: this.answers.actSocial + '/10' },
      { t: 'Intérêt Sport', v: this.answers.actSport + '/10' },
      { t: 'Type de Profil', v: this.profileType + ` (Score: ${this.score})` }
    ];
    
    prefs.forEach(p => {
      if (p.v && p.v !== '') {
        this.participantService.addPreference(this.participantId, p.t, p.v).subscribe();
      }
    });
  }

  goToDashboard() {
    this.router.navigate(['/app/profile']);
  }
}
