import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
  <aside class="side">
    <div class="logo">
      <div class="mark"></div>
      <div>Event<em>Twin</em><div class="tiny" style="color:var(--tx-3);margin-top:-3px;font-family:Inter">Atlas Group</div></div>
    </div>

    <a class="nav" routerLink="/app/home" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>
      <span class="only-client">Mon tableau de bord</span><span class="only-admin">Supervision</span>
    </a>

    <div class="nav-group only-client">Modules</div>
    <a class="nav only-client" routerLink="/app/events" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
      Événements
    </a>
    <a class="nav only-client" routerLink="/app/participants" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.5A3 3 0 0 1 16 11M18 19.5c0-2.4-1-4.2-2.6-5.2"/></svg>
      Participants
    </a>
    <a class="nav only-client" routerLink="/app/budgets" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M2.5 11h19M6.5 15.5h4"/></svg>
      Budgets &amp; ressources
    </a>
    <a class="nav only-client" routerLink="/app/optim" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z"/><path d="M18 17l.9 2.4L21 20l-2.1.7L18 23l-.9-2.3L15 20l2.1-.6z"/></svg>
      Optimiser <span class="tag">IA</span>
    </a>

    <div class="nav-group only-admin">Administration</div>
    <a class="nav only-admin" routerLink="/app/teams" routerLinkActive="active">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/><circle cx="12" cy="7" r="3.4"/></svg>
      Équipes &amp; accès
    </a>

    <div class="side-foot">
      <!-- Cadre animé moderne & luxueux pour les Points de profil (masqué pour l'organisateur) -->
      <div class="points-card" *ngIf="!isOrganizer" (click)="goToProfile()" title="Cliquez pour voir votre profil et vos points">
        <div class="pts-aurora"></div>
        <div class="points-top">
          <div class="pts-main">
            <div class="pts-icon-wrap">
              <span class="pts-icon">🏆</span>
            </div>
            <div>
              <div class="pts-val">{{ points }} <span class="pts-unit">pts</span></div>
              <div class="pts-sub">{{ label }}</div>
            </div>
          </div>
          <span class="pts-badge">{{ levelName }}</span>
        </div>

        <div class="p-bar-wrap">
          <div class="p-bar-track">
            <div class="p-bar-fill" [style.width]="progress">
              <div class="p-bar-gleam"></div>
            </div>
          </div>
        </div>
      </div>

      <a class="nav only-client" routerLink="/app/my-pass" routerLinkActive="active" style="margin-top:8px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2m0 4v2m0 4v2"/></svg>
        Mes Pass &amp; Billets
      </a>

      <a class="nav" routerLink="/app/profile" [queryParams]="{ tab: 'identity' }" (click)="goToProfile()" routerLinkActive="active" style="margin-top:6px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>
        Mon profil
      </a>
    </div>
  </aside>
  `,
  styles: [`
    .side-foot {
      margin-top: auto;
      padding-top: 14px;
      border-top: 1px solid var(--line);
    }

    /* Cadre animé haute fidélité pour les points */
    .points-card {
      position: relative;
      padding: 15px 16px;
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(124, 92, 255, 0.12) 0%, rgba(59, 130, 246, 0.08) 50%, rgba(34, 211, 238, 0.12) 100%);
      border: 1px solid rgba(124, 92, 255, 0.28);
      box-shadow: 0 8px 24px -10px rgba(124, 92, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.6);
      overflow: hidden;
      cursor: pointer;
      transition: transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1), box-shadow 0.3s ease, border-color 0.3s ease;
    }

    .points-card:hover {
      transform: translateY(-2px);
      border-color: rgba(124, 92, 255, 0.55);
      box-shadow: 0 12px 30px -8px rgba(124, 92, 255, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.9);
    }

    /* Aura lumineuse en arrière-plan */
    .pts-aurora {
      position: absolute;
      top: -30px;
      right: -30px;
      width: 100px;
      height: 100px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(124, 92, 255, 0.45) 0%, rgba(34, 211, 238, 0.25) 50%, transparent 70%);
      filter: blur(20px);
      pointer-events: none;
      animation: auroraPulse 4s ease-in-out infinite alternate;
    }

    @keyframes auroraPulse {
      0% { transform: scale(0.9) translate(0, 0); opacity: 0.5; }
      100% { transform: scale(1.3) translate(-8px, 8px); opacity: 0.9; }
    }

    .points-top {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 12px;
    }

    .pts-main {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .pts-icon-wrap {
      width: 36px;
      height: 36px;
      border-radius: 11px;
      background: linear-gradient(135deg, rgba(124, 92, 255, 0.25), rgba(34, 211, 238, 0.2));
      border: 1px solid rgba(124, 92, 255, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 10px -2px rgba(124, 92, 255, 0.3);
      animation: iconFloat 3s ease-in-out infinite;
    }

    @keyframes iconFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-3px); }
    }

    .pts-icon {
      font-size: 18px;
      line-height: 1;
    }

    .pts-val {
      font-family: "Space Grotesk", sans-serif;
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--tx);
      line-height: 1.1;
    }

    .pts-unit {
      font-size: 12px;
      font-weight: 600;
      color: var(--violet);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .pts-sub {
      font-size: 11.5px;
      color: var(--tx-2);
      margin-top: 2px;
      font-weight: 500;
    }

    .pts-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 20px;
      background: linear-gradient(115deg, #7C5CFF, #3B82F6 60%, #22D3EE);
      color: #fff;
      box-shadow: 0 3px 10px -2px rgba(124, 92, 255, 0.6);
      white-space: nowrap;
      letter-spacing: 0.2px;
    }

    /* Barre de progression animée ultra vibrante */
    .p-bar-wrap {
      position: relative;
    }

    .p-bar-track {
      height: 8px;
      border-radius: 10px;
      background: rgba(22, 26, 46, 0.08);
      overflow: hidden;
      position: relative;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    [data-theme="dark"] .p-bar-track {
      background: rgba(255, 255, 255, 0.08);
    }

    .p-bar-fill {
      height: 100%;
      border-radius: 10px;
      background: linear-gradient(90deg, #7C5CFF 0%, #3B82F6 40%, #22D3EE 80%, #10B981 100%);
      background-size: 200% 100%;
      animation: gradientShift 3.5s ease infinite alternate;
      box-shadow: 0 0 10px rgba(124, 92, 255, 0.6), 0 0 4px rgba(34, 211, 238, 0.8);
      position: relative;
      transition: width 0.9s cubic-bezier(0.34, 1.4, 0.64, 1);
      min-width: 12px;
    }

    @keyframes gradientShift {
      0% { background-position: 0% 50%; }
      100% { background-position: 100% 50%; }
    }

    /* Lueur scintillante traversant la barre */
    .p-bar-gleam {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.8) 50%, transparent 100%);
      background-size: 50% 100%;
      background-repeat: no-repeat;
      animation: barGleam 2.8s infinite;
    }

    @keyframes barGleam {
      0% { background-position: -150% 0; }
      100% { background-position: 250% 0; }
    }
  `]
})
export class SidebarComponent implements OnInit, OnDestroy {
  points: string = '170';
  label: string = 'Score de profil';
  progress: string = '68%';
  levelName: string = 'Initié ⚡';
  get isOrganizer(): boolean {
    const role = typeof window !== 'undefined' ? localStorage.getItem('participant_role') : '';
    return role === 'organizer' || role === 'admin';
  }
  private listener: any;

  goToProfile() {
    window.dispatchEvent(new CustomEvent('switch_profile_tab', { detail: { tab: 't-id' } }));
  }

  ngOnInit() {
    this.refreshPoints();
    if (typeof window !== 'undefined') {
      this.listener = () => this.refreshPoints();
      window.addEventListener('score-updated', this.listener);
    }
  }

  ngOnDestroy() {
    if (typeof window !== 'undefined' && this.listener) {
      window.removeEventListener('score-updated', this.listener);
    }
  }

  refreshPoints() {
    const score = localStorage.getItem('participant_score');
    if (score) {
      this.points = score;
      const num = parseInt(score, 10) || 0;
      
      // Calcul du pourcentage sur un objectif de 300 pts
      const pct = Math.min(100, Math.max(8, Math.round((num / 300) * 100)));
      this.progress = `${pct}%`;

      // Détermination du niveau
      if (num >= 240) {
        this.levelName = 'Expert 💎';
      } else if (num >= 180) {
        this.levelName = 'Avancé 🚀';
      } else if (num >= 120) {
        this.levelName = 'Initié ⚡';
      } else {
        this.levelName = 'Découverte 🌱';
      }
    }
    const role = localStorage.getItem('participant_role');
    if (role === 'admin') {
      this.label = 'Score d\'activité';
    } else {
      this.label = 'Score de profil';
    }
  }
}
