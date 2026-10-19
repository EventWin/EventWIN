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
 * Avatar 3D de l'assistant IA budgétaire.
 *
 * L'avatar **illustre** l'analyse (roue / réflexion pendant l'appel), il ne la
 * simule pas : il n'a aucune logique métier, seulement un état visuel piloté
 * depuis la page détaillée.
 */
@Component({
  selector: 'app-budget-avatar3d',
  standalone: true,
  imports: [CommonModule],
  template: `<div #canvas class="avatar-canvas"></div>`,
  styles: [`
    /* Le conteneur (la page détail) donne la taille : le rendu remplit la
       colonne de l'avatar sans laisser de bande vide. */
    .avatar-canvas {
      position: absolute; inset: 0; overflow: hidden;
      background:
        radial-gradient(120% 140% at 50% 0%, rgba(34,211,238,.18), transparent 60%),
        var(--card);
    }
    @media (prefers-reduced-motion: reduce) {
      .avatar-canvas { background: var(--card); }
    }
  `]
})
export class BudgetAvatar3dComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLDivElement>;
  /** État visuel : réflexion, succès, alerte, surdépassement. */
  @Input() status: 'idle' | 'thinking' | 'ok' | 'warn' | 'over' = 'idle';
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private frame?: number;
  private observer?: ResizeObserver;
  private core?: THREE.Mesh;
  private orbit?: THREE.Group;
  private speed = 0.01;
  private reducedMotion = false;

  private readonly COLORS: Record<string, number> = {
    idle: 0x3b82f6,
    thinking: 0x22d3ee,
    ok: 0x22c55e,
    warn: 0xeab308,
    over: 0xef4444
  };

  ngAfterViewInit(): void {
    this.reducedMotion =
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.init();
    this.animate();
    // La page est en grille flexible : on suit les changements de taille.
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.canvasRef.nativeElement);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.applyStatus();
  }

  ngOnDestroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.renderer?.dispose();
  }

  private resize(): void {
    const div = this.canvasRef.nativeElement;
    const w = div.clientWidth;
    const h = div.clientHeight;
    if (!this.renderer || !this.camera || w < 2 || h < 2) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private init() {
    const div = this.canvasRef.nativeElement;
    const w = div.clientWidth || 240;
    const h = div.clientHeight || 240;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(0, 0, 4.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    div.appendChild(renderer.domElement);

    const key = new THREE.DirectionalLight(0xffffff, 1);
    key.position.set(2, 3, 5);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const rim = new THREE.PointLight(0x22d3ee, 0.8, 20);
    rim.position.set(-3, 0, 2);
    scene.add(rim);

    // Noyau sphérique (la « tête » de l'assistant).
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9, 1),
      new THREE.MeshStandardMaterial({
        color: 0x3b82f6, emissive: 0x1d4ed8, emissiveIntensity: 0.5,
        metalness: 0.5, roughness: 0.3, flatShading: true
      })
    );
    this.core = core;
    scene.add(core);

    // Anneaux orbitaux (visuels de « réflexion »).
    const orbit = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.5 + i * 0.35, 0.02, 8, 60),
        new THREE.MeshStandardMaterial({
          color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 0.5
        })
      );
      ring.rotation.x = Math.PI / 2 + i * 0.5;
      orbit.add(ring);
    }
    this.orbit = orbit;
    scene.add(orbit);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.applyStatus();
  }

  private applyStatus(): void {
    const color = this.COLORS[this.status] ?? this.COLORS['idle'];
    if (this.core) {
      const mat = this.core.material as THREE.MeshStandardMaterial;
      mat.color.setHex(color);
      mat.emissive.setHex(color);
    }
    // Réflexion = animation rapide ; les autres états sont plus posés.
    // En mouvement réduit, la vitesse est mise à zéro (vue statique).
    if (this.reducedMotion) {
      this.speed = 0;
      return;
    }
    this.speed = this.status === 'thinking' ? 0.06 : 0.012;
  }

  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    if (!this.reducedMotion) {
      if (this.core) {
        this.core.rotation.y += this.speed;
        this.core.rotation.x += this.speed * 0.4;
        const pulse = 1 + Math.sin(Date.now() * 0.004) * (this.status === 'thinking' ? 0.06 : 0.02);
        this.core.scale.setScalar(pulse);
      }
      if (this.orbit) {
        this.orbit.rotation.z += this.status === 'thinking' ? 0.05 : 0.008;
      }
    }
    this.renderer?.render(this.scene!, this.camera!);
  };
}
