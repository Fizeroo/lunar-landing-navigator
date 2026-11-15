import {
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vec3 } from '../contracts';
import { makeEarth, type BodyTextureState } from './bodies';
import type { MoonHost } from './context';
import { bodyToLatLon, bodyToScene, latLonToBodyUnit, sceneToBody } from './coords';
import { addBodyDirections, buildHostBuffers, geographicMoonMaterial, loadMoonMap } from './hostGeometry';
import { makeStarSky, skyMatrix, type SkyState } from './sky';

export type SiteId = 'a' | 'b';
export type TextureState = 'loading' | 'ready' | 'error';
export type GlobeMode = 'overview' | 'space';
/** Where the Orbit camera is anchored: the whole globe, a place on it, or the schematic Sun-Earth-Moon view. */
export type OrbitFraming = 'globe' | 'region' | 'space';

export const SITE_COLORS: Record<SiteId, number> = { a: 0xff7a59, b: 0x3fd9c4 };

const RADIUS_M = 1737400;
const KM = 1000 / RADIUS_M; // one kilometre in scene units (lunar radii)
const SUN_MARKER_DISTANCE = 1.75;
const EARTH_MARKER_DISTANCE = 1.5;
const HOME_DIRECTION = new Vector3(1, 0.18, 0.32).normalize(); // near side (lon 0 is +X)
const SOUTH_POLE_DIRECTION = new Vector3(0.3, -1, 0.2).normalize();
const GLOBE_DISTANCE = 3.3;
const PICK_DRAG_TOLERANCE_PX = 5;
const ORBIT_FOV_DEG = 38;
/** Space view: schematic placement only. Distances and sizes are NOT to scale. */
const SPACE_EARTH_DISTANCE = 6.5;
const SPACE_SUN_DISTANCE = 13;
const SPACE_EARTH_RADIUS = 1.6;
const SPACE_SUN_RADIUS = 1.9;
const SPACE_CAMERA_DISTANCE = 36;
const Z_AXIS = new Vector3(0, 0, 1);
const WORLD_UP = new Vector3(0, 1, 0);
/** Mouse-control limits per framing, in scene units. Exposed to the checks through `controlState`. */
const LIMITS: Record<OrbitFraming, { min: number; max: number }> = {
  globe: { min: 1.12, max: 9 },
  region: { min: 1.2 * KM, max: 600 * KM },
  space: { min: 1.5, max: 90 },
};

/** A numbered or lettered badge tied to an exact ground point. */
export interface OrbitMarker {
  id: string;
  label: string;
  tone: 'site-a' | 'site-b' | 'option' | 'unknown' | 'blocked';
  /** Exact ground position, Moon-fixed metres. The leader line ends here. */
  bodyM: Vec3;
  selected: boolean;
  title: string;
  /** Candidate badges can be chosen; site badges only mark. */
  clickable: boolean;
}

/** Camera pose in Moon-fixed metres, shared with the first-person renderer during a descent or ascent. */
export interface BodyPose {
  positionBodyM: Vec3;
  forwardBody: Vec3;
  upBody: Vec3;
  fovDeg: number;
}

interface Pose {
  target: Vector3;
  position: Vector3;
  up: Vector3;
}

