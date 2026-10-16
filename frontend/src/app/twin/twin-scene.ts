import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Attendee, TwinModel, VehicleSpec } from './twin.models';

export type LayerKey = 'participants' | 'structure' | 'route' | 'resources' | 'risks';
export type CameraPreset = 'overview' | 'top' | 'inside';

export type SceneSelection =
  | { kind: 'participant'; id: string }
  | { kind: 'vehicle'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'zone'; id: 'overflow' | 'catering' | 'stage' | 'pickup' | 'destination' };

const COLORS = {
  gain: 0x0fa97d,
  warn: 0xe0940b,
  risk: 0xe8455f,
  unknown: 0x9aa3bf,
  violet: 0x7c5cff,
  cyan: 0x22d3ee,
  blue: 0x3b82f6
};

export function fitColor(score: number | null): number {
  if (score === null) return COLORS.unknown;
  if (score >= 75) return COLORS.gain;
  if (score >= 50) return COLORS.warn;
  return COLORS.risk;
}

interface Pickable {
  selection: SceneSelection;
  highlight: THREE.Mesh[];
  focus: THREE.Vector3;
}

/**
 * Imperative Three.js scene for an event's digital twin. Built entirely from
 * the TwinModel (vehicles, seats, rooms, attendees), never from static assets.
 */
export class TwinScene {
  onSelect: (selection: SceneSelection | null) => void = () => {};

  private readonly renderer: THREE.WebGLRenderer;
  private readonly labels: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
  private readonly controls: OrbitControls;
  private readonly root = new THREE.Group();
  private readonly layers: Record<LayerKey, THREE.Group> = {
    participants: new THREE.Group(),
    structure: new THREE.Group(),
    route: new THREE.Group(),
    resources: new THREE.Group(),
    risks: new THREE.Group()
  };
  private readonly pickables = new Map<THREE.Object3D, Pickable>();
  private readonly byKey = new Map<string, Pickable>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;
  private readonly disposables: { dispose(): void }[] = [];
  private selectionRing: THREE.Mesh;
  private selectedKey: string | null = null;
  private highlighted: { mesh: THREE.Mesh; emissive: number }[] = [];
  private presets: Record<CameraPreset, { pos: THREE.Vector3; target: THREE.Vector3 }> = {
    overview: { pos: new THREE.Vector3(30, 26, 34), target: new THREE.Vector3() },
    top: { pos: new THREE.Vector3(0, 60, 0.01), target: new THREE.Vector3() },
    inside: { pos: new THREE.Vector3(0, 2, 6), target: new THREE.Vector3() }
  };
  private flight: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private frame = 0;
  private clock = new THREE.Clock();
  private downAt = { x: 0, y: 0 };
  private disposed = false;
  private dark = false;
  private groundMat: THREE.MeshStandardMaterial | null = null;
  private groundLight = 0xdfe4ef;
  private themed: { mat: THREE.MeshStandardMaterial; light: number; dark: number }[] = [];

