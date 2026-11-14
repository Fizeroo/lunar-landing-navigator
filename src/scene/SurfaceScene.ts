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
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Observation, Vec3 } from '../contracts';
import { bodyToLocalScene, headingPitchToLocal, localToHeadingPitch } from './coords';

/** Scene units are kilometres; the camera stands at the origin of a local east/up/south frame. */
const MOON_RADIUS_KM = 1737.4;
const BODY_DISTANCE_KM = 3000;
const HORIZON_RING_KM = 6000;
/** Smallest camera eye height used for display, so the camera never sits inside the ground. */
export const MIN_EYE_HEIGHT_M = 2;
const DEG = Math.PI / 180;

export type SurfaceBody = 'sun' | 'earth';

export interface SurfaceView {
  headingDeg: number | null;
  pitchDeg: number;
  fovDeg: number;
}

export interface SurfaceInput {
  observation: Observation;
  latDeg: number;
  lonDeg: number;
  /** Scientific observer height above the reference sphere, metres. */
  observerHeightM: number;
  /** False at an exact pole, where compass directions do not exist. */
  compassDefined: boolean;
  /** True when the whole disc is below the visible smooth-sphere horizon (from the science module). */
  hidden: Record<SurfaceBody, boolean>;
  hiddenReason?: Record<SurfaceBody,string>;
}

