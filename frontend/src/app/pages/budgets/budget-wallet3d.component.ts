import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  AfterViewInit,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import * as THREE from 'three';

/**
 * Wallet 3D interactif : volume de budget dont le « niveau » liquide représente
 * le budget consommé. Dominante bleu nuit / bleu électrique / cyan pour rester
 * cohérent avec le thème global.
 *
 * Rendu déclaratif : `budgetMax` et `costTotal` pilotent directement la hauteur
 * du niveau réel — l'UI se met à jour automatiquement quand les estimations
 * changent. `thinking` déclenche une animation de « calcul » pendant l'analyse.
 */
@Component({
  selector: 'app-budget-wallet3d',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="wallet-wrap">
      <div #canvas class="wallet-canvas"></div>
      <div class="wallet-overlay">
        <div class="wo-top">
          <span class="wo-lab">Budget maximal</span>
          <span class="wo-live" *ngIf="thinking"><i></i> analyse…</span>
        </div>
        <div class="wo-max n">{{ budgetMax | number:'1.0-0' }}<sup>€</sup></div>
        <div class="wo-row">
          <span>Coût estimé</span>
          <b class="n" [class.over]="isOver()">{{ costTotal | number:'1.0-0' }} €</b>
        </div>
        <div class="wo-bar"><i [style.width.%]="fillPct()" [class.over]="isOver()"></i></div>
        <div class="wo-foot">
          <span class="n" [class.over]="isOver()">{{ fillPct() | number:'1.0-0' }}% du budget</span>
          <span class="n" [class.over]="isOver()">
            {{ isOver() ? 'Dépassement ' + (costTotal - budgetMax | number:'1.0-0') + ' €'
                        : 'Reste ' + (budgetMax - costTotal | number:'1.0-0') + ' €' }}
          </span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .wallet-wrap{position:relative}
    .wallet-canvas {
      width: 100%; height: 200px; border-radius: 16px; overflow: hidden;
      border: 1px solid var(--line);
      background:
        radial-gradient(120% 140% at 50% 0%, rgba(59,130,246,.22), transparent 60%),
        radial-gradient(120% 120% at 80% 100%, rgba(34,211,238,.14), transparent 55%),
        var(--card);
    }
    .wallet-overlay{position:absolute;inset:0;padding:14px 16px;display:flex;flex-direction:column;
      justify-content:space-between;pointer-events:none}
    .wo-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .wo-lab{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--tx-2)}
    .wo-live{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--cyan);font-weight:600}
    .wo-live i{width:6px;height:6px;border-radius:50%;background:var(--cyan);animation:bl 1.2s infinite}
    .wo-max{font-size:30px;font-weight:600;line-height:1.05;color:var(--tx);
      text-shadow:0 2px 18px rgba(11,13,24,.35)}
    .wo-max sup{font-size:14px;font-weight:500;color:var(--tx-2);vertical-align:super;margin-left:1px}
    .wo-row{display:flex;align-items:baseline;justify-content:space-between;font-size:12px;color:var(--tx-2)}
    .wo-row b{font-family:"Space Grotesk",sans-serif;font-size:14px;font-weight:600;color:var(--tx)}
    .wo-bar{height:8px;border-radius:8px;background:rgba(255,255,255,.18);overflow:hidden;margin:7px 0 6px}
    .wo-bar i{display:block;height:100%;border-radius:8px;background:linear-gradient(90deg,var(--blue),var(--cyan));
      transition:width .7s var(--ease),background .4s}
    .wo-foot{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--tx-2);
      font-variant-numeric:tabular-nums}
    .wo-row b.over,.wo-foot .over{color:var(--risk)}
    .wo-bar i.over{background:linear-gradient(90deg,#E8455F,#F97362)}
    @media (prefers-reduced-motion: reduce) {
      .wallet-canvas { background: var(--card); }
      .wo-bar i{transition:none}
    }
  `]
})
export class BudgetWallet3dComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLDivElement>;
  @Input() budgetMax = 0;
  @Input() costTotal = 0;
  @Input() thinking = false;
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private frame?: number;
  private liquid?: THREE.Mesh;
  private liquidMat?: THREE.MeshStandardMaterial;
  private targetLevel = 0.15;
  private currentLevel = 0.15;
  private spin?: THREE.Group;
  private reducedMotion = false;

  ngAfterViewInit(): void {
    this.reducedMotion =
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.init();
    this.animate();
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.updateTargetLevel();
  }

  ngOnDestroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.renderer?.dispose();
  }

  fillPct(): number {
    if (!this.budgetMax || this.budgetMax <= 0) return this.costTotal > 0 ? 100 : 0;
    return Math.min(100, Math.round((this.costTotal / this.budgetMax) * 100));
  }

  isOver(): boolean {
    return this.costTotal > this.budgetMax;
  }

  private updateTargetLevel(): void {
    const max = Math.max(this.budgetMax || 0, 1);
    const used = Math.min(Math.max(this.costTotal || 0, 0) / max, 1);
    // On garde un peu de volume même à vide pour ne pas « disparaître ».
    this.targetLevel = 0.08 + used * 0.72;
  }

  private init() {
    const div = this.canvasRef.nativeElement;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, div.clientWidth / div.clientHeight, 0.1, 100);
    camera.position.set(0, 0.9, 3.7);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(div.clientWidth, div.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    div.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0x9fc6ff, 1.0);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x22d3ee, 0.6);
    rim.position.set(-3, -1, -2);
    scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);
    this.spin = group;

    // Corps du wallet (carte arrondie).
    const bodyGeo = new THREE.BoxGeometry(2.2, 1.4, 0.5, 1, 1, 1);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x14213d, metalness: 0.4, roughness: 0.35
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Bande lumineuse cyan en haut.
    const bandGeo = new THREE.BoxGeometry(2.22, 0.12, 0.52);
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.6, roughness: 0.3
    });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.y = 0.66;
    group.add(band);

    // Niveau liquide (budget consommé) : une barre interne bleue.
    const liquidGeo = new THREE.BoxGeometry(2.0, 1.0, 0.4);
    const liquidMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6, emissive: 0x1d4ed8, emissiveIntensity: 0.55,
      transparent: true, opacity: 0.92, roughness: 0.25, metalness: 0.2
    });
    const liquid = new THREE.Mesh(liquidGeo, liquidMat);
    liquid.position.set(0, -0.5, 0);
    this.liquid = liquid;
    this.liquidMat = liquidMat;
    group.add(liquid);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    // Léger parallaxe au survol pour la profondeur.
    div.addEventListener('pointermove', (e: PointerEvent) => {
      const rect = div.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      if (this.spin) {
        this.spin.rotation.y = x * 0.3;
        this.spin.rotation.x = y * 0.2;
      }
    });

    this.updateTargetLevel();
  }

  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);

    // Mouvement réduit : pas de pulsation ni de rotation ambiantes.
    if (this.reducedMotion) {
      this.currentLevel = this.targetLevel;
      if (this.liquid) {
        this.liquid.scale.y = Math.max(this.currentLevel, 0.001);
        this.liquid.position.y = -0.5 + this.currentLevel * 0.5;
      }
      if (this.liquidMat) this.liquidMat.emissiveIntensity = 0.6;
      this.renderer?.render(this.scene!, this.camera!);
      return;
    }

    // Interpolation douce vers le niveau cible.
    this.currentLevel += (this.targetLevel - this.currentLevel) * 0.08;
    if (this.liquid) {
      const h = this.currentLevel;
      this.liquid.scale.y = Math.max(h, 0.001);
      this.liquid.position.y = -0.5 + h * 0.5;
    }
    if (this.liquidMat) {
      // Pendant l'analyse, le volume « respire » pour signaler le calcul.
      const base = this.thinking ? 0.75 : 0.55;
      this.liquidMat.emissiveIntensity = base + Math.sin(Date.now() * 0.006) * (this.thinking ? 0.4 : 0.12);
    }
    if (this.spin) this.spin.rotation.z = Math.sin(Date.now() * 0.0004) * 0.04;
    this.renderer?.render(this.scene!, this.camera!);
  };
}
