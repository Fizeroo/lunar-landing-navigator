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
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Matrix4,
  PCFShadowMap,
  Raycaster,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Observation, Site, Vec3 } from '../contracts';
import { sampleTerrainWalk, type TerrainPatch, type TerrainWalkSample } from '../science/terrain';
import { bodyToLatLon, bodyToLocalScene, headingPitchToLocal, localToHeadingPitch, localSceneToBody } from './coords';
import { makeEarth, sunDiscTexture, sunGlowTexture, SUN_DISC_FILL, type BodyTextureState, type EarthBody } from './bodies';
import type { MoonHost } from './context';
import { buildHostBuffers, geographicMoonMaterial, loadMoonMap } from './hostGeometry';
import { makeStarSky, skyMatrix, type SkyState } from './sky';
import type { CameraPose } from './transition';

/** Scene units are kilometres; the camera stands at the origin of a local east/up/south frame. */
const MOON_RADIUS_KM = 1737.4;
const BODY_DISTANCE_KM = 3000;
const HORIZON_RING_KM = 6000;
/** Smallest camera eye height used for display, so the camera never sits inside the ground. */
export const MIN_EYE_HEIGHT_M = 0.2;
/** Brightness of the real star map in the Enhanced setting (1 = as published). Appearance only. */
const ENHANCED_SKY_EXPOSURE = 1.35;
/** Walking stops this far (conservative science margin) from the edge of DEM coverage or no-data. */
export const WALK_MARGIN_M = 160;
const WALK_SPEED_MPS = 3;
const FAST_SPEED_MPS = 25;
const DEFAULT_FOV_DEG = 65;
const DEG = Math.PI / 180;

export type SurfaceBody = 'sun' | 'earth';

export interface SurfaceView {
  headingDeg: number | null;
  pitchDeg: number;
  fovDeg: number;
}

/** Real terrain vertices already rotated into the local scene (km), row-major, NaN where there is no data. */
export interface SurfaceTerrain {
  rows: number;
  cols: number;
  positionsKm: Float32Array;
  triangleIndices: Uint32Array;
}

/** Read-only measurements of what is actually drawn, taken from the rendered mesh (browser checks). */
export interface SurfaceProbe {
  model: 'terrain' | 'sphere';
  /** Camera height above the rendered triangle directly below it, metres; null when no triangle is below. */
  eyeClearanceM: number | null;
  /** Camera position in the fixed local frame (east, up, south), metres. */
  cameraLocalM: [number, number, number];
  headingDeg: number;
  pitchDeg: number;
  fovDeg: number;
  /** True when the rendered mesh intersects the ray from the eye to the body centre. Null without a direction. */
  centreRayHitsMesh: Record<SurfaceBody, boolean | null>;
  bodyDrawn: Record<SurfaceBody, boolean>;
  pressedKeys: number;
  pointerLocked: boolean;
  /** Drawn visual-context terrain covers the body centre (the scientific patch does not). Picture only. */
  contextHides: Record<SurfaceBody, boolean>;
  /** True while a descent or ascent is driving the camera. */
  external: boolean;
  /** Number of drawn meshes around the scientific patch (0 on the smooth sphere). */
  surroundings: number;
  skyState: SkyState;
  earthState: BodyTextureState;
  /** Angular diameters actually drawn, degrees. */
  sunDiscDeg: number;
  earthDiscDeg: number;
}

