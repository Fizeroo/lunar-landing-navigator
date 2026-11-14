import {
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vec3 } from '../contracts';
import { bodyToLatLon, bodyToScene, latLonToBodyUnit, sceneToBody } from './coords';

export type SiteId = 'a' | 'b';
export type TextureState = 'loading' | 'ready' | 'error';
export type GlobeMode = 'overview' | 'space';

export const SITE_COLORS: Record<SiteId, number> = { a: 0xff7a59, b: 0x3fd9c4 };

const SUN_MARKER_DISTANCE = 1.75;
const EARTH_MARKER_DISTANCE = 1.5;
const HOME_DIRECTION = new Vector3(1, 0.18, 0.32).normalize(); // near side (lon 0 is +X)
const SOUTH_POLE_DIRECTION = new Vector3(0.3, -1, 0.2).normalize();
const PICK_DRAG_TOLERANCE_PX = 5;
/** Space view: schematic placement only. Distances and sizes are NOT to scale. */
const SPACE_EARTH_DISTANCE = 6.5;
const SPACE_SUN_DISTANCE = 13;
const SPACE_EARTH_RADIUS = 1.6;
const SPACE_SUN_RADIUS = 1.9;
const SPACE_CAMERA_DISTANCE = 40;
const Z_AXIS = new Vector3(0, 0, 1);

interface CameraFlight {
  fromDir: Vector3;
  toDir: Vector3;
  fromDist: number;
  toDist: number;
  start: number;
  duration: number;
  done: (() => void) | null;
}

interface SiteMarker {
  group: Group;
  ring: Mesh<RingGeometry, MeshBasicMaterial>;
  halo: Mesh<RingGeometry, MeshBasicMaterial>;
  normal: Vector3 | null;
}

/** Symbolic direction indicator: a short ray from the limb plus a small ball. Not to scale. */
function makeDirectionIndicator(color: number, distance: number, ballRadius: number): Group {
  const group = new Group();
  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 1.03, 0, 0, distance - ballRadius * 1.6], 3));
  const line = new Line(lineGeometry, new LineBasicMaterial({ color, transparent: true, opacity: 0.55 }));
  const ball = new Mesh(new SphereGeometry(ballRadius, 24, 12), new MeshBasicMaterial({ color }));
  ball.position.set(0, 0, distance);
  group.add(line, ball);
  group.visible = false;
  return group;
}

function makeLetterSprite(letter: string, color: number): Sprite {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.fill();
    context.lineWidth = 6;
    context.strokeStyle = '#0b0f17';
    context.stroke();
    context.fillStyle = '#0b0f17';
    context.font = '700 78px system-ui, "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(letter, size / 2, size / 2 + 5);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: true, transparent: true }));
  sprite.scale.setScalar(0.05);
  sprite.position.set(0, 0, 0.1);
  return sprite;
}

function makeTextSprite(text: string, color: string, height: number): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    context.font = '700 54px system-ui, "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 8;
    context.strokeStyle = '#04060b';
    context.strokeText(text, 128, 50);
    context.fillStyle = color;
    context.fillText(text, 128, 50);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(height * (256 / 96), height, 1);
  return sprite;
}

function makeGlowSprite(color: string, size: number): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.setScalar(size);
  return sprite;
}