function discTexture(inner: string, outer: string, hardEdge: number): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(hardEdge, inner);
    gradient.addColorStop(Math.min(1, hardEdge + 0.02), outer);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
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
  private readonly camera = new PerspectiveCamera(65, 1, 0.0002, 30000);
  private readonly sunLight = new DirectionalLight(0xffffff, 3.2);
  private readonly ambient = new AmbientLight(0xffffff, 0.07);
  private readonly ground: Mesh<BufferGeometry, MeshStandardMaterial>;
  private readonly sky = new Group();
  private readonly compass = new Group();
  private readonly sunDisc: Sprite;
  private readonly sunGlow: Sprite;
  private readonly sunLabel: Sprite;
  private readonly earth: Mesh<SphereGeometry, MeshStandardMaterial>;
  private readonly earthLabel: Sprite;
  private readonly pointers: Record<SurfaceBody, HTMLDivElement>;
  private readonly directions: Record<SurfaceBody, Vector3 | null> = { sun: null, earth: null };
  private readonly hidden: Record<SurfaceBody, boolean> = { sun: false, earth: false };
  private reasons:Record<SurfaceBody,string>={sun:'Below smooth-sphere horizon',earth:'Below smooth-sphere horizon'};
  private readonly host: HTMLElement;
  private headingDeg = 0;
  private pitchDeg = 4;
  private eyeKm = MIN_EYE_HEIGHT_M / 1000;
  private active = false;
  private terrainMesh: Mesh<BufferGeometry, MeshStandardMaterial> | null = null;
  private terrainBoundary: LineLoop | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private glide: { fromH: number; toH: number; fromP: number; toP: number; start: number } | null = null;
  private viewHandler: ((view: SurfaceView) => void) | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', 'Surface view from the selected site. Drag to look around; scroll to zoom.');
    this.scene.background = new Color(0x020308);

    this.ground = new Mesh(buildGround(), new MeshStandardMaterial({ color: 0x9b978f, roughness: 1, metalness: 0 }));
    this.scene.add(this.ground, this.sunLight, this.sunLight.target, this.ambient);

    // Display aids on the smooth ground: range rings and a line toward north.
    for (const [distance, opacity] of [[0.01, 0.5], [0.1, 0.45], [1, 0.4], [10, 0.35], [100, 0.3]] as const) {
      this.scene.add(groundRing(distance, 0xdfe6f2, opacity));
    }

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
      const label = textSprite(letter, az === 0 ? '#ff9d8a' : '#cfe6ff', HORIZON_RING_KM * 0.045);
      label.position.copy(headingPitchToLocal(az, 3.2)).multiplyScalar(HORIZON_RING_KM);
      this.compass.add(label);
    }
    this.sky.add(this.compass);
    this.scene.add(this.sky);

    this.sunDisc = new Sprite(new SpriteMaterial({ map: discTexture('#fff6d8', '#ffe9a8', 0.94), transparent: true, depthWrite: false }));
    this.sunGlow = new Sprite(new SpriteMaterial({ map: discTexture('rgba(255,220,130,0.55)', 'rgba(255,200,90,0.28)', 0.08), transparent: true, depthWrite: false }));
    this.sunLabel = textSprite('Sun', '#ffc94a', BODY_DISTANCE_KM * 0.035);
    this.earth = new Mesh(new SphereGeometry(1, 48, 24), new MeshStandardMaterial({ color: 0x3f7fd8, roughness: 0.9, metalness: 0, emissive: 0x0a1c3a, emissiveIntensity: 0.6 }));
    this.earthLabel = textSprite('Earth', '#5aa9ff', BODY_DISTANCE_KM * 0.035);
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

    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.setBodiesVisible(false);
  }

  onView(handler: (view: SurfaceView) => void): void {
    this.viewHandler = handler;
  }

  /** Start or stop rendering (the canvas is hidden by the page when inactive). */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.renderer.setAnimationLoop(active ? (time) => this.frame(time) : null);
    if (active) this.resize();
  }

  /** Camera eye height actually used for display, metres. */
  get eyeHeightM(): number {
    return this.eyeKm * 1000;
  }

  /** Actual source XYZ vertices, translated before Float32 conversion; no invented edge walls. */
  setTerrain(input: { rows:number; cols:number; positionsM:Float64Array; originM:Vec3; latDeg:number; lonDeg:number } | null):void {
    if(this.terrainMesh){this.scene.remove(this.terrainMesh);this.terrainMesh.geometry.dispose();this.terrainMesh.material.dispose();this.terrainMesh=null;}
    if(this.terrainBoundary){this.scene.remove(this.terrainBoundary);this.terrainBoundary.geometry.dispose();this.terrainBoundary=null;}
    this.ground.visible=!input;
    if(!input)return;
    const vertices:number[]=[], indices:number[]=[];
    for(let i=0;i<input.rows*input.cols;i++){
      const d:Vec3=[input.positionsM[i*3]!-input.originM[0],input.positionsM[i*3+1]!-input.originM[1],input.positionsM[i*3+2]!-input.originM[2]];
      const local=bodyToLocalScene(d,input.latDeg,input.lonDeg).multiplyScalar(.001);
      vertices.push(local.x,local.y,local.z);
    }
    for(let r=0;r<input.rows-1;r++)for(let c=0;c<input.cols-1;c++){
      const a=r*input.cols+c,b=a+1,d=(r+1)*input.cols+c+1,c0=d-1;
      if([a,b,c0,d].every(i=>Number.isFinite(vertices[i*3])))indices.push(a,b,d,a,d,c0);
    }
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    this.terrainMesh=new Mesh(geometry,new MeshStandardMaterial({color:0x737b83,roughness:1,side:DoubleSide}));
    this.terrainMesh.castShadow=false;this.terrainMesh.receiveShadow=false;this.scene.add(this.terrainMesh);
    const edge:number[]=[];
    const add=(r:number,c:number)=>{const i=(r*input.cols+c)*3;edge.push(vertices[i]!,vertices[i+1]!+.0005,vertices[i+2]!);};
    for(let c=0;c<input.cols;c++)add(0,c);for(let r=1;r<input.rows;r++)add(r,input.cols-1);for(let c=input.cols-2;c>=0;c--)add(input.rows-1,c);for(let r=input.rows-2;r>0;r--)add(r,0);
    const boundary=new BufferGeometry();boundary.setAttribute('position',new Float32BufferAttribute(edge,3));
    this.terrainBoundary=new LineLoop(boundary,new LineBasicMaterial({color:0xf4ba63}));this.scene.add(this.terrainBoundary);
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
    this.eyeKm = Math.max(input.observerHeightM, MIN_EYE_HEIGHT_M) / 1000;
    this.camera.position.set(0, this.eyeKm, 0);
    this.sky.position.copy(this.camera.position);
    this.compass.visible = input.compassDefined;
    this.hidden.sun = input.hidden.sun;
    this.hidden.earth = input.hidden.earth;
    this.reasons=input.hiddenReason??{sun:'Below smooth-sphere horizon',earth:'Below smooth-sphere horizon'};

    const sun = bodyToLocalScene(observation.sun.direction, latDeg, lonDeg).normalize();
    const earth = bodyToLocalScene(observation.earth.direction, latDeg, lonDeg).normalize();
    this.directions.sun = sun;
    this.directions.earth = earth;
    this.setBodiesVisible(true);

    const sunRadius = BODY_DISTANCE_KM * Math.tan(observation.sun.angularRadiusDeg * DEG);
    this.sunDisc.position.copy(sun).multiplyScalar(BODY_DISTANCE_KM).add(this.camera.position);
    this.sunDisc.scale.setScalar(2 * sunRadius);
    this.sunGlow.position.copy(this.sunDisc.position);
    this.sunGlow.scale.setScalar(2 * sunRadius * 9);
    this.sunLabel.position.copy(headingPitchToLocal(0, 0).copy(sun)).multiplyScalar(BODY_DISTANCE_KM).add(this.camera.position);
    this.sunLabel.position.y += sunRadius + BODY_DISTANCE_KM * 0.03;

    const earthDistance = BODY_DISTANCE_KM * 1.1;
    const earthRadius = earthDistance * Math.sin(observation.earth.angularRadiusDeg * DEG);
    this.earth.position.copy(earth).multiplyScalar(earthDistance).add(this.camera.position);
    this.earth.scale.setScalar(earthRadius);
    this.earthLabel.position.copy(this.earth.position);
    this.earthLabel.position.y += earthRadius + BODY_DISTANCE_KM * 0.03;

    this.sunLight.visible = true;
    this.sunLight.position.copy(sun).multiplyScalar(100);
    this.sunLight.target.position.set(0, 0, 0);
  }

  /** Turn the camera toward a body along its real direction (it may be below the horizon). */
  lookAt(body: SurfaceBody): void {
    const direction = this.directions[body];
    if (!direction) return;
    const { headingDeg, pitchDeg } = localToHeadingPitch(direction);
    this.glideTo(headingDeg ?? this.headingDeg, Math.max(-70, Math.min(85, pitchDeg)));
  }

  lookHeading(headingDeg: number): void {
    this.glideTo(headingDeg, 4);
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
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private frame(now: number): void {
    if (this.glide) {
      const t = Math.min(1, (now - this.glide.start) / 700);
      const e = 1 - (1 - t) ** 3;
      this.headingDeg = (this.glide.fromH + (this.glide.toH - this.glide.fromH) * e + 720) % 360;
      this.pitchDeg = this.glide.fromP + (this.glide.toP - this.glide.fromP) * e;
      if (t >= 1) this.glide = null;
    }
    const forward = headingPitchToLocal(this.headingDeg, this.pitchDeg);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camera.position.clone().add(forward));
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
    this.updatePointer('sun', 'Sun');
    this.updatePointer('earth', 'Earth');
    this.viewHandler?.({ headingDeg: Math.abs(this.pitchDeg) > 88.5 ? null : this.headingDeg, pitchDeg: this.pitchDeg, fovDeg: this.camera.fov });
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
    if (onScreen) {
      if (!this.hidden[body]) {
        node.hidden = true;
        return;
      }
      node.hidden = false;
      node.dataset['mode'] = 'ghost';
      node.textContent = `${name} — ${this.reasons[body]}`;
      node.style.left = `${((projected.x + 1) / 2) * width}px`;
      node.style.top = `${((1 - projected.y) / 2) * height}px`;
      return;
    }
    const angle = Math.atan2(view.y, view.x);
    const reach = Math.min((width / 2 - 70) / Math.max(1e-6, Math.abs(Math.cos(angle))), (height / 2 - 34) / Math.max(1e-6, Math.abs(Math.sin(angle))));
    node.hidden = false;
    node.dataset['mode'] = 'edge';
    const arrow = Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle)) ? (Math.cos(angle) > 0 ? '→' : '←') : Math.sin(angle) > 0 ? '↑' : '↓';
    node.textContent = `${arrow} ${name}${this.hidden[body] ? ` (${this.reasons[body]})` : ''}`;
    node.style.left = `${width / 2 + Math.cos(angle) * reach}px`;
    node.style.top = `${height / 2 - Math.sin(angle) * reach}px`;
  }
}
