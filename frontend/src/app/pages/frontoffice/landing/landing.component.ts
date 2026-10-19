import { Component } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LandingTwinComponent } from './landing-twin.component';
import { applyTheme, currentTheme } from '../../../theme';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterLink, LandingTwinComponent],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.css']
})
export class LandingComponent {
  readonly year = new Date().getFullYear();
  dark = currentTheme() === 'dark';

  // Icônes : constantes du code (jamais de contenu utilisateur), marquées sûres.
  readonly features: { title: string; text: string; icon: SafeHtml }[];

  private readonly featureDefs = [
    {
      title: 'Jumeau numérique 3D',
      text: 'Chaque événement devient une scène 3D générée à partir de vos données : salle, sièges, autocars, itinéraires et zones à risque.',
      icon: '<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M4 7.4l8 4.6 8-4.6M12 12v9.2"/>',
    },
    {
      title: 'Adéquation participants par IA',
      text: 'Gemini compare chaque profil (régime, accessibilité, rythme, intérêts) à vos événements et explique ce qui fait la différence.',
      icon: '<path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z"/><path d="M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z"/>',
    },
    {
      title: 'Budget & ressources pilotés',
      text: 'Postes de dépense, estimations, dépassements : le budget se recalcule en continu et signale ce qui reste à chiffrer.',
      icon: '<rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M2.5 11h19M6.5 15.5h4"/>',
    },
    {
      title: 'Profils participants',
      text: 'Un questionnaire d’accueil recueille contraintes et préférences, réutilisées partout : jumeau, supervision, adéquation.',
      icon: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.5A3 3 0 0 1 16 11M18 19.5c0-2.4-1-4.2-2.6-5.2"/>',
    },
  ];

  constructor(sanitizer: DomSanitizer) {
    this.features = this.featureDefs.map(f => ({ ...f, icon: sanitizer.bypassSecurityTrustHtml(f.icon) }));
  }

  readonly steps = [
    { title: 'Modéliser', text: 'Le type d’événement détermine la scène : salle et ressources pour une conférence, autocars et étapes pour un road trip.' },
    { title: 'Peupler', text: 'Les participants inscrits rejoignent la scène avec leurs préférences et contraintes déclarées.' },
    { title: 'Évaluer', text: 'Capacité, budget, adéquation et risques sont calculés et affichés directement dans la 3D.' },
    { title: 'Décider', text: 'Testez des scénarios, comparez-les, puis appliquez celui qui sert le mieux vos participants.' },
  ];

  flipTheme(): void {
    this.dark = !this.dark;
    applyTheme(this.dark ? 'dark' : 'light', true);
  }
}