  constructor(private readonly host: HTMLElement, dark: boolean) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'twin-canvas';
    host.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'twin-labels';
    host.appendChild(this.labels.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTexture;
    this.disposables.push(envTexture, pmrem);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 220;
    this.controls.addEventListener('start', () => (this.flight = null));

    this.setupLights();
    this.setTheme(dark);
    Object.values(this.layers).forEach((g) => this.root.add(g));
    this.scene.add(this.root);

    const ringGeo = new THREE.RingGeometry(0.42, 0.56, 40);
    const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.violet, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false });
    this.selectionRing = new THREE.Mesh(ringGeo, ringMat);
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.renderOrder = 10;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.loop();
  }

  // ---- public API ----------------------------------------------------------

  setTheme(dark: boolean): void {
    this.dark = dark;
    const bg = new THREE.Color(dark ? 0x0d1120 : 0xeef1f9);
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 90, 260);
    this.groundMat?.color.setHex(dark ? 0x1a2033 : this.groundLight);
    this.themed.forEach((t) => t.mat.color.setHex(dark ? t.dark : t.light));
  }

  /** Material whose colour follows the light/dark theme. */
  private themedMat(light: number, dark: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const mat = this.mat(this.dark ? dark : light, opts);
    this.themed.push({ mat, light, dark });
    return mat;
  }

  /** Rebuilds the scene. Keep the camera when only scenario parameters changed. */
  setModel(model: TwinModel, resetCamera = true): void {
    this.clearContent();
    if (model.kind === 'transport') this.buildTransport(model);
    else this.buildVenue(model);
    if (resetCamera) {
      this.flight = null;
      this.camera.position.copy(this.presets.overview.pos);
      this.controls.target.copy(this.presets.overview.target);
    }
    if (this.selectedKey && this.byKey.has(this.selectedKey)) {
      this.applySelection(this.selectedKey, false);
    } else {
      this.selectedKey = null;
      this.applySelection(null, false);
    }
  }

  setLayer(layer: LayerKey, visible: boolean): void {
    this.layers[layer].visible = visible;
  }

  select(selection: SceneSelection | null, fly = true): void {
    const key = selection ? keyOf(selection) : null;
    this.selectedKey = key && this.byKey.has(key) ? key : null;
    this.applySelection(this.selectedKey, fly);
  }

  /** Temporarily emphasise a set of participants (e.g. those affected by a recommendation). */
  emphasise(ids: string[]): void {
    const wanted = new Set(ids.map((id) => `participant:${id}`));
    this.byKey.forEach((p, key) => {
      if (p.selection.kind !== 'participant') return;
      const dim = wanted.size > 0 && !wanted.has(key);
      p.highlight.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.transparent = dim;
        mat.opacity = dim ? 0.18 : 1;
      });
    });
  }

  setCamera(preset: CameraPreset): void {
    const p = this.presets[preset];
    this.flight = { pos: p.pos.clone(), target: p.target.clone() };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    this.clearContent();
    this.controls.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
    canvas.remove();
    this.labels.domElement.remove();
  }

  // ---- setup ----------------------------------------------------------------

  private setupLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c2dc, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(30, 50, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.25);
    const t = this.clock.elapsedTime;
    if (this.flight) {
      const k = 1 - Math.exp(-dt * 6);
      this.camera.position.lerp(this.flight.pos, k);
      this.controls.target.lerp(this.flight.target, k);
      if (this.camera.position.distanceTo(this.flight.pos) < 0.05) this.flight = null;
    }
    if (this.selectionRing.visible) {
      const s = 1 + Math.sin(t * 3.2) * 0.08;
      this.selectionRing.scale.set(s * this.selectionRing.userData['size'], s * this.selectionRing.userData['size'], 1);
    }
    this.layers.risks.children.forEach((c) => {
      if (c.userData['pulse']) (c as THREE.Mesh).scale.setScalar(1 + Math.sin(t * 2.4) * 0.06);
    });
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  // ---- interaction -------------------------------------------------------------

  private onPointerDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 5) return; // was a drag
    const hit = this.pick(e);
    this.selectedKey = hit ? keyOf(hit.selection) : null;
    this.applySelection(this.selectedKey, false);
    this.onSelect(hit ? hit.selection : null);
  };

  private onPointerMove = (e: PointerEvent) => {
    this.renderer.domElement.style.cursor = this.pick(e) ? 'pointer' : 'grab';
  };

  private pick(e: PointerEvent): Pickable | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const candidates = [...this.pickables.keys()].filter((o) => isVisible(o));
    const hits = this.raycaster.intersectObjects(candidates, false);
    for (const h of hits) {
      const p = this.pickables.get(h.object);
      if (p) return p;
    }
    return null;
  }

  private applySelection(key: string | null, fly: boolean): void {
    this.highlighted.forEach(({ mesh, emissive }) => (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(emissive));
    this.highlighted = [];
    const p = key ? this.byKey.get(key) : null;
    if (!p) {
      this.selectionRing.visible = false;
      return;
    }
    p.highlight.forEach((mesh) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      this.highlighted.push({ mesh, emissive: mat.emissive.getHex() });
      mat.emissive.setHex(COLORS.violet);
      mat.emissiveIntensity = 0.55;
    });
    const size = p.selection.kind === 'participant' ? 1 : p.selection.kind === 'vehicle' ? 6.5 : 5;
    this.selectionRing.userData['size'] = size;
    this.selectionRing.position.set(p.focus.x, 0.06, p.focus.z);
    this.selectionRing.visible = true;
    if (fly) {
      const dist = p.selection.kind === 'participant' ? 7 : 22;
      const offset = new THREE.Vector3(dist * 0.6, dist * 0.7, dist * 0.8);
      this.flight = { pos: p.focus.clone().add(offset), target: p.focus.clone() };
    }
  }

  private register(selection: SceneSelection, objects: THREE.Mesh[], focus: THREE.Vector3): void {
    const p: Pickable = { selection, highlight: objects, focus };
    objects.forEach((o) => this.pickables.set(o, p));
    this.byKey.set(keyOf(selection), p);
  }

  private clearContent(): void {
    Object.values(this.layers).forEach((layer) => {
      layer.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      layer.clear();
    });
    this.pickables.clear();
    this.byKey.clear();
    this.highlighted = [];
    this.themed = [];
  }

  // ---- shared builders ------------------------------------------------------------

  private mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...opts });
  }

  private box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
  }

  private label(text: string, cls: string, pos: THREE.Vector3): CSS2DObject {
    const el = document.createElement('div');
    el.className = `twin-label ${cls}`;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.copy(pos);
    return obj;
  }

  private ground(size: number, color: number): void {
    this.groundLight = color;
    this.groundMat = this.mat(this.dark ? 0x1a2033 : color, { roughness: 0.95 });
    const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.groundMat);
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    this.layers.structure.add(g);
    const grid = new THREE.GridHelper(size, size / 2, 0x8d94b2, 0x8d94b2);
    (grid.material as THREE.Material).opacity = 0.08;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.005;
    this.layers.structure.add(grid);
  }

  /** A seated or standing person, coloured by fit score. Returns pickable meshes. */
  private person(a: Attendee, x: number, y: number, z: number, facing: number, seated: boolean): THREE.Mesh[] {
    const color = fitColor(a.fit.score);
    const bodyMat = this.mat(color, { roughness: 0.45 });
    const headMat = this.mat(0xf1d3bd, { roughness: 0.7 });
    const torsoLen = seated ? 0.32 : 0.62;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, torsoLen, 6, 12), bodyMat);
    body.position.set(x, y + torsoLen / 2 + 0.19, z);
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 18, 14), headMat);
    head.position.set(x, y + torsoLen + 0.52, z);
    head.castShadow = true;
    body.rotation.y = facing;
    this.layers.participants.add(body, head);
    if (a.needsAccessibility) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 8, 24), this.mat(COLORS.cyan, { emissive: COLORS.cyan, emissiveIntensity: 0.6 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, y + torsoLen + 0.78, z);
      this.layers.participants.add(ring);
    }
    return [body, head];
  }

  private warningDisc(x: number, z: number, radius: number, text: string, zone: SceneSelection): void {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 48),
      new THREE.MeshStandardMaterial({ color: COLORS.risk, transparent: true, opacity: 0.22, emissive: COLORS.risk, emissiveIntensity: 0.25 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, 0.03, z);
    disc.userData['pulse'] = true;
    this.layers.risks.add(disc);
    this.layers.risks.add(this.label(text, 'risk', new THREE.Vector3(x, 2.6, z)));
    this.register(zone, [disc], new THREE.Vector3(x, 0, z));
  }

  // ---- transport scene --------------------------------------------------------------

  private buildTransport(model: TwinModel): void {
    const plan = model.transport!;
    const attendees = new Map(model.attendees.map((a) => [a.participantId, a]));
    const vehicles = plan.vehicles;
    const spacing = 5.2;
    const totalWidth = Math.max(1, vehicles.length) * spacing;
    const groundSize = Math.max(70, totalWidth + 50);
    const left = -(totalWidth / 2 + 12);
    const right = totalWidth / 2 + 12;
    this.ground(groundSize, 0xdfe4ef);

    // Parking apron and road.
    const asphalt = this.mat(0x5a6178, { roughness: 0.92 });
    const roadLen = right - left + 16;
    const road = this.box(roadLen, 0.04, 6, asphalt, 0, 0.02, 12, false);
    road.receiveShadow = true;
    this.layers.route.add(road);
    const dashMat = this.mat(0xffffff, { roughness: 0.5 });
    for (let x = -roadLen / 2 + 2; x < roadLen / 2; x += 4) this.layers.route.add(this.box(2, 0.01, 0.16, dashMat, x, 0.05, 12, false));
    const apron = this.box(totalWidth + 6, 0.03, 16, this.themedMat(0xc9cfdd, 0x2a3148, { roughness: 0.9 }), 0, 0.015, 0, false);
    this.layers.structure.add(apron);
    for (let i = 0; i <= vehicles.length; i++) {
      const x = -totalWidth / 2 + i * spacing;
      this.layers.structure.add(this.box(0.12, 0.01, 14, dashMat, x, 0.04, 0, false));
    }

    // Route: pickup on the left, destination arrow on the right.
    const ev = model.source.event;
    const pickup = this.box(6, 0.25, 4, this.mat(0xffffff), left, 0.12, 20);
    this.layers.route.add(pickup);
    this.register({ kind: 'zone', id: 'pickup' }, [pickup], new THREE.Vector3(left, 0, 20));
    this.layers.route.add(this.label(`Départ · ${ev.location || 'lieu à définir'}`, 'route', new THREE.Vector3(left, 2.4, 20)));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 12), this.mat(COLORS.violet));
    pole.position.set(left + 2.4, 1.6, 20);
    this.layers.route.add(pole);

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(left, 0.12, 17.5),
      new THREE.Vector3(left + 3, 0.12, 13),
      new THREE.Vector3(0, 0.12, 12),
      new THREE.Vector3(right - 3, 0.12, 11.5),
      new THREE.Vector3(right, 0.12, 8)
    ]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.13, 8, false),
      new THREE.MeshStandardMaterial({ color: COLORS.blue, emissive: COLORS.cyan, emissiveIntensity: 0.45 }));
    this.layers.route.add(tube);
    const dest = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 24), this.mat(COLORS.cyan, { emissive: COLORS.cyan, emissiveIntensity: 0.3 }));
    dest.position.set(right, 1.2, 8);
    dest.rotation.z = Math.PI;
    dest.castShadow = true;
    this.layers.route.add(dest);
    this.register({ kind: 'zone', id: 'destination' }, [dest], new THREE.Vector3(right, 0, 8));
    const routeNote = ev.route_or_logistics_notes ? ev.route_or_logistics_notes.split('\n')[0].slice(0, 60) : 'Itinéraire non détaillé';
    this.layers.route.add(this.label(`Arrivée · ${routeNote}`, 'route', new THREE.Vector3(right, 3.2, 8)));

    // Vehicles with seats and passengers.
    const seatsByVehicle = new Map<string, Map<number, string>>();
    plan.assignments.forEach((a) => {
      if (a.vehicleId === null || a.seatIndex === null) return;
      if (!seatsByVehicle.has(a.vehicleId)) seatsByVehicle.set(a.vehicleId, new Map());
      seatsByVehicle.get(a.vehicleId)!.set(a.seatIndex, a.participantId);
    });
    vehicles.forEach((v, i) => {
      const x = -totalWidth / 2 + spacing / 2 + i * spacing;
      this.buildVehicle(v, x, seatsByVehicle.get(v.id) ?? new Map(), attendees);
    });

    // Passengers without a seat wait at the pickup point.
    if (plan.unseated.length) {
      plan.unseated.forEach((id, i) => {
        const a = attendees.get(id);
        if (!a) return;
        const col = i % 6, row = Math.floor(i / 6);
        const px = left - 2 + col * 0.8, pz = 23 + row * 0.8;
        const meshes = this.person(a, px, 0, pz, Math.PI, false);
        this.register({ kind: 'participant', id }, meshes, new THREE.Vector3(px, 0, pz));
      });
      this.warningDisc(left, 25, 4.2, `${plan.unseated.length} sans siège`, { kind: 'zone', id: 'overflow' });
    } else if (vehicles.length === 0) {
      this.warningDisc(0, 0, 6, 'Aucun véhicule planifié', { kind: 'zone', id: 'overflow' });
    }

    const span = right - left;
    const firstX = -totalWidth / 2 + spacing / 2;
    const cabin = this.layers.structure.children.find((c) => c.userData['cabin'])?.userData['cabin'];
    this.presets = {
      overview: { pos: new THREE.Vector3(span * 0.28, span * 0.3 + 5, span * 0.42 + 9), target: new THREE.Vector3(0, 0, 3) },
      top: { pos: new THREE.Vector3(0, span * 0.95 + 18, 9), target: new THREE.Vector3(0, 0, 8) },
      inside: cabin
        ? { pos: new THREE.Vector3(firstX + 0.5, cabin.eye + 0.85, cabin.front + 0.35), target: new THREE.Vector3(firstX, cabin.eye - 0.9, cabin.rear - 0.5) }
        : { pos: new THREE.Vector3(0, 10, 20), target: new THREE.Vector3() }
    };
  }

  private buildVehicle(v: VehicleSpec, x: number, seats: Map<number, string>, attendees: Map<string, Attendee>): void {
    const perRow = v.kind === 'vip' ? 3 : 4;
    const rows = Math.ceil(v.capacity / perRow);
    const pitch = v.kind === 'vip' ? 1.0 : 0.82;
    const length = Math.max(6.5, rows * pitch + 3.2);
    const width = v.kind === 'mini' ? 2.2 : 2.55;
    const height = v.kind === 'mini' ? 2.7 : 3.3;
    const z0 = -length / 2;
    const paint = v.kind === 'vip' ? 0x1e2340 : v.kind === 'mini' ? 0x3b82f6 : 0xf7f8fc;
    const group = new THREE.Group();
    group.position.x = x;

    const body = this.mat(paint, { metalness: 0.35, roughness: 0.35 });
    const trim = this.mat(v.kind === 'standard' ? COLORS.violet : 0xffffff, { metalness: 0.2, roughness: 0.4 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fd6f0, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0, transmission: 0.4 });
    const floorY = 0.55;

    const floor = this.box(width, 0.12, length, this.mat(0x2a2f45, { roughness: 0.8 }), 0, floorY, 0);
    const skirtL = this.box(0.08, 1.05, length, body, -width / 2, floorY + 0.5, 0);
    const skirtR = this.box(0.08, 1.05, length, body, width / 2, floorY + 0.5, 0);
    const front = this.box(width, 1.05, 0.08, body, 0, floorY + 0.5, -length / 2);
    const rear = this.box(width, height - floorY, 0.1, body, 0, (height + floorY) / 2, length / 2);
    const stripeL = this.box(0.04, 0.16, length * 0.94, trim, -width / 2 - 0.03, floorY + 0.88, 0, false);
    const stripeR = this.box(0.04, 0.16, length * 0.94, trim, width / 2 + 0.03, floorY + 0.88, 0, false);
    const glassL = this.box(0.04, height - floorY - 1.25, length, glass, -width / 2, floorY + 1.05 + (height - floorY - 1.05) / 2 - 0.1, 0, false);
    const glassR = this.box(0.04, height - floorY - 1.25, length, glass, width / 2, glassL.position.y, 0, false);
    const windshield = this.box(width - 0.1, height - floorY - 1.1, 0.04, glass, 0, glassL.position.y, -length / 2, false);
    const roof = this.box(width, 0.08, length, new THREE.MeshStandardMaterial({ color: paint, transparent: true, opacity: 0.12, roughness: 0.4 }), 0, height, 0, false);
    const bumper = this.box(width + 0.06, 0.35, 0.2, this.mat(0x23283c, { roughness: 0.5 }), 0, 0.55, -length / 2 - 0.08);
    const lightMat = this.mat(0xffffff, { emissive: 0xfff4d6, emissiveIntensity: 0.9 });
    const lampL = this.box(0.34, 0.14, 0.05, lightMat, -width / 2 + 0.35, 0.95, -length / 2 - 0.06, false);
    const lampR = this.box(0.34, 0.14, 0.05, lightMat, width / 2 - 0.35, 0.95, -length / 2 - 0.06, false);
    const tailMat = this.mat(COLORS.risk, { emissive: COLORS.risk, emissiveIntensity: 0.5 });
    const tailL = this.box(0.18, 0.4, 0.05, tailMat, -width / 2 + 0.15, 1.2, length / 2 + 0.06, false);
    const tailR = this.box(0.18, 0.4, 0.05, tailMat, width / 2 - 0.15, 1.2, length / 2 + 0.06, false);
    group.add(floor, skirtL, skirtR, front, rear, stripeL, stripeR, glassL, glassR, windshield, roof, bumper, lampL, lampR, tailL, tailR);
    group.userData['cabin'] = { front: -length / 2, rear: length / 2, eye: floorY + 1.55 };

    const tyre = this.mat(0x15171f, { roughness: 0.9 });
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 24);
    [z0 + 1.4, -z0 - 1.6].forEach((wz) => [-width / 2, width / 2].forEach((wx) => {
      const w = new THREE.Mesh(wheelGeo, tyre);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.5, wz);
      w.castShadow = true;
      group.add(w);
    }));

    // Driver seat + dashboard.
    group.add(this.box(0.55, 0.5, 0.55, this.mat(0x2a2f45), -width / 2 + 0.55, floorY + 0.35, z0 + 1.0));
    group.add(this.box(width - 0.3, 0.3, 0.3, this.mat(0x23283c), 0, floorY + 0.8, z0 + 0.35));

    // Seats: instanced for performance; pickable people sit on them.
    const seatGeo = new THREE.BoxGeometry(0.46, 0.12, 0.46);
    const backGeo = new THREE.BoxGeometry(0.46, 0.55, 0.08);
    const seatMat = this.mat(v.kind === 'vip' ? 0x6b4e2e : 0x3d4566, { roughness: 0.75 });
    const seatMesh = new THREE.InstancedMesh(seatGeo, seatMat, v.capacity);
    const backMesh = new THREE.InstancedMesh(backGeo, seatMat, v.capacity);
    seatMesh.castShadow = backMesh.castShadow = true;
    const m = new THREE.Matrix4();
    const cols = perRow === 4 ? [-0.92, -0.42, 0.42, 0.92] : [-0.9, -0.38, 0.75];
    const scale = (width - 0.3) / 2.3;
    let occupied = 0;
    const meshesInVehicle: THREE.Mesh[] = [floor, skirtL, skirtR, front, rear, roof];

    for (let s = 0; s < v.capacity; s++) {
      const row = Math.floor(s / perRow);
      const col = s % perRow;
      const sx = cols[col] * scale;
      const sz = z0 + 2.1 + row * pitch;
      m.makeTranslation(sx, floorY + 0.45, sz);
      seatMesh.setMatrixAt(s, m);
      m.makeTranslation(sx, floorY + 0.75, sz + 0.24);
      backMesh.setMatrixAt(s, m);
      const pid = seats.get(s);
      const a = pid ? attendees.get(pid) : undefined;
      if (a) {
        occupied++;
        const meshes = this.person(a, x + sx, floorY + 0.4, sz, 0, true);
        this.register({ kind: 'participant', id: a.participantId }, meshes, new THREE.Vector3(x + sx, 0, sz));
      }
    }
    group.add(seatMesh, backMesh);
    this.layers.structure.add(group);
    this.register({ kind: 'vehicle', id: v.id }, meshesInVehicle, new THREE.Vector3(x, 0, 0));

    const full = occupied >= v.capacity;
    this.layers.structure.add(this.label(`${v.label} · ${occupied}/${v.capacity}`, full ? 'warn' : '', new THREE.Vector3(x, height + 0.9, 0)));
  }

  // ---- venue scene ----------------------------------------------------------------------

  private buildVenue(model: TwinModel): void {
    const plan = model.venue!;
    const attendees = new Map(model.attendees.map((a) => [a.participantId, a]));
    const cap = plan.hallCapacity;
    const perRow = Math.min(24, Math.max(8, Math.ceil(Math.sqrt(cap * 1.8))));
    const rows = Math.ceil(cap / perRow);
    const seatW = 0.62, rowD = 0.95, aisle = 1.4;
    const blockW = perRow * seatW + aisle;
    const hallW = Math.max(16, blockW + 6);
    const hallD = Math.max(18, rows * rowD + 11);
    const groundSize = Math.max(80, hallW + 50, hallD + 50);
    this.ground(groundSize, 0xe4e8f1);

    const floorMat = this.mat(0xd8cbb5, { roughness: 0.7 });
    const floor = this.box(hallW, 0.1, hallD, floorMat, 0, 0.05, 0);
    floor.castShadow = false;
    this.layers.structure.add(floor);
    const wallMat = this.mat(0xf7f8fc, { roughness: 0.85 });
    const wallH = 3.2;
    this.layers.structure.add(
      this.box(hallW, wallH, 0.2, wallMat, 0, wallH / 2, -hallD / 2),
      this.box(0.2, wallH, hallD, wallMat, -hallW / 2, wallH / 2, 0),
      this.box(0.2, wallH * 0.4, hallD, wallMat, hallW / 2, wallH * 0.2, 0)
    );
    // Back wall with an entrance gap.
    const gap = 3.2;
    const side = (hallW - gap) / 2;
    this.layers.structure.add(
      this.box(side, wallH * 0.4, 0.2, wallMat, -hallW / 2 + side / 2, wallH * 0.2, hallD / 2),
      this.box(side, wallH * 0.4, 0.2, wallMat, hallW / 2 - side / 2, wallH * 0.2, hallD / 2)
    );

    // Stage, screen, lectern.
    const stageZ = -hallD / 2 + 2.6;
    const stage = this.box(Math.min(hallW - 2, 12), 0.7, 3.6, this.mat(0x1e2340, { roughness: 0.5 }), 0, 0.35, stageZ);
    this.layers.structure.add(stage);
    this.register({ kind: 'zone', id: 'stage' }, [stage], new THREE.Vector3(0, 0, stageZ));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(hallW - 4, 9), 3.2),
      new THREE.MeshStandardMaterial({ color: 0x7c5cff, emissive: 0x3b82f6, emissiveIntensity: 0.55, roughness: 0.3 }));
    screen.position.set(0, 2.9, -hallD / 2 + 0.15);
    this.layers.structure.add(screen);
    this.layers.structure.add(this.box(0.7, 1.1, 0.5, this.mat(0xf7f8fc), 2.4, 1.25, stageZ));
    this.layers.structure.add(this.label(model.source.event.name, 'stage', new THREE.Vector3(0, 4.9, -hallD / 2 + 0.2)));

    // Seats (instanced) + attendees.
    const firstRowZ = stageZ + 3.6;
    const seatMat = this.mat(0x3d4566, { roughness: 0.75 });
    const reservedMat = this.mat(COLORS.violet, { roughness: 0.6, transparent: true, opacity: 0.55 });
    // Chair = seat pan + backrest (audience faces the stage at -z, so backs sit at +z).
    const panGeo = new THREE.BoxGeometry(0.46, 0.07, 0.44);
    const backGeo = new THREE.BoxGeometry(0.46, 0.5, 0.06);
    const legGeo = new THREE.BoxGeometry(0.4, 0.38, 0.36);
    const chairs = (material: THREE.Material, count: number) => {
      const parts = [panGeo, backGeo, legGeo].map((g) => {
        const mesh = new THREE.InstancedMesh(g, material, Math.max(1, count));
        mesh.count = count;
        mesh.castShadow = true;
        return mesh;
      });
      return parts;
    };
    const seatParts = chairs(seatMat, cap);
    const reservedCount = Math.max(0, Math.min(cap, model.source.event.participant_expected || 0) - model.attendees.length);
    const reservedParts = chairs(reservedMat, reservedCount);
    const offsets = [new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(0, 0.72, 0.2), new THREE.Vector3(0, 0.2, 0)];
    const place = (parts: THREE.InstancedMesh[], idx: number, x: number, z: number) =>
      parts.forEach((mesh, k) => mesh.setMatrixAt(idx, new THREE.Matrix4().makeTranslation(x + offsets[k].x, offsets[k].y, z + offsets[k].z)));
    const seatPos = (i: number) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const half = perRow / 2;
      const sx = (col - half + 0.5) * seatW + (col >= half ? aisle / 2 : -aisle / 2);
      return { sx, sz: firstRowZ + row * rowD };
    };
    const occupiedBy = new Map(plan.assignments.filter((a) => a.seatIndex !== null).map((a) => [a.seatIndex as number, a.participantId]));
    let reservedIdx = 0;
    let seatIdx = 0;
    for (let i = 0; i < cap; i++) {
      const { sx, sz } = seatPos(i);
      const pid = occupiedBy.get(i);
      if (!pid && reservedIdx < reservedCount) place(reservedParts, reservedIdx++, sx, sz);
      else place(seatParts, seatIdx++, sx, sz);
      const a = pid ? attendees.get(pid) : undefined;
      if (a) {
        const meshes = this.person(a, sx, 0.47, sz + 0.02, Math.PI, true);
        this.register({ kind: 'participant', id: a.participantId }, meshes, new THREE.Vector3(sx, 0, sz));
      }
    }
    seatParts.forEach((mesh) => (mesh.count = seatIdx));
    this.layers.structure.add(...seatParts);
    if (reservedCount) {
      this.layers.participants.add(...reservedParts);
      this.layers.participants.add(this.label(`${reservedCount} places prévues non nominatives`, 'muted', new THREE.Vector3(hallW / 2 - 3, 1.6, firstRowZ + rows * rowD - 1)));
    }

    // Additional rooms from resources, laid out beside the hall.
    const others = plan.rooms.slice().sort((a, b) => b.capacity - a.capacity).slice(plan.capacitySource === 'resource' ? 1 : 0);
    let rz = -hallD / 2 + 3;
    others.slice(0, 6).forEach((room) => {
      const size = Math.max(4, Math.min(10, Math.sqrt(Math.max(room.capacity, 4)) * 1.4));
      const rx = hallW / 2 + 3 + size / 2;
      const roomMesh = this.box(size, 1.4, size, this.mat(0xeef0fb, { roughness: 0.6, transparent: true, opacity: 0.92 }), rx, 0.7, rz + size / 2);
      const roof = this.box(size, 0.06, size, this.mat(COLORS.violet, { transparent: true, opacity: 0.35 }), rx, 1.43, rz + size / 2, false);
      this.layers.resources.add(roomMesh, roof);
      this.register({ kind: 'room', id: room.id }, [roomMesh], new THREE.Vector3(rx, 0, rz + size / 2));
      this.layers.resources.add(this.label(`${room.name} · ${room.capacity} pl.`, '', new THREE.Vector3(rx, 2.2, rz + size / 2)));
      rz += size + 1.5;
    });

    // Catering zone at the back if a catering resource exists.
    if (plan.hasCatering) {
      const cz = hallD / 2 + 4;
      const tables: THREE.Mesh[] = [];
      for (let i = -1; i <= 1; i++) {
        const t = this.box(3.4, 0.9, 1.1, this.mat(0xffffff, { roughness: 0.35 }), i * 4.2, 0.45, cz);
        tables.push(t);
        this.layers.resources.add(t);
      }
      this.register({ kind: 'zone', id: 'catering' }, tables, new THREE.Vector3(0, 0, cz));
      this.layers.resources.add(this.label('Restauration', '', new THREE.Vector3(0, 1.9, cz)));
    }

    // Overflow: people without a seat stand at the entrance.
    if (plan.overflow.length) {
      const ez = hallD / 2 + 1.6;
      plan.overflow.forEach((id, i) => {
        const a = attendees.get(id);
        if (!a) return;
        const px = -2.4 + (i % 8) * 0.7, pz = ez + Math.floor(i / 8) * 0.7;
        const meshes = this.person(a, px, 0, pz, Math.PI, false);
        this.register({ kind: 'participant', id }, meshes, new THREE.Vector3(px, 0, pz));
      });
      this.warningDisc(0, ez + 1, 4, `${plan.overflow.length} sans place`, { kind: 'zone', id: 'overflow' });
    }

    const span = Math.max(hallW, hallD);
    this.presets = {
      overview: { pos: new THREE.Vector3(span * 0.75, span * 0.7, span * 0.9), target: new THREE.Vector3(0, 0, 0) },
      top: { pos: new THREE.Vector3(0, span * 1.45 + 10, 0.5), target: new THREE.Vector3(0, 0, 0) },
      inside: { pos: new THREE.Vector3(1.2, 3.4, stageZ - 0.6), target: new THREE.Vector3(0, 0.6, firstRowZ + rows * rowD * 0.55) }
    };
  }
}

function keyOf(s: SceneSelection): string {
  return `${s.kind}:${s.id}`;
}

function isVisible(o: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}