/** Fine neutral grain so nearby ground gives a sense of motion. Appearance only: it carries no relief. */
function grainTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    let seed = 0x52454755;
    const random = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    const image = context.createImageData(size, size);
    for (let i = 0; i < size * size; i += 1) {
      const value = 226 + Math.round((random() + random() - 1) * 26);
      image.data[i * 4] = value;
      image.data[i * 4 + 1] = value;
      image.data[i * 4 + 2] = value;
      image.data[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

export interface SurfaceInput {
  observation: Observation;
  latDeg: number;
  lonDeg: number;
  /** Scientific observer height above the reference sphere, metres. */
  observerHeightM: number;
  /** False at an exact pole, where compass directions do not exist. */
  compassDefined: boolean;
  /** False only when the body must not be drawn at all. On terrain the rendered mesh itself hides what it covers. */
  draw: Record<SurfaceBody, boolean>;
  /** Short status shown next to a body the ground hides, e.g. "below the horizon"; null when visible. */
  ghost: Record<SurfaceBody, string | null>;
}

function textSprite(text: string, color: string, scaleKm: number): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    context.font = '700 58px system-ui, "Segoe UI", sans-serif';
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
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(scaleKm * (256 / 96), scaleKm, 1);
  sprite.renderOrder = 5;
  return sprite;
}

/** Spherical cap of the smooth reference sphere around the observer, finely ringed near the camera. */
function buildGround(): BufferGeometry {
  const sectors = 144;
  const distances: number[] = [];
  for (let d = 0.0004; d < 520; d *= 1.13) distances.push(d);
  const positions: number[] = [0, 0, 0];
  const normals: number[] = [0, 1, 0];
  for (const d of distances) {
    const theta = d / MOON_RADIUS_KM;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let s = 0; s < sectors; s += 1) {
      const bearing = (s / sectors) * Math.PI * 2;
      const nx = sinT * Math.sin(bearing);
      const nz = -sinT * Math.cos(bearing);
      positions.push(MOON_RADIUS_KM * nx, MOON_RADIUS_KM * (cosT - 1), MOON_RADIUS_KM * nz);
      normals.push(nx, cosT, nz);
    }
  }
  const index: number[] = [];
  for (let s = 0; s < sectors; s += 1) index.push(0, 1 + ((s + 1) % sectors), 1 + s);
  for (let r = 0; r < distances.length - 1; r += 1) {
    const a = 1 + r * sectors;
    const b = a + sectors;
    for (let s = 0; s < sectors; s += 1) {
      const n = (s + 1) % sectors;
      index.push(a + s, a + n, b + s, a + n, b + n, b + s);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  return geometry;
}

function groundRing(distanceKm: number, color: number, opacity: number): LineLoop {
  const points: number[] = [];
  const theta = distanceKm / MOON_RADIUS_KM;
  const lift = Math.max(0.00002, distanceKm * 0.0015);
  for (let s = 0; s < 180; s += 1) {
    const bearing = (s / 180) * Math.PI * 2;
    points.push(MOON_RADIUS_KM * Math.sin(theta) * Math.sin(bearing), MOON_RADIUS_KM * (Math.cos(theta) - 1) + lift, -MOON_RADIUS_KM * Math.sin(theta) * Math.cos(bearing));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  return new LineLoop(geometry, new LineBasicMaterial({ color, transparent: true, opacity }));
}

/**
 * First-person view from the selected site on the smooth reference sphere.
 * Sun and Earth are drawn exactly along the topocentric directions returned by
 * the science module, at their true angular size; nothing is lifted above the horizon.
 */
export class SurfaceScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(DEFAULT_FOV_DEG, 1, 0.00005, 30000);
  private readonly sunLight = new DirectionalLight(0xffffff, 3.2);
  private readonly ambient = new AmbientLight(0xffffff, 0.07);
  private readonly ground: Mesh<BufferGeometry, MeshStandardMaterial>;
  private readonly sky = new Group();
  private readonly compass = new Group();
  private readonly sunDisc: Sprite;
  private readonly sunGlow: Sprite;
  private readonly sunLabel: Sprite;
  private readonly earthBody: EarthBody;
  private readonly earth: Group;
  private readonly earthLabel: Sprite;
  private readonly pointers: Record<SurfaceBody, HTMLDivElement>;
  private readonly directions: Record<SurfaceBody, Vector3 | null> = { sun: null, earth: null };
  private readonly ghost: Record<SurfaceBody, string | null> = { sun: null, earth: null };
  private readonly sphereAids = new Group();
  private terrain: Group | null = null;
  private land: Mesh<BufferGeometry, MeshStandardMaterial> | null = null;
  private terrainData: SurfaceTerrain | null = null;
  private readonly terrainCentre = new Vector3();
  private terrainRadiusKm = 8;
  private readonly grain = grainTexture();
  private readonly raycaster = new Raycaster();
  private readonly host: HTMLElement;
  private headingDeg = 0;
  private pitchDeg = 4;
  private eyeKm = 1.7 / 1000;
  private active = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private glide: { fromH: number; toH: number; fromP: number; toP: number; start: number } | null = null;
  private viewHandler: ((view: SurfaceView) => void) | null = null;
  private readonly starSky = makeStarSky(12000, (state) => this.assetHandler?.('sky', state));
  private skyRotation = new Matrix4();
  private assetHandler: ((asset: 'sky' | 'earth', state: SkyState | BodyTextureState) => void) | null = null;
  /** Where the eyes are (km, local frame). The camera sits here unless a descent or ascent is driving it. */
  private readonly eye = new Vector3(0, 0.0017, 0);
  private externalPose: CameraPose | null = null;
  private readonly globeMaterial = geographicMoonMaterial();
  private readonly contextMaterial = new MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1, metalness: 0 });
  private readonly landMaterial = new MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1, metalness: 0, map: this.grain });
  private toneAt: ((u: number, v: number) => Color) | null = null;
  private regionUv: [number, number] | null = null;
  private surroundings: Mesh[] = [];
  /** True when the drawn surroundings (visual context only) cover the ray to a body centre that the detailed mesh leaves open. */
  private readonly contextHides: Record<SurfaceBody, boolean> = { sun: false, earth: false };
  private readonly shadowCentre = new Vector3(1e9, 0, 0);
  private sunLocal: Vector3 | null = null;
  private walking: { patch: TerrainPatch; anchor: TerrainWalkSample; frame: Site; current: TerrainWalkSample; heightM: number } | null = null;
  private readonly pressed = new Set<string>();
  private lastFrameAt = 0;
  private lastPositionReport = 0;
  private positionHandler: ((sample: TerrainWalkSample, boundary: boolean) => void) | null = null;
  private lockHandler: ((locked: boolean) => void) | null = null;
  private currentSite: Site | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(4096, 4096);
    // Small offsets only: at a grazing Sun a large normal offset lifts the lookup above real shadows and lights them.
    this.sunLight.shadow.normalBias = 0.0012; // 1.2 m, below the 80 m source grid; suppress grazing-angle self-shadow acne
    this.sunLight.shadow.bias = -0.00002;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', 'Surface view from the selected site. Drag to look around; scroll to zoom.');
    this.renderer.domElement.tabIndex = 0;
    this.scene.background = new Color(0x020308);

    this.ground = new Mesh(buildGround(), new MeshStandardMaterial({ color: 0x9b978f, roughness: 1, metalness: 0 }));
    this.scene.add(this.ground, this.sunLight, this.sunLight.target, this.ambient);

    // Display aids on the smooth ground: range rings and a line toward north.
    for (const [distance, opacity] of [[0.01, 0.5], [0.1, 0.45], [1, 0.4], [10, 0.35], [100, 0.3]] as const) {
      this.sphereAids.add(groundRing(distance, 0xdfe6f2, opacity));
    }
    this.scene.add(this.sphereAids);

    // Reference horizon (tangent plane, altitude 0°) and compass letters, attached to the camera position.
    const ring: number[] = [];
    for (let s = 0; s < 360; s += 1) ring.push(HORIZON_RING_KM * Math.sin(s * DEG), 0, -HORIZON_RING_KM * Math.cos(s * DEG));
    const ringGeometry = new BufferGeometry();
    ringGeometry.setAttribute('position', new Float32BufferAttribute(ring, 3));
    this.sky.add(new LineLoop(ringGeometry, new LineBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.75, depthTest: false })));
    for (let az = 0; az < 360; az += 15) {
      const tick = new BufferGeometry();
      const height = az % 90 === 0 ? 0.03 : az % 45 === 0 ? 0.02 : 0.01;
      tick.setAttribute('position', new Float32BufferAttribute([
        HORIZON_RING_KM * Math.sin(az * DEG), 0, -HORIZON_RING_KM * Math.cos(az * DEG),
        HORIZON_RING_KM * Math.sin(az * DEG), HORIZON_RING_KM * height, -HORIZON_RING_KM * Math.cos(az * DEG),
      ], 3));
      this.compass.add(new Line(tick, new LineBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.8, depthTest: false })));
    }
    for (const [az, letter] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']] as const) {
      const label = textSprite(letter, az === 0 ? '#ff9d8a' : '#cfe6ff', HORIZON_RING_KM * 0.075);
      label.position.copy(headingPitchToLocal(az, 5)).multiplyScalar(HORIZON_RING_KM);
      this.compass.add(label);
    }
    this.sky.add(this.compass);
    this.sky.visible = false; // the real terrain silhouette is the visible horizon, not a HUD line
    this.scene.add(this.sky);
    this.scene.add(this.starSky.group);
    this.starSky.setExposure(ENHANCED_SKY_EXPOSURE);

    this.sunDisc = new Sprite(new SpriteMaterial({ map: sunDiscTexture(), transparent: true, depthWrite: false }));
    this.sunGlow = new Sprite(new SpriteMaterial({ map: sunGlowTexture(), transparent: true, depthWrite: false }));
    this.sunLabel = textSprite('Sun', '#ffc94a', BODY_DISTANCE_KM * 0.026);
    this.earthBody = makeEarth((state) => this.assetHandler?.('earth', state));
    this.earth = this.earthBody.group;
    this.earthLabel = textSprite('Earth', '#5aa9ff', BODY_DISTANCE_KM * 0.026);
    this.sunLabel.material.depthTest = true;
    this.earthLabel.material.depthTest = true;
    this.scene.add(this.sunGlow, this.sunDisc, this.sunLabel, this.earth, this.earthLabel);

    const makePointer = (body: SurfaceBody): HTMLDivElement => {
      const node = document.createElement('div');
      node.className = `surface-pointer ${body}`;
      node.hidden = true;
      host.appendChild(node);
      return node;
    };
    this.pointers = { sun: makePointer('sun'), earth: makePointer('earth') };

    loadMoonMap((texture, toneAt) => {
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.globeMaterial.map = texture;
      this.globeMaterial.color.set(0xffffff);
      this.globeMaterial.needsUpdate = true;
      this.toneAt = toneAt;
      this.applyTone();
    }, () => { /* the Orbit view reports the missing Moon map; here the globe simply stays grey */ });
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.setBodiesVisible(false);
  }

  onView(handler: (view: SurfaceView) => void): void {
    this.viewHandler = handler;
  }

  onPosition(handler: (sample: TerrainWalkSample, boundary: boolean) => void): void { this.positionHandler = handler; }
  onPointerLock(handler: (locked: boolean) => void): void { this.lockHandler = handler; }
  /** Load state of the star map and the Earth map, so a failure is reported instead of silently replaced. */
  onAssetState(handler: (asset: 'sky' | 'earth', state: SkyState | BodyTextureState) => void): void { this.assetHandler = handler; }
  /** Appearance only: Natural is the black sky beside sunlit ground, Enhanced shows the real star map. */
  setEnhancedSky(enhanced: boolean): void { this.starSky.setExposure(enhanced ? ENHANCED_SKY_EXPOSURE : 0); }

  private applyTone(): void {
    if (!this.toneAt || !this.regionUv) return;
    const tone = this.toneAt(this.regionUv[0], this.regionUv[1]);
    this.contextMaterial.color.copy(tone);
    this.landMaterial.color.copy(tone).multiplyScalar(1 / 0.76); // the grain map averages 0.76 in linear light
  }

  /** The eye-level pose (local metres) a descent arrives at and an ascent leaves from. */
  getEyePose(): CameraPose {
    const f = headingPitchToLocal(this.headingDeg, this.pitchDeg);
    return { position: [this.eye.x * 1000, this.eye.y * 1000, this.eye.z * 1000], forward: [f.x, f.y, f.z], up: [0, 1, 0], fovDeg: this.camera.fov };
  }

  /** Drive the camera along a descent or ascent (local metres); null hands it back to the eyes. */
  setExternalPose(pose: CameraPose | null): void {
    this.externalPose = pose;
    if (pose) { this.pressed.clear(); this.dragging = false; this.glide = null; }
  }

  setEyeHeight(heightM:number):void {
    if (!this.walking) return;
    const walk=this.walking;
    heightM=Math.max(heightM,MIN_EYE_HEIGHT_M);
    const anchor=sampleTerrainWalk(walk.patch,walk.anchor.site.latDeg,walk.anchor.site.lonDeg,heightM);
    const current=sampleTerrainWalk(walk.patch,walk.current.site.latDeg,walk.current.site.lonDeg,heightM);
    if (anchor && current) {walk.anchor=anchor;walk.current=current;walk.heightM=heightM;this.placeWalker(current);}
  }

  async enterMouseLook(): Promise<void> {
    if (!this.active) return;
    const canvas = this.renderer.domElement;
    canvas.focus();
    await canvas.requestPointerLock();
  }

  releaseMouse(): void {
    this.pressed.clear();
    this.dragging = false;
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
  }

  /** Fixed local origin throughout a walk; ground/eye come from the shared mesh. */
  setWalking(patch: TerrainPatch | null, site: Site, heightM: number): void {
    this.pressed.clear();
    heightM=Math.max(heightM,MIN_EYE_HEIGHT_M);
    const sample = patch ? sampleTerrainWalk(patch, site.latDeg, site.lonDeg, heightM) : null;
    this.walking = patch && sample ? { patch, anchor: sample, frame: { ...site }, current: sample, heightM } : null;
    if (sample) this.placeWalker(sample);
  }

  returnToPoint(): void {
    if (!this.walking) return;
    this.pressed.clear();
    this.walking.current = this.walking.anchor;
    this.placeWalker(this.walking.anchor);
    this.positionHandler?.(this.walking.anchor, false);
  }

  private placeWalker(sample: TerrainWalkSample): void {
    const walk = this.walking;
    if (!walk) return;
    const delta = sample.eyePositionBodyM.map((v, i) => v - walk.anchor.positionBodyM[i]!) as Vec3;
    this.eye.copy(bodyToLocalScene(delta, walk.frame.latDeg, walk.frame.lonDeg)).multiplyScalar(0.001);
    if (!this.externalPose) this.camera.position.copy(this.eye);
  }

  /** Start or stop rendering (the canvas is hidden by the page when inactive). */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.renderer.setAnimationLoop(active ? (time) => this.frame(time) : null);
    this.lastFrameAt = 0;
    if (!active) this.releaseMouse();
    if (active) this.resize();
  }

  /** Camera eye height actually used for display, metres. */
  get eyeHeightM(): number {
    return this.eyeKm * 1000;
  }

  /** Draw one science observation. `null` clears the bodies (no valid value). */
  update(input: SurfaceInput | null): void {
    if (!input) {
      this.directions.sun = null;
      this.directions.earth = null;
      this.setBodiesVisible(false);
      this.sunLight.visible = false;
      return;
    }
    const { observation, latDeg, lonDeg } = input;
    this.currentSite = { latDeg, lonDeg, heightAboveReferenceSphereM: 0 };
    this.eyeKm = Math.max(input.observerHeightM, MIN_EYE_HEIGHT_M) / 1000;
    if (this.walking) this.placeWalker(this.walking.current);
    else { this.eye.set(0, this.eyeKm, 0); if (!this.externalPose) this.camera.position.copy(this.eye); }
    this.sky.position.copy(this.camera.position);
    this.compass.visible = false; // compass is a compact HUD, not giant letters in the landscape
    this.ghost.sun = input.ghost.sun;
    this.ghost.earth = input.ghost.earth;

    const frame = this.walking?.frame ?? { latDeg, lonDeg };
    this.skyRotation = skyMatrix((x, y, z) => bodyToLocalScene([x, y, z], frame.latDeg, frame.lonDeg));
    const sun = bodyToLocalScene(observation.sun.direction, frame.latDeg, frame.lonDeg).normalize();
    const earth = bodyToLocalScene(observation.earth.direction, frame.latDeg, frame.lonDeg).normalize();
    this.directions.sun = sun;
    this.directions.earth = earth;
    this.setBodiesVisible(true);

    const sunRadius = BODY_DISTANCE_KM * Math.tan(observation.sun.angularRadiusDeg * DEG);
    this.sunLocal = sun.clone();
    this.sunDisc.position.copy(sun).multiplyScalar(BODY_DISTANCE_KM).add(this.eye);
    this.sunDisc.scale.setScalar((2 * sunRadius) / SUN_DISC_FILL); // the disc itself keeps its true angular size
    this.sunGlow.position.copy(this.sunDisc.position);
    this.sunGlow.scale.setScalar(2 * sunRadius * 5);
    this.sunLabel.position.copy(headingPitchToLocal(0, 0).copy(sun)).multiplyScalar(BODY_DISTANCE_KM).add(this.eye);
    this.sunLabel.position.y += sunRadius + BODY_DISTANCE_KM * 0.024;

    const earthDistance = BODY_DISTANCE_KM * 1.1;
    const earthRadius = earthDistance * Math.sin(observation.earth.angularRadiusDeg * DEG);
    this.earth.position.copy(earth).multiplyScalar(earthDistance).add(this.eye);
    this.earth.scale.setScalar(earthRadius);
    this.earthBody.setSunDirection(sun); // real phase: lit from the calculated Sun direction, no self-illumination
    this.earthBody.face(earth.clone().negate(), bodyToLocalScene([0, 0, 1], frame.latDeg, frame.lonDeg)); // illustrative attitude
    this.earthLabel.position.copy(this.earth.position);
    this.earthLabel.position.y += earthRadius + BODY_DISTANCE_KM * 0.024;

    for (const node of [this.sunDisc, this.sunGlow, this.sunLabel]) node.visible = input.draw.sun;
    for (const node of [this.earth, this.earthLabel]) node.visible = input.draw.earth;

    this.sunLight.visible = true;
    this.fitShadows(true);
    // Visual context only: does drawn terrain OUTSIDE the scientific patch cover a body centre the patch leaves open?
    for (const body of ['sun', 'earth'] as const) {
      this.raycaster.set(this.eye, body === 'sun' ? sun : earth);
      this.raycaster.near = 0;
      this.raycaster.far = Infinity;
      this.contextHides[body] = input.ghost[body] === null && this.surroundings.length > 0 && this.raycaster.intersectObjects(this.surroundings, false).length > 0;
    }
  }

  /**
   * Shadow volume around the eyes: 12 km to each side, and long along the light so that ridges of the
   * drawn terrain far toward the Sun still shadow the ground nearby. Shading only, not a horizon result.
   */
  private fitShadows(force: boolean): void {
    if (!this.sunLocal) return;
    if (!force && this.shadowCentre.distanceTo(this.eye) < 0.3) return;
    this.shadowCentre.copy(this.eye);
    const side = 12;
    const along = 75;
    const shadowCamera = this.sunLight.shadow.camera;
    Object.assign(shadowCamera, { left: -side, right: side, top: side, bottom: -side, near: 1, far: along * 2 });
    shadowCamera.updateProjectionMatrix();
    this.sunLight.position.copy(this.sunLocal).multiplyScalar(along).add(this.eye);
    this.sunLight.target.position.copy(this.eye);
    this.sunLight.target.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * Stand on the continuous Moon (detailed terrain seated in its real context), or on the labelled
   * smooth reference sphere (null). `originBodyM` is the site's ground point, the origin of the local frame.
   * The detailed mesh is the scientific one, unchanged; everything around it is visual context only.
   */
  setWorld(world: { host: MoonHost; originBodyM: Vec3; latDeg: number; lonDeg: number } | null): void {
    if (this.terrain) {
      this.scene.remove(this.terrain);
      this.terrain.traverse((node) => {
        if (node instanceof Mesh || node instanceof LineLoop) node.geometry.dispose();
      });
      this.terrain = null;
      this.land = null;
      this.surroundings = [];
    }
    this.terrainData = null;
    this.ground.visible = world === null;
    this.sphereAids.visible = world === null;
    if (!world) return;
    const { host, originBodyM: o, latDeg, lonDeg } = world;
    const buffers = buildHostBuffers(host, (x, y, z, target) => bodyToLocalScene([x - o[0], y - o[1], z - o[2]], latDeg, lonDeg, target).multiplyScalar(0.001));
    const detailPositions = buffers.detail.getAttribute('position').array as Float32Array;
    // Grain repeats every 6 m in the horizontal plane; it is colour only and fades to flat grey with distance.
    const uv = new Float32Array((detailPositions.length / 3) * 2);
    for (let i = 0; i < detailPositions.length / 3; i += 1) {
      uv[i * 2] = (detailPositions[i * 3]! * 1000) / 6;
      uv[i * 2 + 1] = (detailPositions[i * 3 + 2]! * 1000) / 6;
    }
    buffers.detail.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    const group = new Group();
    const land = new Mesh(buffers.detail, this.landMaterial);
    land.castShadow = true;
    land.receiveShadow = true;
    group.add(land);
    this.land = land;
    this.terrainData = { rows: 0, cols: 0, positionsKm: detailPositions, triangleIndices: host.parts.detail };
    const globe = new Mesh(buffers.globe, this.globeMaterial);
    group.add(globe);
    this.surroundings = [globe];
    if (buffers.context) {
      // Real coarse terrain around the patch: drawn, shadow-casting and able to hide a body in the picture,
      // but never a scientific horizon. The card keeps reporting only the detailed patch.
      const context = new Mesh(buffers.context, this.contextMaterial);
      context.castShadow = true;
      context.receiveShadow = true;
      group.add(context);
      this.surroundings.push(context);
    }
    // Thin line on the edge of the scientific DEM.
    const edge = Float32Array.from(buffers.detailEdge);
    for (let i = 1; i < edge.length; i += 3) edge[i] = edge[i]! + 0.004;
    const edgeGeometry = new BufferGeometry();
    edgeGeometry.setAttribute('position', new Float32BufferAttribute(edge, 3));
    group.add(new LineLoop(edgeGeometry, new LineBasicMaterial({ color: 0xffb84a, transparent: true, opacity: 0.6 })));
    this.regionUv = buffers.regionUv;
    this.applyTone();
    this.terrain = group;
    this.scene.add(group);
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Turn the camera toward a body along its real direction (it may be below the horizon). */
  lookAt(body: SurfaceBody, immediate = false): void {
    const direction = this.directions[body];
    if (!direction) return;
    const { headingDeg, pitchDeg } = localToHeadingPitch(direction);
    if (immediate) {
      this.setFov(DEFAULT_FOV_DEG);
      this.glide = null;
      this.headingDeg = headingDeg ?? this.headingDeg;
      this.pitchDeg = Math.max(-90, Math.min(90, pitchDeg));
      return;
    }
    // Earth is about 2 degrees across: a narrower field of view shows it without changing its angular size.
    this.setFov(body === 'earth' ? 38 : DEFAULT_FOV_DEG);
    // The real direction, even straight up or down: the body is never moved and the view is not clamped short of it.
    this.glideTo(headingDeg ?? this.headingDeg, Math.max(-90, Math.min(90, pitchDeg)));
  }

  lookHeading(headingDeg: number): void {
    this.setFov(DEFAULT_FOV_DEG);
    this.glideTo(headingDeg, 4);
  }

  private setFov(fovDeg: number): void {
    this.camera.fov = fovDeg;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Direction of the most prominent relief of the measured patch as seen from the current eye point:
   * the tallest skyline or the deepest basin, whichever spans the larger angle. It only chooses where
   * the camera first looks; it reads the drawn vertices and is not a scientific score.
   */
  reliefView(): { headingDeg: number; pitchDeg: number; kind: 'ridge' | 'basin' } | null {
    const data = this.terrainData;
    if (!data) return null;
    const bins = 72;
    const top = new Float64Array(bins).fill(-90);
    const bottom = new Float64Array(bins).fill(90);
    const eye = this.eye;
    const p = data.positionsKm;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i]!;
      if (x === 0 && p[i + 1] === 0 && p[i + 2] === 0) continue; // a vertex without data
      const dx = x - eye.x, dy = p[i + 1]! - eye.y, dz = p[i + 2]! - eye.z;
      const horizontal = Math.hypot(dx, dz);
      if (horizontal < 0.4) continue;
      const elevation = Math.atan2(dy, horizontal) / DEG;
      const bin = Math.floor((((Math.atan2(dx, -dz) / DEG) + 360) % 360) / (360 / bins)) % bins;
      if (elevation > top[bin]!) top[bin] = elevation;
      if (elevation < bottom[bin]!) bottom[bin] = elevation;
    }
    let ridge = 0, basin = 0;
    for (let b = 1; b < bins; b += 1) {
      if (top[b]! > top[ridge]!) ridge = b;
      if (bottom[b]! < bottom[basin]!) basin = b;
    }
    if (top[ridge]! === -90) return null;
    const centre = (bin: number): number => (bin + 0.5) * (360 / bins);
    if (top[ridge]! >= 1.5 && top[ridge]! >= -bottom[basin]! * 0.6) return { headingDeg: centre(ridge), pitchDeg: Math.min(14, top[ridge]! * 0.45 + 1), kind: 'ridge' };
    return { headingDeg: centre(basin), pitchDeg: Math.max(-16, bottom[basin]! * 0.5), kind: 'basin' };
  }

  /** Face the most prominent measured relief. Returns false when there is no terrain to look at. */
  lookAtRelief(immediate = false): boolean {
    const view = this.reliefView();
    if (!view) return false;
    this.setFov(DEFAULT_FOV_DEG);
    if (immediate) {
      this.glide = null;
      this.headingDeg = view.headingDeg;
      this.pitchDeg = view.pitchDeg;
    } else this.glideTo(view.headingDeg, view.pitchDeg);
    return true;
  }

  /** Measurements taken from the rendered mesh itself, for checks. Nothing here feeds a displayed number. */
  probe(): SurfaceProbe {
    this.camera.updateMatrixWorld();
    const target = this.land ?? this.ground;
    target.updateMatrixWorld();
    const eye = this.camera.position.clone();
    const cast = (direction: Vector3): number | null => {
      this.raycaster.set(eye, direction);
      this.raycaster.near = 0;
      this.raycaster.far = Infinity;
      const hit = this.raycaster.intersectObject(target, false)[0];
      return hit ? hit.distance : null;
    };
    const down = cast(new Vector3(0, -1, 0));
    const ray = (body: SurfaceBody): boolean | null => (this.directions[body] ? cast(this.directions[body]) !== null : null);
    return {
      model: this.land ? 'terrain' : 'sphere',
      eyeClearanceM: down === null ? null : down * 1000,
      cameraLocalM: [eye.x * 1000, eye.y * 1000, eye.z * 1000],
      headingDeg: this.headingDeg,
      pitchDeg: this.pitchDeg,
      fovDeg: this.camera.fov,
      centreRayHitsMesh: { sun: ray('sun'), earth: ray('earth') },
      bodyDrawn: { sun: this.sunDisc.visible, earth: this.earth.visible },
      pressedKeys: this.pressed.size,
      pointerLocked: document.pointerLockElement === this.renderer.domElement,
      contextHides: { ...this.contextHides },
      external: this.externalPose !== null,
      surroundings: this.surroundings.length,
      skyState: this.starSky.state,
      earthState: this.earthBody.state,
      sunDiscDeg: 2 * Math.atan((this.sunDisc.scale.x * SUN_DISC_FILL) / 2 / BODY_DISTANCE_KM) / DEG,
      earthDiscDeg: 2 * Math.asin(Math.min(1, this.earth.scale.x / (BODY_DISTANCE_KM * 1.1))) / DEG,
    };
  }

  private glideTo(headingDeg: number, pitchDeg: number): void {
    const delta = ((headingDeg - this.headingDeg + 540) % 360) - 180;
    this.glide = { fromH: this.headingDeg, toH: this.headingDeg + delta, fromP: this.pitchDeg, toP: pitchDeg, start: performance.now() };
  }

  private setBodiesVisible(visible: boolean): void {
    for (const node of [this.sunDisc, this.sunGlow, this.sunLabel, this.earth, this.earthLabel]) node.visible = visible;
    if (!visible) {
      this.pointers.sun.hidden = true;
      this.pointers.earth.hidden = true;
    }
  }

  private bindPointer(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.dragging = true;
      this.glide = null;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (document.pointerLockElement === canvas) return;
      if (!this.dragging) return;
      const degPerPx = this.camera.fov / Math.max(1, this.host.clientHeight);
      this.headingDeg = (this.headingDeg - (event.clientX - this.lastX) * degPerPx + 360) % 360;
      this.pitchDeg = Math.max(-80, Math.min(89, this.pitchDeg + (event.clientY - this.lastY) * degPerPx));
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    });
    const end = (event: PointerEvent): void => {
      this.dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.camera.fov = Math.max(12, Math.min(95, this.camera.fov * (event.deltaY > 0 ? 1.1 : 1 / 1.1)));
      this.camera.updateProjectionMatrix();
    }, { passive: false });
    document.addEventListener('mousemove', (event) => {
      if (!this.active || document.pointerLockElement !== canvas) return;
      this.glide = null;
      this.headingDeg = (this.headingDeg + event.movementX * 0.1 + 360) % 360;
      this.pitchDeg = Math.max(-85, Math.min(88, this.pitchDeg - event.movementY * 0.1));
    });
    document.addEventListener('pointerlockerror', () => this.lockHandler?.(false));
    document.addEventListener('pointerlockchange', () => {
      this.pressed.clear(); this.dragging = false;
      this.lockHandler?.(document.pointerLockElement === canvas);
    });
    document.addEventListener('keydown', (event) => {
      if (!this.active || !this.walking || document.body.dataset['analysis'] === 'open' || document.querySelector('dialog[open]')) return;
      // Buttons and the eye-height slider do not use letters, so walking keeps working after pressing one.
      const target = event.target as HTMLElement | null;
      const typing = target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && target.type !== 'range');
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
        event.preventDefault(); this.pressed.add(event.code);
      }
      if (event.code === 'Escape') this.releaseMouse();
    });
    document.addEventListener('keyup', (event) => this.pressed.delete(event.code));
    window.addEventListener('blur', () => { this.pressed.clear(); this.dragging = false; });
  }

  private localToBody(v: Vector3, frame: Site): Vec3 {
    return localSceneToBody(v,frame.latDeg,frame.lonDeg);
  }

  private advanceWalk(now: number): void {
    const dt = this.lastFrameAt ? Math.min(0.05, (now - this.lastFrameAt) / 1000) : 0;
    this.lastFrameAt = now;
    const walk = this.walking;
    if (!walk || !dt || !this.pressed.size) return;
    let forward = Number(this.pressed.has('KeyW')) - Number(this.pressed.has('KeyS'));
    let right = Number(this.pressed.has('KeyD')) - Number(this.pressed.has('KeyA'));
    const length = Math.hypot(forward, right);
    if (!length) return;
    forward /= length; right /= length;
    const heading = this.headingDeg * DEG;
    const speed = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight') ? FAST_SPEED_MPS : WALK_SPEED_MPS;
    const local = new Vector3(Math.sin(heading) * forward + Math.cos(heading) * right, 0, -Math.cos(heading) * forward + Math.sin(heading) * right).multiplyScalar(speed * dt);
    const delta = this.localToBody(local, walk.frame);
    const position = walk.current.positionBodyM.map((v, i) => v + delta[i]!) as Vec3;
    const site = bodyToLatLon(position);
    const next = sampleTerrainWalk(walk.patch, site.latDeg, site.lonDeg, walk.heightM);
    const boundary = !next || next.coverageMarginM < WALK_MARGIN_M;
    if (next && !boundary) {
      walk.current = next;
      this.currentSite = next.site;
      this.placeWalker(next);
    }
    if (now - this.lastPositionReport > 120) {
      this.lastPositionReport = now;
      this.positionHandler?.(walk.current, boundary);
    }
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private frame(now: number): void {
    if (!this.externalPose) this.advanceWalk(now);
    else this.lastFrameAt = now;
    if (this.glide) {
      const t = Math.min(1, (now - this.glide.start) / 700);
      const e = 1 - (1 - t) ** 3;
      this.headingDeg = (this.glide.fromH + (this.glide.toH - this.glide.fromH) * e + 720) % 360;
      this.pitchDeg = this.glide.fromP + (this.glide.toP - this.glide.fromP) * e;
      if (t >= 1) this.glide = null;
    }
    const forward = headingPitchToLocal(this.headingDeg, this.pitchDeg);
    const external = this.externalPose;
    if (external) {
      // A descent or ascent: the same pose the Orbit renderer is drawing, in this scene's units.
      this.camera.position.set(external.position[0] / 1000, external.position[1] / 1000, external.position[2] / 1000);
      this.camera.up.set(external.up[0], external.up[1], external.up[2]);
      this.camera.lookAt(this.camera.position.clone().add(new Vector3(external.forward[0], external.forward[1], external.forward[2])));
      if (this.camera.fov !== external.fovDeg) this.setFov(external.fovDeg);
    } else {
      this.camera.position.copy(this.eye);
      // Near the zenith or nadir "up" on screen is taken from the heading, which keeps the view stable there.
      if (Math.abs(this.pitchDeg) > 88.5) headingPitchToLocal(this.headingDeg, 0, this.camera.up).multiplyScalar(this.pitchDeg > 0 ? -1 : 1);
      else this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.camera.position.clone().add(forward));
    }
    this.camera.updateMatrixWorld();
    this.fitShadows(false);
    this.sky.position.copy(this.camera.position);
    // The sky is infinitely far: it moves with the camera (no parallax) and never turns with it.
    this.starSky.group.matrix.copy(this.skyRotation).setPosition(this.camera.position);
    this.starSky.group.matrixWorldNeedsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    this.updatePointer('sun', 'Sun');
    this.updatePointer('earth', 'Earth');
    // During the flight the camera follows the shared pose, not the arrival heading.
    const actualForward = external ? new Vector3(...external.forward) : forward;
    let currentView = localToHeadingPitch(actualForward);
    if (this.walking && this.currentSite) {
      const body = this.localToBody(actualForward, this.walking.frame);
      currentView = localToHeadingPitch(bodyToLocalScene(body, this.currentSite.latDeg, this.currentSite.lonDeg));
    }
    this.viewHandler?.({ ...currentView, fovDeg: this.camera.fov });
  }

  /** DOM marker: an edge arrow when the body is off screen, a ghost label when the ground hides it. */
  private updatePointer(body: SurfaceBody, name: string): void {
    const node = this.pointers[body];
    const direction = this.directions[body];
    if (!direction) {
      node.hidden = true;
      return;
    }
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const view = direction.clone().transformDirection(this.camera.matrixWorldInverse);
    const projected = this.camera.position.clone().add(direction.clone().multiplyScalar(BODY_DISTANCE_KM)).project(this.camera);
    const inFront = view.z < 0;
    const onScreen = inFront && Math.abs(projected.x) < 0.94 && Math.abs(projected.y) < 0.9;
    const ghost = this.ghost[body] ?? (this.contextHides[body] ? 'behind visual terrain' : null);
    node.title = this.contextHides[body] && this.ghost[body] === null
      ? 'Hidden by the coarse visual terrain. This is not a confirmed scientific horizon result.'
      : ghost ?? name;
    if (this.externalPose) { node.hidden = true; return; }
    if (onScreen) {
      if (ghost === null) {
        node.hidden = true;
        return;
      }
      node.hidden = false;
      node.dataset['mode'] = 'ghost';
      node.textContent = `${name} — ${ghost}`;
      node.style.left = `${Math.max(node.offsetWidth / 2 + 8, Math.min(width - node.offsetWidth / 2 - 8, ((projected.x + 1) / 2) * width))}px`;
      node.style.top = `${Math.max(36, Math.min(height - 36, ((1 - projected.y) / 2) * height))}px`;
      return;
    }
    const angle = Math.atan2(view.y, view.x);
    const reach = Math.min((width / 2 - 70) / Math.max(1e-6, Math.abs(Math.cos(angle))), (height / 2 - 34) / Math.max(1e-6, Math.abs(Math.sin(angle))));
    node.hidden = false;
    node.dataset['mode'] = 'edge';
    const arrow = Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle)) ? (Math.cos(angle) > 0 ? '→' : '←') : Math.sin(angle) > 0 ? '↑' : '↓';
    node.textContent = `${arrow} ${name}${ghost === null ? '' : ` (${ghost})`}`;
    node.style.left = `${Math.max(node.offsetWidth / 2 + 8, Math.min(width - node.offsetWidth / 2 - 8, width / 2 + Math.cos(angle) * reach))}px`;
    node.style.top = `${height / 2 - Math.sin(angle) * reach}px`;
  }
}