export class MoonScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly moon: Mesh<SphereGeometry, MeshStandardMaterial>;
  private readonly sunLight = new DirectionalLight(0xffffff, 3.4);
  private readonly ambient = new AmbientLight(0xffffff, 1.6);
  private readonly markers: Record<SiteId, SiteMarker>;
  private readonly sunIndicator = makeDirectionIndicator(0xffc94a, SUN_MARKER_DISTANCE, 0.035);
  private readonly earthIndicator = makeDirectionIndicator(0x5aa9ff, EARTH_MARKER_DISTANCE, 0.03);
  private readonly spaceGroup = new Group();
  private readonly spaceEarth = new Group();
  private readonly spaceSun = new Group();
  private readonly moonLabel = makeTextSprite('Moon', '#e6eaf2', 0.6);
  private mode: GlobeMode = 'overview';
  private hasSun = false;
  private hasEarth = false;
  private readonly raycaster = new Raycaster();
  private readonly pointerDown = new Vector2();
  private readonly host: HTMLElement;
  private pointerIsDown = false;
  private flight: CameraFlight | null = null;
  private active: SiteId = 'a';
  private pickHandler: ((latDeg: number, lonDeg: number) => void) | null = null;
  private textureHandler: ((state: TextureState, message?: string) => void) | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '3D Moon globe. Click to place the active site; drag to rotate; scroll to zoom.');

    this.scene.background = new Color(0x04060b);
    this.camera = new PerspectiveCamera(38, 1, 0.01, 100);
    this.camera.position.copy(SOUTH_POLE_DIRECTION).multiplyScalar(3.12);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.12;
    this.controls.maxDistance = 9;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.9;
    this.controls.addEventListener('start', () => {
      const pending = this.flight;
      this.flight = null;
      pending?.done?.();
    });

    const material = new MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1, metalness: 0 });
    this.moon = new Mesh(new SphereGeometry(1, 256, 128), material);
    this.scene.add(this.moon);

    this.sunLight.visible = false;
    this.scene.add(this.sunLight, this.sunLight.target, this.ambient);
    this.scene.add(this.sunIndicator, this.earthIndicator);

    // Space view bodies (schematic sizes and distances; directions are the real ephemeris directions).
    const earthBall = new Mesh(new SphereGeometry(SPACE_EARTH_RADIUS, 64, 32), new MeshStandardMaterial({ color: 0x3f7fd8, roughness: 0.85, metalness: 0, emissive: 0x071a3a, emissiveIntensity: 0.5 }));
    const earthLabel = makeTextSprite('Earth', '#7cb8ff', 0.9);
    earthLabel.position.y = SPACE_EARTH_RADIUS + 0.75;
    this.spaceEarth.add(makeGlowSprite('rgba(90,169,255,0.35)', SPACE_EARTH_RADIUS * 3.2), earthBall, earthLabel);
    const sunBall = new Mesh(new SphereGeometry(SPACE_SUN_RADIUS, 48, 24), new MeshBasicMaterial({ color: 0xffd76a }));
    const sunLabel = makeTextSprite('Sun', '#ffc94a', 0.9);
    sunLabel.position.y = SPACE_SUN_RADIUS + 0.9;
    this.spaceSun.add(makeGlowSprite('rgba(255,210,110,0.6)', SPACE_SUN_RADIUS * 5), sunBall, sunLabel);
    this.moonLabel.position.y = 1.5;
    this.spaceGroup.add(this.spaceEarth, this.spaceSun, this.moonLabel);
    this.spaceGroup.visible = false;
    this.spaceEarth.visible = false;
    this.spaceSun.visible = false;
    this.scene.add(this.spaceGroup);

    this.markers = { a: this.buildSiteMarker('A', SITE_COLORS.a), b: this.buildSiteMarker('B', SITE_COLORS.b) };
    this.loadTexture();
    this.bindPointer();

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  onPick(handler: (latDeg: number, lonDeg: number) => void): void {
    this.pickHandler = handler;
  }

  onTextureState(handler: (state: TextureState, message?: string) => void): void {
    this.textureHandler = handler;
  }

  /** Place a site marker (planetocentric latitude, east longitude). */
  setSite(id: SiteId, latDeg: number, lonDeg: number): void {
    const marker = this.markers[id];
    const normal = bodyToScene(latLonToBodyUnit(latDeg, lonDeg));
    marker.normal = normal.clone();
    marker.group.position.copy(normal);
    marker.group.quaternion.copy(new Quaternion().setFromUnitVectors(Z_AXIS, normal));
    marker.group.visible = true;
  }

  /** The active site is the one moved by the next click on the globe. */
  setActiveSite(id: SiteId): void {
    this.active = id;
    for (const key of ['a', 'b'] as const) this.markers[key].halo.visible = key === id;
  }

  /**
   * Moon-centred unit Sun direction in MOON_ME from the science module.
   * `null` means no valid scientific value: the globe is shown with neutral,
   * non-physical illumination instead of a guessed Sun.
   */
  setSunDirection(direction: Vec3 | null): void {
    this.hasSun = direction !== null;
    if (!direction) {
      this.sunLight.visible = false;
      this.sunIndicator.visible = false;
      this.spaceSun.visible = false;
      this.ambient.intensity = 1.6;
      return;
    }
    const dir = bodyToScene(direction).normalize();
    this.spaceSun.position.copy(dir).multiplyScalar(SPACE_SUN_DISTANCE);
    this.spaceSun.visible = true;
    this.sunLight.position.copy(dir).multiplyScalar(10);
    this.sunLight.target.position.set(0, 0, 0);
    this.sunLight.visible = true;
    this.ambient.intensity = 0.11; // faint non-physical fill so the night side stays readable
    this.orientIndicator(this.sunIndicator, dir);
    this.sunIndicator.visible = this.mode === 'overview';
  }

  setEarthDirection(direction: Vec3 | null): void {
    this.hasEarth = direction !== null;
    if (!direction) {
      this.earthIndicator.visible = false;
      this.spaceEarth.visible = false;
      return;
    }
    const dir = bodyToScene(direction).normalize();
    this.spaceEarth.position.copy(dir).multiplyScalar(SPACE_EARTH_DISTANCE);
    this.spaceEarth.visible = true;
    this.orientIndicator(this.earthIndicator, dir);
    this.earthIndicator.visible = this.mode === 'overview';
  }

  /** Overview: close globe with symbolic rays. Space: Moon, Earth and Sun together (not to scale). */
  setMode(mode: GlobeMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    const space = mode === 'space';
    this.spaceGroup.visible = space;
    this.sunIndicator.visible = !space && this.hasSun;
    this.earthIndicator.visible = !space && this.hasEarth;
    this.controls.maxDistance = space ? 90 : 9;
    if (space) {
      this.controls.target.copy(this.spaceSun.position).add(this.spaceEarth.position).multiplyScalar(0.5);
      // Look from the side of the Sun–Moon–Earth arrangement so all three are in frame.
      const sun = this.spaceSun.position.clone();
      const earth = this.spaceEarth.position.clone();
      let normal = sun.clone().cross(earth);
      if (normal.lengthSq() < 1e-6) normal = new Vector3(0, 1, 0);
      const direction = normal.normalize().multiplyScalar(0.85).add(sun.clone().add(earth).normalize().multiplyScalar(-0.25)).normalize();
      this.flyTo(this.hasSun && this.hasEarth ? direction : HOME_DIRECTION, SPACE_CAMERA_DISTANCE);
    } else {
      this.controls.target.set(0,0,0);
      this.flyTo(this.camera.position.clone().normalize(), 3.12);
    }
  }

  /** Fly down toward a site; resolves when the camera has arrived (used before entering the surface view). */
  approachSite(id: SiteId): Promise<void> {
    const normal = this.markers[id].normal;
    if (!normal) return Promise.resolve();
    return new Promise((resolve) => this.flyTo(normal, 1.22, resolve, 1100));
  }

  flyHome(): void {
    this.flyTo(HOME_DIRECTION, 3.3);
  }

  flySouthPole(): void {
    this.flyTo(SOUTH_POLE_DIRECTION, 3.12);
  }

  flyToSite(id: SiteId): void {
    const normal = this.markers[id].normal;
    if (normal) this.flyTo(normal, 2.3);
  }

  private orientIndicator(indicator: Group, dir: Vector3): void {
    indicator.quaternion.copy(new Quaternion().setFromUnitVectors(Z_AXIS, dir));
    indicator.visible = true;
  }

  private buildSiteMarker(letter: string, color: number): SiteMarker {
    const group = new Group();
    const ring = new Mesh(new RingGeometry(0.015, 0.022, 48), new MeshBasicMaterial({ color, side: DoubleSide }));
    ring.position.z = 0.0015;
    const halo = new Mesh(new RingGeometry(0.028, 0.032, 48), new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, transparent: true, opacity: 0.9 }));
    halo.position.z = 0.0015;
    halo.visible = false;
    const dot = new Mesh(new SphereGeometry(0.006, 16, 8), new MeshBasicMaterial({ color }));
    const pinGeometry = new BufferGeometry();
    pinGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0.075], 3));
    const pin = new Line(pinGeometry, new LineBasicMaterial({ color }));
    group.add(ring, halo, dot, pin, makeLetterSprite(letter, color));
    group.visible = false;
    this.scene.add(group);
    return { group, ring, halo, normal: null };
  }

  private loadTexture(): void {
    this.textureHandler?.('loading');
    new TextureLoader().load(
      `${import.meta.env.BASE_URL}assets/lroc_color_2k.jpg`,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        this.moon.material.map = texture;
        this.moon.material.color.set(0xffffff);
        this.moon.material.needsUpdate = true;
        this.textureHandler?.('ready');
      },
      undefined,
      () => this.textureHandler?.('error', 'The Moon texture could not be loaded (assets/lroc_color_2k.jpg).'),
    );
  }

  private bindPointer(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.pointerIsDown = true;
      this.pointerDown.set(event.clientX, event.clientY);
    });
    canvas.addEventListener('pointerup', (event) => {
      if (!this.pointerIsDown || event.button !== 0) return;
      this.pointerIsDown = false;
      const moved = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
      if (moved <= PICK_DRAG_TOLERANCE_PX) this.pick(event.clientX, event.clientY);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (this.pointerIsDown) return;
      canvas.style.cursor = this.hitTest(event.clientX, event.clientY) ? 'crosshair' : 'grab';
    });
  }

  private hitTest(clientX: number, clientY: number): Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.moon, false)[0];
    return hit ? hit.point.clone() : null;
  }

  private pick(clientX: number, clientY: number): void {
    const point = this.hitTest(clientX, clientY);
    if (!point || !this.pickHandler) return;
    // Use the exact ray–sphere hit, never texture UVs (unreliable at the seam and poles).
    const { latDeg, lonDeg } = bodyToLatLon(sceneToBody(point.normalize()));
    this.pickHandler(latDeg, lonDeg);
  }

  private flyTo(direction: Vector3, distance: number, done: (() => void) | null = null, duration = 900): void {
    this.flight?.done?.();
    this.flight = {
      fromDir: this.camera.position.clone().normalize(),
      toDir: direction.clone().normalize(),
      fromDist: this.camera.position.length(),
      toDist: distance,
      start: performance.now(),
      duration,
      done,
    };
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Pause or resume rendering (paused while the surface view is shown). */
  setActive(active: boolean): void {
    this.renderer.setAnimationLoop(active ? (time) => this.frame(time) : null);
    if (active) this.resize();
  }

  private frame(now: number): void {
    if(this.mode==='space') this.controls.target.copy(this.spaceSun.position).add(this.spaceEarth.position).multiplyScalar(0.5);
    if (this.flight) {
      const f = this.flight;
      const t = Math.min(1, (now - f.start) / f.duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const q = new Quaternion().setFromUnitVectors(f.fromDir, f.toDir);
      const dir = f.fromDir.clone().applyQuaternion(new Quaternion().slerp(q, e));
      this.camera.position.copy(dir).multiplyScalar(f.fromDist + (f.toDist - f.fromDist) * e);
      if (t >= 1) {
        this.flight = null;
        f.done?.();
      }
    }
    this.controls.update();
    for (const key of ['a', 'b'] as const) {
      const marker = this.markers[key];
      if (!marker.group.visible) continue;
      const d = this.camera.position.distanceTo(marker.group.position);
      marker.group.scale.setScalar(Math.min(1.6, Math.max(0.12, d * 0.55)) * (key === this.active ? 1.15 : 1));
    }
    this.renderer.render(this.scene, this.camera);
  }
}