interface Flight {
  from: Pose;
  to: Pose;
  fromQ: Quaternion;
  toQ: Quaternion;
  start: number;
  duration: number;
  framing: OrbitFraming;
  done: (() => void) | null;
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

const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The Moon seen from outside: always one Moon. Looking at a region is the same camera closer to the
 * same globe, with the detailed terrain seated in it; nothing is ever swapped for an isolated tile.
 */
export class MoonScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private controls: OrbitControls;
  /** Plain reference sphere, shown only until the continuous terrain host is built. */
  private readonly sphere: Mesh<SphereGeometry, MeshStandardMaterial>;
  private readonly globeMaterial = geographicMoonMaterial();
  private readonly regionMaterial = new MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1, metalness: 0 });
  private readonly hostGroup = new Group();
  private readonly dataEdge = new LineLoop(new BufferGeometry(), new LineBasicMaterial({ color: 0xffb84a, transparent: true, opacity: 0.55 }));
  private pickTargets: Mesh[] = [];
  private regionUv: [number, number] | null = null;
  private toneAt: ((u: number, v: number) => Color) | null = null;
  private readonly sunLight = new DirectionalLight(0xffffff, 3.2);
  private readonly ambient = new AmbientLight(0xffffff, 1.6);
  /** Neutral fill that keeps relief readable from regional height when the real Sun is grazing. Not physical; fades out on descent. */
  private readonly fill = new DirectionalLight(0xc9d4e6, 0);
  private readonly sunIndicator = makeDirectionIndicator(0xffc94a, SUN_MARKER_DISTANCE, 0.035);
  private readonly earthIndicator = makeDirectionIndicator(0x5aa9ff, EARTH_MARKER_DISTANCE, 0.03);
  private readonly spaceGroup = new Group();
  private readonly spaceEarth = new Group();
  private readonly spaceSun = new Group();
  private readonly earth = makeEarth((state) => this.assetHandler?.('earth', state));
  private readonly moonLabel = makeTextSprite('Moon', '#e6eaf2', 0.8);
  private readonly spaceLabels: Array<{ sprite: Sprite; anchor: Group | null; offset: number }> = [];
  private readonly sky = makeStarSky(40, (state) => this.assetHandler?.('sky', state));
  private readonly skyRotation = skyMatrix((x, y, z) => bodyToScene([x, y, z]));
  private mode: GlobeMode = 'overview';
  private framingNow: OrbitFraming = 'globe';
  private hasSun = false;
  private hasEarth = false;
  private readonly raycaster = new Raycaster();
  private readonly pointerDown = new Vector2();
  private readonly host: HTMLElement;
  private pointerIsDown = false;
  private flight: Flight | null = null;
  private external = false;
  private saved: (Pose & { framing: OrbitFraming }) | null = null;
  private running = true;
  private pickHandler: ((latDeg: number, lonDeg: number) => void) | null = null;
  private textureHandler: ((state: TextureState, message?: string) => void) | null = null;
  private assetHandler: ((asset: 'sky' | 'earth', state: SkyState | BodyTextureState) => void) | null = null;
  private markerHandler: ((id: string) => void) | null = null;
  private readonly markerLayer = document.createElement('div');
  private readonly leaderLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private markers: Array<{ data: OrbitMarker; position: Vector3; badge: HTMLButtonElement; leader: SVGLineElement; dot: SVGCircleElement }> = [];
  private rightInset = 0;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '3D Moon. Click to place the active site; drag to rotate; scroll to zoom.');
    this.renderer.domElement.style.cursor = 'crosshair';

    this.leaderLayer.classList.add('orbit-leaders');
    this.markerLayer.className = 'orbit-markers';
    host.append(this.leaderLayer, this.markerLayer);

    this.scene.background = new Color(0x000000);
    this.camera = new PerspectiveCamera(ORBIT_FOV_DEG, 1, 2e-7, 400);
    this.camera.position.copy(SOUTH_POLE_DIRECTION).multiplyScalar(3.12);
    this.controls = this.makeControls(new Vector3(), WORLD_UP, 'globe');

    this.scene.add(this.sky.group);
    this.sky.setExposure(0.9);

    const sphereGeometry = new SphereGeometry(1, 256, 128);
    addBodyDirections(sphereGeometry, (p) => sceneToBody(p));
    this.sphere = new Mesh(sphereGeometry, this.globeMaterial);
    this.dataEdge.visible = false;
    this.scene.add(this.sphere, this.hostGroup, this.dataEdge);

    this.sunLight.visible = false;
    this.scene.add(this.sunLight, this.sunLight.target, this.ambient, this.fill, this.fill.target);
    this.scene.add(this.sunIndicator, this.earthIndicator);

    // Space view bodies (schematic sizes and distances; directions are the real ephemeris directions).
    this.earth.group.scale.setScalar(SPACE_EARTH_RADIUS);
    const earthLabel = makeTextSprite('Earth', '#7cb8ff', 0.9);
    this.spaceEarth.add(this.earth.group);
    this.spaceLabels.push({ sprite: earthLabel, anchor: this.spaceEarth, offset: SPACE_EARTH_RADIUS + 0.8 });
    const sunBall = new Mesh(new SphereGeometry(SPACE_SUN_RADIUS, 48, 24), new MeshBasicMaterial({ color: 0xfff1cf }));
    const sunLabel = makeTextSprite('Sun', '#ffc94a', 0.9);
    this.spaceSun.add(makeGlowSprite('rgba(255,214,130,0.5)', SPACE_SUN_RADIUS * 4.2), sunBall);
    this.spaceLabels.push({ sprite: sunLabel, anchor: this.spaceSun, offset: SPACE_SUN_RADIUS + 0.9 }, { sprite: this.moonLabel, anchor: null, offset: 1.75 });
    this.spaceGroup.add(this.spaceEarth, this.spaceSun, this.moonLabel, earthLabel, sunLabel);
    this.spaceGroup.visible = false;
    this.spaceEarth.visible = false;
    this.spaceSun.visible = false;
    this.scene.add(this.spaceGroup);

    this.loadTexture();
    this.bindPointer();

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  onPick(handler: (latDeg: number, lonDeg: number) => void): void { this.pickHandler = handler; }
  onTextureState(handler: (state: TextureState, message?: string) => void): void { this.textureHandler = handler; }
  /** Load state of the star map and the Earth map, so a failure is reported instead of silently replaced. */
  onAssetState(handler: (asset: 'sky' | 'earth', state: SkyState | BodyTextureState) => void): void { this.assetHandler = handler; }
  onMarker(handler: (id: string) => void): void { this.markerHandler = handler; }

  get framing(): OrbitFraming { return this.framingNow; }
  /** True while the camera is anchored on a place rather than on the whole globe. */
  get regionShown(): boolean { return this.framingNow === 'region'; }
  get flying(): boolean { return this.flight !== null; }

  /** What the mouse controls are anchored on and how far they may travel, for the checks. */
  get controlState(): { framing: OrbitFraming; enabled: boolean; external: boolean; flying: boolean; distance: number; min: number; max: number; targetRadius: number; cameraRadius: number; fovDeg: number; globeDrawn: boolean } {
    return {
      framing: this.framingNow, enabled: this.controls.enabled, external: this.external, flying: this.flight !== null,
      distance: this.camera.position.distanceTo(this.controls.target), min: this.controls.minDistance, max: this.controls.maxDistance,
      targetRadius: this.controls.target.length(), cameraRadius: this.camera.position.length(), fovDeg: this.camera.fov,
      globeDrawn: this.sphere.visible || this.hostGroup.children.length > 0,
    };
  }

  private makeControls(target: Vector3, up: Vector3, framing: OrbitFraming): OrbitControls {
    this.camera.up.copy(up);
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.9;
    controls.target.copy(target);
    controls.minDistance = LIMITS[framing].min;
    controls.maxDistance = LIMITS[framing].max;
    if (framing === 'region') controls.maxPolarAngle = 82 * Math.PI / 180; // never below the local horizontal of the place
    controls.addEventListener('start', () => this.stopFlight());
    return controls;
  }

  /** Re-anchor the mouse controls on a target with a given "up", keeping the camera where it is (within the limits). */
  private anchor(target: Vector3, up: Vector3, framing: OrbitFraming): void {
    this.controls.dispose();
    this.controls = this.makeControls(target, up, framing);
    this.framingNow = framing;
    this.controls.update();
    this.resize();
  }

  /**
   * The continuous drawing mesh: detailed terrain, real context and the rest of the Moon as one surface.
   * Until this is set the plain reference sphere is drawn.
   */
  setHost(host: MoonHost): void {
    for (const child of [...this.hostGroup.children]) {
      this.hostGroup.remove(child);
      if (child instanceof Mesh) child.geometry.dispose();
    }
    const buffers = buildHostBuffers(host, (x, y, z, target) => bodyToScene([x / RADIUS_M, y / RADIUS_M, z / RADIUS_M], target));
    const globe = new Mesh(buffers.globe, this.globeMaterial);
    const detail = new Mesh(buffers.detail, this.regionMaterial);
    this.pickTargets = [globe, detail];
    this.hostGroup.add(globe, detail);
    if (buffers.context) {
      const context = new Mesh(buffers.context, this.regionMaterial);
      this.hostGroup.add(context);
      this.pickTargets.push(context);
    }
    this.sphere.visible = false;
    this.dataEdge.geometry.dispose();
    this.dataEdge.geometry = new BufferGeometry();
    // Lifted a few metres so the thin line is not buried in its own triangles.
    const edge = buffers.detailEdge.map((value) => value * (1 + 8 / RADIUS_M));
    this.dataEdge.geometry.setAttribute('position', new Float32BufferAttribute(edge, 3));
    this.regionUv = buffers.regionUv;
    this.applyRegionTone();
  }

  private applyRegionTone(): void {
    if (this.toneAt && this.regionUv) this.regionMaterial.color.copy(this.toneAt(this.regionUv[0], this.regionUv[1]));
  }

  /** Badges for the sites and the candidates. Each is tied to an exact ground point by a leader line. */
  setMarkers(markers: ReadonlyArray<OrbitMarker>): void {
    for (const marker of this.markers) { marker.badge.remove(); marker.leader.remove(); marker.dot.remove(); }
    this.markers = markers.map((data) => {
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = `orbit-marker ${data.tone}`;
      badge.textContent = data.label;
      badge.title = data.title;
      badge.dataset['markerId'] = data.id;
      badge.setAttribute('aria-pressed', String(data.selected));
      if (data.clickable) badge.addEventListener('click', () => this.markerHandler?.(data.id));
      else { badge.disabled = true; badge.tabIndex = -1; }
      this.markerLayer.append(badge);
      const leader = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '2.5');
      for (const node of [leader, dot]) node.setAttribute('class', data.tone);
      this.leaderLayer.append(leader, dot);
      return { data, position: this.toScene(data.bodyM), badge, leader, dot };
    });
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
      return;
    }
    const dir = bodyToScene(direction).normalize();
    this.spaceSun.position.copy(dir).multiplyScalar(SPACE_SUN_DISTANCE);
    this.spaceSun.visible = true;
    this.sunLight.position.copy(dir).multiplyScalar(10);
    this.sunLight.target.position.set(0, 0, 0);
    this.sunLight.visible = true;
    this.earth.setSunDirection(dir); // the Sun is so far that its direction from Earth equals its direction from the Moon
    this.sunIndicator.quaternion.copy(new Quaternion().setFromUnitVectors(Z_AXIS, dir));
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
    this.earth.face(dir.clone().negate(), WORLD_UP); // illustrative attitude: longitude 0 toward the Moon
    this.earthIndicator.quaternion.copy(new Quaternion().setFromUnitVectors(Z_AXIS, dir));
  }

  /** 0 = black sky; 1 = the star map as published. Appearance only. */
  setSkyExposure(exposure: number): void {
    this.sky.setExposure(exposure);
  }

  /** Overview: the Moon. Space: Moon, Earth and Sun together (not to scale). */
  setMode(mode: GlobeMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    const space = mode === 'space';
    this.spaceGroup.visible = space;
    if (space) {
      // Look from the side of the Sun-Moon-Earth arrangement so all three are in frame.
      const sun = this.spaceSun.position.clone();
      const earth = this.spaceEarth.position.clone();
      let normal = sun.clone().cross(earth);
      if (normal.lengthSq() < 1e-6) normal = new Vector3(0, 1, 0);
      const target = sun.clone().add(earth).multiplyScalar(0.5);
      const direction = this.hasSun && this.hasEarth
        ? normal.normalize().multiplyScalar(0.85).add(sun.clone().add(earth).normalize().multiplyScalar(-0.25)).normalize()
        : HOME_DIRECTION;
      this.flyTo({ target, position: target.clone().addScaledVector(direction, SPACE_CAMERA_DISTANCE), up: WORLD_UP.clone() }, 'space', 1100);
    } else {
      const direction = this.camera.position.clone().normalize();
      this.flyTo(this.globePose(direction, 3.12), 'globe', 1100);
    }
  }

  private globePose(direction: Vector3, distance = GLOBE_DISTANCE): Pose {
    return { target: new Vector3(), position: direction.clone().normalize().multiplyScalar(distance), up: WORLD_UP.clone() };
  }

  /** Oblique view of a place from about 20 km, on the same Moon: its surroundings stay in the picture. */
  private regionPose(ground: Vector3, rangeKm = 21): Pose {
    const up = ground.clone().normalize();
    const reference = Math.abs(up.x) < 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
    const ahead = reference.addScaledVector(up, -reference.dot(up)).normalize(); // at the south pole: toward the Earth-facing side
    return { target: ground.clone(), position: ground.clone().addScaledVector(up, rangeKm * 0.6 * KM).addScaledVector(ahead, -rangeKm * 0.8 * KM), up };
  }

  private toScene(bodyM: Vec3): Vector3 {
    return bodyToScene([bodyM[0] / RADIUS_M, bodyM[1] / RADIUS_M, bodyM[2] / RADIUS_M]);
  }

  /** Fly to the regional view of a ground point (Moon-fixed metres). The globe stays; only the camera moves. */
  flyToRegion(groundBodyM: Vec3, done: (() => void) | null = null): void {
    if (this.mode === 'space') { this.mode = 'overview'; this.spaceGroup.visible = false; }
    this.flyTo(this.regionPose(this.toScene(groundBodyM)), 'region', 1500, done);
  }

  /** The regional pose for a ground point, as a shared Moon-fixed pose (where an ascent ends). */
  regionPoseBody(groundBodyM: Vec3): BodyPose {
    const pose = this.regionPose(this.toScene(groundBodyM));
    const forward = pose.target.clone().sub(pose.position).normalize();
    const p = sceneToBody(pose.position);
    return { positionBodyM: [p[0] * RADIUS_M, p[1] * RADIUS_M, p[2] * RADIUS_M], forwardBody: sceneToBody(forward), upBody: sceneToBody(pose.up), fovDeg: ORBIT_FOV_DEG };
  }

  flyHome(): void {
    if (this.mode === 'space') return;
    this.flyTo(this.globePose(HOME_DIRECTION), 'globe', 1400);
  }

  flySouthPole(): void {
    if (this.mode === 'space') return;
    this.flyTo(this.globePose(SOUTH_POLE_DIRECTION, 3.12), 'globe', 1400);
  }

  /** Whole-globe view centred above a point (planetocentric latitude, east longitude). */
  flyToGlobePoint(latDeg: number, lonDeg: number): void {
    if (this.mode === 'space') return;
    const direction = bodyToScene(latLonToBodyUnit(latDeg, lonDeg));
    // Exactly over a pole the globe's "up" would be undefined; lean a little toward the near side.
    if (Math.abs(direction.y) > 0.97) direction.add(new Vector3(0.3, 0, 0.2)).normalize();
    this.flyTo(this.globePose(direction), 'globe', 1300);
  }

  private flyTo(to: Pose, framing: OrbitFraming, duration: number, done: (() => void) | null = null): void {
    this.flight = null; // a superseded flight's completion is dropped, never run late
    this.external = false;
    const from: Pose = { target: this.controls.target.clone(), position: this.camera.position.clone(), up: this.camera.up.clone() };
    const toQ = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(to.position, to.target, to.up));
    this.controls.enabled = false;
    this.flight = { from, to, fromQ: this.camera.quaternion.clone(), toQ, start: performance.now(), duration, framing, done };
  }

  /** Stop a flight where it is (the user took the mouse, or another view took over). Its completion is dropped. */
  private stopFlight(): void {
    const flight = this.flight;
    if (!flight) return;
    this.flight = null;
    this.controls.enabled = true;
    // Anchor on what the flight was heading for, so the controls behave as that view would from here.
    this.anchor(flight.to.target, flight.to.up, flight.framing);
  }

  private stepFlight(now: number): void {
    const f = this.flight;
    if (!f) return;
    const t = Math.min(1, (now - f.start) / f.duration);
    const e = t * t * t * (t * (t * 6 - 15) + 10);
    // Direction and height are interpolated separately so the camera goes round the Moon, never through it.
    const fromDir = f.from.position.clone().normalize();
    const toDir = f.to.position.clone().normalize();
    const angle = fromDir.angleTo(toDir);
    const direction = angle < 1e-5 ? toDir.clone() : fromDir.clone().applyQuaternion(new Quaternion().slerp(new Quaternion().setFromUnitVectors(fromDir, toDir), e));
    const fromHeight = Math.max(1e-6, f.from.position.length() - 1);
    const toHeight = Math.max(1e-6, f.to.position.length() - 1);
    const height = Math.exp(Math.log(fromHeight) + (Math.log(toHeight) - Math.log(fromHeight)) * e) + Math.sin(Math.PI * e) * angle * 0.35;
    this.camera.position.copy(direction).multiplyScalar(1 + height);
    this.camera.quaternion.slerpQuaternions(f.fromQ, f.toQ, e);
    if (t >= 1) {
      this.flight = null;
      this.camera.position.copy(f.to.position);
      this.controls.enabled = true;
      this.anchor(f.to.target, f.to.up, f.framing);
      f.done?.();
    }
  }

  /** Current camera as a Moon-fixed pose in metres. */
  getPose(): BodyPose {
    this.camera.updateMatrixWorld();
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const p = sceneToBody(this.camera.position);
    return { positionBodyM: [p[0] * RADIUS_M, p[1] * RADIUS_M, p[2] * RADIUS_M], forwardBody: sceneToBody(forward), upBody: sceneToBody(up), fovDeg: this.camera.fov };
  }

  /** Drive the camera from outside (descent / ascent). Mouse controls and any flight are suspended. */
  setExternalPose(pose: BodyPose): void {
    if (!this.external) {
      // A flight in progress is abandoned where it is; what it was heading for becomes the saved view.
      const flight = this.flight;
      this.flight = null;
      this.saved = flight
        ? { target: flight.to.target.clone(), position: flight.to.position.clone(), up: flight.to.up.clone(), framing: flight.framing }
        : { target: this.controls.target.clone(), position: this.camera.position.clone(), up: this.camera.up.clone(), framing: this.framingNow };
      this.external = true;
      this.controls.enabled = false;
      this.resize();
    }
    this.camera.position.copy(this.toScene(pose.positionBodyM));
    this.camera.up.copy(bodyToScene(pose.upBody));
    this.camera.lookAt(this.camera.position.clone().add(bodyToScene(pose.forwardBody)));
    if (this.camera.fov !== pose.fovDeg) { this.camera.fov = pose.fovDeg; this.camera.updateProjectionMatrix(); }
  }

  /**
   * Give the camera back to the mouse: either exactly the view the descent started from ('saved'),
   * or the regional view anchored on a ground point. The anchor's distance limits apply at once, so
   * no path can leave the camera in a state the mouse controls could not have reached.
   */
  releaseExternalPose(to: 'saved' | Vec3): void {
    if (!this.external) return;
    this.external = false;
    this.camera.fov = ORBIT_FOV_DEG;
    this.camera.updateProjectionMatrix();
    this.controls.enabled = true;
    if (to === 'saved' && this.saved) {
      // Back exactly where the descent began: same camera, same anchor, same limits.
      this.camera.position.copy(this.saved.position);
      this.anchor(this.saved.target, this.saved.up, this.saved.framing);
    } else if (to !== 'saved') {
      const ground = this.toScene(to);
      this.anchor(ground, ground.clone().normalize(), 'region');
    } else this.anchor(new Vector3(), WORLD_UP, 'globe');
    this.saved = null;
  }

  /** The view a descent started from (or was flying to), as a Moon-fixed pose: where a reversed descent returns. */
  savedPoseBody(): BodyPose | null {
    const s = this.saved;
    if (!s) return null;
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(s.position, s.target, s.up));
    const p = sceneToBody(s.position);
    return {
      positionBodyM: [p[0] * RADIUS_M, p[1] * RADIUS_M, p[2] * RADIUS_M],
      forwardBody: sceneToBody(new Vector3(0, 0, -1).applyQuaternion(q)),
      upBody: sceneToBody(new Vector3(0, 1, 0).applyQuaternion(q)),
      fovDeg: ORBIT_FOV_DEG,
    };
  }

  private loadTexture(): void {
    this.textureHandler?.('loading');
    loadMoonMap(
      (texture, toneAt) => {
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        this.globeMaterial.map = texture;
        this.globeMaterial.color.set(0xffffff);
        this.globeMaterial.needsUpdate = true;
        this.toneAt = toneAt;
        this.applyRegionTone();
        this.textureHandler?.('ready');
      },
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
      if (moved <= PICK_DRAG_TOLERANCE_PX && !this.external) this.pick(event.clientX, event.clientY);
    });
  }

  private pick(clientX: number, clientY: number): void {
    if (!this.pickHandler || this.mode === 'space') return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.sphere.visible ? this.raycaster.intersectObject(this.sphere, false)[0] : this.raycaster.intersectObjects(this.pickTargets, false)[0];
    if (!hit) return;
    // The exact ray hit, never texture coordinates (unreliable at the seam and the poles).
    const { latDeg, lonDeg } = bodyToLatLon(sceneToBody(hit.point.clone().normalize()));
    this.pickHandler(latDeg, lonDeg);
  }

  /** Keep the picture clear of a panel on the right: the projection is shifted, nothing is rescaled. */
  setRightInset(pixels: number): void {
    if (this.rightInset === pixels) return;
    this.rightInset = pixels;
    this.resize();
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.leaderLayer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.camera.aspect = width / height;
    const inset = this.framingNow === 'region' && !this.external ? Math.min(this.rightInset, width * 0.45) : 0;
    if (inset > 0) this.camera.setViewOffset(width, height, inset / 2, 0, width, height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Pause or resume drawing (paused while the first-person view fully covers it). */
  setActive(active: boolean): void {
    if (this.running === active) return;
    this.running = active;
    this.renderer.setAnimationLoop(active ? (time) => this.frame(time) : null);
    if (active) this.resize();
  }

  /** Height of the camera above the reference sphere, kilometres. */
  get altitudeKm(): number {
    return (this.camera.position.length() - 1) / KM;
  }

  private layoutMarkers(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const placed: Array<{ x: number; y: number }> = [];
    const projected = this.markers.map((marker) => {
      const toCamera = this.camera.position.clone().sub(marker.position);
      const p = marker.position.clone().project(this.camera);
      const facing = toCamera.dot(marker.position) > 0 && p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      return { marker, x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height, visible: facing && this.mode !== 'space' && !this.external };
    }).sort((a, b) => a.x - b.x);
    for (const item of projected) {
      const { marker } = item;
      marker.badge.hidden = !item.visible;
      marker.leader.style.display = item.visible ? '' : 'none';
      marker.dot.style.display = item.visible ? '' : 'none';
      if (!item.visible) continue;
      // Badge above its ground point; pushed sideways only as far as needed to stop badges covering each other.
      let x = item.x;
      const y = item.y - 30;
      for (const other of placed) if (Math.abs(other.y - y) < 22 && x - other.x < 25) x = other.x + 25;
      placed.push({ x, y });
      marker.badge.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      marker.dot.setAttribute('cx', String(item.x));
      marker.dot.setAttribute('cy', String(item.y));
      marker.leader.setAttribute('x1', String(item.x));
      marker.leader.setAttribute('y1', String(item.y));
      marker.leader.setAttribute('x2', String(x));
      marker.leader.setAttribute('y2', String(y + 10));
    }
  }

  private frame(now: number): void {
    // The framing target follows the bodies while time plays.
    if (this.mode === 'space' && !this.flight && !this.external) this.controls.target.copy(this.spaceSun.position).add(this.spaceEarth.position).multiplyScalar(0.5);
    this.stepFlight(now);
    if (!this.flight && !this.external) this.controls.update();

    const altitudeKm = this.altitudeKm;
    const near = smooth(900, 60, altitudeKm);        // 0 from afar, 1 once the camera is over a region
    const descending = smooth(6, 2.5, altitudeKm);   // the readability fill is gone before the first-person view takes over
    this.fill.intensity = this.hasSun ? 0.5 * near * (1 - descending) : 0;
    this.ambient.intensity = this.hasSun ? 0.11 + 0.09 * near * (1 - descending) - 0.04 * descending : 1.6;
    const up = this.camera.position.clone().normalize();
    this.fill.position.copy(up).multiplyScalar(4);
    this.fill.target.position.copy(up);
    this.dataEdge.visible = !this.sphere.visible && altitudeKm < 500;
    (this.dataEdge.material as LineBasicMaterial).opacity = 0.55 * smooth(500, 120, altitudeKm);
    const indicators = this.mode === 'overview' && altitudeKm > 700;
    this.sunIndicator.visible = indicators && this.hasSun;
    this.earthIndicator.visible = indicators && this.hasEarth;

    // The sky is infinitely far: it moves with the camera (no parallax) and never turns with it.
    this.sky.group.matrix.copy(this.skyRotation).setPosition(this.camera.position);
    this.sky.group.matrixWorldNeedsUpdate = true;

    if (this.mode === 'space') {
      // Keep the name labels above their bodies on screen, whatever the camera angle.
      const screenUp = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      for (const label of this.spaceLabels) label.sprite.position.copy(label.anchor ? label.anchor.position : new Vector3()).addScaledVector(screenUp, label.offset);
    }
    this.renderer.render(this.scene, this.camera);
    this.layoutMarkers();
  }
}
