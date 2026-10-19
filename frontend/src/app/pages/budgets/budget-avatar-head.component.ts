import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  Input,
  NgZone,
  OnDestroy,
  ViewChild
} from '@angular/core';
import { TalkingHead } from './talkinghead/talkinghead.mjs';

/**
 * Avatar 3D de l'assistant budgétaire.
 *
 * Affiche un « talking head » Ready Player Me rendu par la bibliothèque
 * **TalkingHead** (MIT © Mika Suominen), intégrée (copiée) dans
 * `pages/budgets/talkinghead/`. Remplace l'ancien avatar SVG dessiné à la main :
 * la bibliothèque gère la scène Three.js, la caméra, la lumière et l'animation
 * d'inactivité.
 *
 * Ce composant reste **purement décoratif** :
 *  - aucun son n'est joué (`avatarMute`), aucune synthèse vocale n'est requise
 *    (`lipsyncModules: []`) — l'avatar ne fait que « vivre » la page ;
 *  - la logique métier (validation, estimation, budget) reste dans la page.
 *
 * Robustesse :
 *  - la boucle d'animation de la bibliothèque tourne **hors de la zone
 *    Angular** (sinon chaque image déclencherait une détection de changement) ;
 *  - si le modèle est injoignable, on retombe sur l'avatar SVG d'origine ;
 *  - `prefers-reduced-motion` fige l'avatar (aucune animation).
 */
