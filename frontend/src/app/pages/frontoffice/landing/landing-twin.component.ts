import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Aperçu 3D décoratif de la page d'accueil : une salle de conférence dont les
 * sièges se « remplissent » avec les couleurs d'adéquation du jumeau.
 * Purement illustratif (aucune donnée) — le vrai jumeau est généré à partir
 * des données de l'événement une fois connecté.
 */
@Component({
  selector: 'app-landing-twin',
  standalone: true,
  template: `<div class="lt" #host><canvas #canvas aria-hidden="true"></canvas></div>`,
  styles: [`
    :host { display: block; }
    .lt { position: relative; width: 100%; height: 100%; }
    canvas { display: block; width: 100%; height: 100%; cursor: grab; touch-action: pan-y; }
    canvas:active { cursor: grabbing; }
  `],
})
export class LandingTwinComponent implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;

  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
  private controls?: OrbitControls;
  private seats?: THREE.InstancedMesh;
  private seatTargets: THREE.Color[] = [];
  private seatOrder: number[] = [];
  private seatEmpty = new THREE.Color();
  private screenMat?: THREE.MeshStandardMaterial;
  private floorMat?: THREE.MeshStandardMaterial;
  private wallMat?: THREE.MeshStandardMaterial;
  private frame = 0;
  private start = performance.now();
  private visible = true;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private resizeObserver?: ResizeObserver;
  private intersection?: IntersectionObserver;
  private themeObserver?: MutationObserver;

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    // Rendu hors zone Angular : pas de détection de changement à chaque image.
    this.zone.runOutsideAngular(() => {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas.nativeElement, antialias: true, alpha: true });
      } catch {
        return; // WebGL indisponible : la mise en page reste correcte sans la 3D.
      }
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.build();
      this.applyTheme();
      this.resize();

      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.host.nativeElement);
      this.intersection = new IntersectionObserver(([entry]) => (this.visible = entry.isIntersecting));
      this.intersection.observe(this.host.nativeElement);
      this.themeObserver = new MutationObserver(() => this.applyTheme());
      this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      this.loop();
    });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    this.themeObserver?.disconnect();
    this.controls?.dispose();
    this.scene.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach(m => m.dispose());
    });
    this.renderer?.dispose();
  }

  private build(): void {
    const s = this.scene;
    this.camera.position.set(30, 24, 34);

    s.add(new THREE.HemisphereLight(0xffffff, 0xd9d4c7, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(18, 30, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28 });
    s.add(sun);

    const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      s.add(mesh);
      return mesh;
    };

    // Sol et salle
    // Sol « invisible » : seules les ombres apparaissent, la salle flotte sur la page.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.12 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);
    this.floorMat = mat(0xd9ccb6, { roughness: 0.7 });
    box(30, 0.3, 26, this.floorMat, 0, 0.15, 0);
    this.wallMat = mat(0xfafaf7, { roughness: 0.9 });
    const wall = this.wallMat;
    box(30, 3.2, 0.35, wall, 0, 1.75, -13);
    box(0.35, 3.2, 26, wall, -15, 1.75, 0);
    box(0.35, 1.2, 26, wall, 15, 0.75, 0);

    // Scène et écran lumineux
    box(14, 0.8, 4.2, mat(0x1b1e2b, { roughness: 0.45 }), 0, 0.7, -9.8);
    this.screenMat = new THREE.MeshStandardMaterial({ color: 0x6355e8, emissive: 0x38bdf8, emissiveIntensity: 0.5, roughness: 0.25 });
    box(11, 4.4, 0.25, this.screenMat, 0, 4.4, -12.6);
    box(0.8, 1.2, 0.6, mat(0xffffff, { roughness: 0.4 }), 3, 1.7, -9.6);

    // Tables de restauration au fond
    const table = mat(0xffffff, { roughness: 0.35 });
    [-9, -3, 3, 9].forEach(x => box(3.6, 0.9, 1.2, table, x, 0.75, 11));

    // Sièges : InstancedMesh (≈ 140 sièges en deux blocs)
    const seatGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    seatGeo.translate(0, 0.75, 0);
    const positions: THREE.Vector3[] = [];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 20; col++) {
        const aisle = col >= 10 ? 2.2 : 0;
        positions.push(new THREE.Vector3(-11.4 + col * 1.15 + aisle, 0, -5 + row * 1.6));
      }
    }
    this.seats = new THREE.InstancedMesh(seatGeo, mat(0xffffff, { roughness: 0.6 }), positions.length);
    this.seats.castShadow = true;
    const m = new THREE.Matrix4();
    const palette = [0x12936e, 0x12936e, 0x12936e, 0x3b6fe6, 0xc7820a, 0x6355e8];
    positions.forEach((p, i) => {
      m.makeTranslation(p.x, p.y, p.z);
      this.seats!.setMatrixAt(i, m);
      // ~80 % de sièges occupés, couleurs d'adéquation variées.
      const filled = (i * 7919) % 100 < 80;
      this.seatTargets.push(new THREE.Color(filled ? palette[(i * 31) % palette.length] : 0xd6d3c9));
      this.seats!.setColorAt(i, this.seatEmpty);
    });
    this.seatOrder = positions.map((_, i) => i).sort((a, b) => ((a * 2654435761) % 997) - ((b * 2654435761) % 997));
    s.add(this.seats);

    // Contrôles : rotation douce automatique, zoom désactivé (la page défile).
    this.controls = new OrbitControls(this.camera, this.canvas.nativeElement);
    this.controls.target.set(0, 1, 0);
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.autoRotate = !this.reduced;
    this.controls.autoRotateSpeed = 0.55;
    this.controls.minPolarAngle = 0.55;
    this.controls.maxPolarAngle = 1.2;
  }

  private applyTheme(): void {
    const dark = document.documentElement.dataset['theme'] === 'dark';
    this.seatEmpty.setHex(dark ? 0x323644 : 0xe4e1d8);
    this.wallMat?.color.setHex(dark ? 0x3a3e4c : 0xfafaf7);
    this.floorMat?.color.setHex(dark ? 0x2a2d38 : 0xd9ccb6);
    this.seatTargets.forEach(c => {
      if (c.getHex() === 0xd6d3c9 || c.getHex() === 0x3a3e4c) c.setHex(dark ? 0x3a3e4c : 0xd6d3c9);
    });
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host.nativeElement;
    if (!this.renderer || !w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Recule la caméra sur les formats étroits pour garder toute la salle.
    this.camera.position.setLength(w / h < 1 ? 62 : 50);
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    if (!this.visible || !this.renderer) return;
    const t = (performance.now() - this.start) / 1000;

    // Remplissage progressif des sièges, puis cycle lent.
    if (this.seats) {
      const cycle = this.reduced ? 1 : Math.min(1, (t % 14) / 5);
      const shown = Math.floor(cycle * this.seatOrder.length);
      const color = new THREE.Color();
      this.seatOrder.forEach((index, rank) => {
        color.copy(rank < shown ? this.seatTargets[index] : this.seatEmpty);
        this.seats!.setColorAt(index, color);
      });
      this.seats.instanceColor!.needsUpdate = true;
    }
    if (this.screenMat && !this.reduced) {
      this.screenMat.emissiveIntensity = 0.42 + Math.sin(t * 1.6) * 0.12;
    }
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  };
}