@Component({
  selector: 'app-budget-avatar-head',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Scène Three.js : TalkingHead y ajoute son <canvas>. -->
    <div #stage class="stage" [class.off]="state !== 'ready'" aria-hidden="true"></div>

    <!-- Chargement -->
    <div class="state loading" *ngIf="state === 'loading'">
      <span class="dot"></span>
      <span class="mut">Chargement de l’avatar…</span>
    </div>

    <!-- Repli : avatar SVG d'origine si la 3D n'est pas disponible. -->
    <div class="state fallback" *ngIf="state === 'failed'">
      <svg viewBox="0 0 120 150" aria-hidden="true">
        <ellipse cx="60" cy="146" rx="30" ry="4" fill="rgba(22,26,46,.18)" />
        <rect x="34" y="88" width="52" height="54" rx="16" fill="var(--violet)" />
        <path d="M52 88l8 14 8-14z" fill="var(--card)" />
        <g class="arm">
          <rect x="82" y="60" width="11" height="40" rx="5" fill="var(--violet)" transform="rotate(20 86 92)" />
          <circle cx="95" cy="58" r="7" fill="#fcd9b6" />
        </g>
        <rect x="24" y="92" width="11" height="38" rx="5" fill="var(--violet)" transform="rotate(8 30 92)" />
        <circle cx="60" cy="52" r="26" fill="#fcd9b6" />
        <path d="M33 50c0-22 16-30 28-30s27 8 26 30c-6-10-14-14-26-14s-22 4-28 14z" fill="var(--tx)" />
        <circle cx="51" cy="54" r="3" fill="var(--tx)" />
        <circle cx="69" cy="54" r="3" fill="var(--tx)" />
        <path d="M52 65q8 8 16 0" stroke="var(--warn)" stroke-width="2.5" fill="none" stroke-linecap="round" />
      </svg>
      <p class="mut">{{ hint }}</p>
    </div>
  `,
  styles: [`
    :host{display:block;position:relative;flex:1 1 auto;width:100%;min-height:120px;overflow:hidden}
    .stage{position:absolute;inset:0}
    .stage.off{visibility:hidden}
    /* Canvas décoratif : on ne capture ni les clics ni le survol. */
    .stage canvas{display:block;width:100%!important;height:100%!important;pointer-events:none}

    .state{position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:8px;text-align:center;padding:8px}
    .mut{color:var(--tx-2);font-size:12px;margin:0}

    .dot{width:22px;height:22px;border-radius:50%;border:2px solid var(--line-2);
      border-top-color:var(--violet);animation:headSpin .8s linear infinite}
    @keyframes headSpin{to{transform:rotate(360deg)}}

    .fallback svg{width:120px;max-height:100%;animation:headFloat 3s ease-in-out infinite}
    .fallback .arm{transform-origin:60px 92px;animation:headWave 1.6s ease-in-out infinite}
    @keyframes headFloat{50%{transform:translateY(-6px)}}
    @keyframes headWave{50%{transform:rotate(-28deg)}}

    @media (prefers-reduced-motion: reduce){
      .dot,.fallback svg,.fallback .arm{animation:none}
    }
  `]
})
export class BudgetAvatarHeadComponent implements AfterViewInit, OnDestroy {
  /**
   * Modèle 3D (GLB) chargé par TalkingHead, servi **localement** depuis
   * `src/assets/` : l'avatar fonctionne donc sans accès réseau au moment de
   * l'affichage.
   *
   * `brunette.glb` est l'avatar de démonstration du dépôt TalkingHead
   * (dossier `avatars/`, tag v1.7.0) : un avatar Ready Player Me complet,
   * disposant des « blend shapes » nécessaires au visage.
   *
   * Pour personnaliser : déposez votre propre GLB dans `src/assets/` puis
   * changez cette constante (le modèle doit être un avatar Ready Player Me
   * full-body avec les blend shapes ARKit / Oculus Visemes).
   */
  private static readonly AVATAR_URL = 'assets/brunette.glb';

  private readonly zone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('stage', { static: true }) private stage!: ElementRef<HTMLElement>;

  /** Humeur de l'avatar : reflète l'état de l'analyse. */
  @Input() set mood(value: string) {
    this.currentMood = value || 'neutral';
    this.applyMood();
  }

  state: 'loading' | 'ready' | 'failed' = 'loading';
  hint = '';

  /** Instance TalkingHead (typée localement : la bibliothèque est en JS pur). */
  private head: any = null;
  private currentMood = 'neutral';
  private reducedMotion = false;
  private destroyed = false;

  ngAfterViewInit(): void {
    // Hors zone Angular : la boucle requestAnimationFrame interne à
    // TalkingHead ne doit pas déclencher de détection de changement.
    this.zone.runOutsideAngular(() => void this.init());
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    try {
      this.head?.dispose();
    } catch {
      /* le nettoyage ne doit jamais casser la navigation */
    }
    this.head = null;
  }

  // ---------------------------------------------------------------- interne

  private async init(): Promise<void> {
    if (typeof window === 'undefined') {
      this.fail('Avatar 3D indisponible.');
      return;
    }

    this.reducedMotion = !!(
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );

    // Le constructeur lit clientWidth/clientHeight : on attend que la mise en
    // page soit terminée, sinon la scène démarre avec une taille nulle.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (this.destroyed) return;

    try {
      const head = new TalkingHead(this.stage.nativeElement, {
        ttsLang: 'fr-FR',
        // Aucune synthèse vocale utilisée : on n'importe pas les modules de
        // lip-sync (évite des requêtes inutiles vers /lipsync-*.mjs).
        lipsyncModules: [],
        cameraView: 'upper',
        // Avatar décoratif : on désactive l'orbite (rotation à la souris).
        cameraRotateEnable: false,
        avatarMood: this.currentMood,
        avatarMute: true
      });
      this.head = head;

      await head.showAvatar({
        url: BudgetAvatarHeadComponent.AVATAR_URL,
        body: 'F', // morphologie de référence du modèle livré (brunette)
        lipsyncLang: 'fr',
        avatarMood: this.currentMood
      });

      if (this.destroyed) {
        head.dispose();
        this.head = null;
        return;
      }

      // Respect de `prefers-reduced-motion` : on fige la pose.
      if (this.reducedMotion) head.stop();

      this.setState('ready');
    } catch {
      this.head = null;
      this.fail('Avatar 3D indisponible.');
    }
  }

  private applyMood(): void {
    if (!this.head) return;
    try {
      this.head.setMood(this.currentMood);
    } catch {
      /* humeur inconnue ou squelette pas encore prêt : on ignore */
    }
  }

  private setState(state: 'loading' | 'ready' | 'failed'): void {
    this.zone.run(() => {
      this.state = state;
      this.cdr.markForCheck();
    });
  }

  private fail(hint: string): void {
    this.zone.run(() => {
      this.state = 'failed';
      this.hint = hint;
      this.cdr.markForCheck();
    });
  }
}
