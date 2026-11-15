import { Vector3 } from 'three';
import type { Vec3 } from '../contracts';

/**
 * Presentation-only geometry between the lunar body-fixed frame (MOON_ME) and
 * the three.js scene. No astronomy here: this is the fixed rotation from the
 * data contract, (X,Y,Z) -> (X,Z,-Y), and its inverse (x,y,z) -> (x,-z,y).
 * The globe has radius 1 in scene units.
 */
export function bodyToScene(v: Vec3, target = new Vector3()): Vector3 {
  return target.set(v[0], v[2], -v[1]);
}

export function sceneToBody(v: Vector3): Vec3 {
  return [v.x, -v.z, v.y];
}

const DEG = Math.PI / 180;

/** Wrap an east-positive longitude into [-180, 180). */
export function normalizeLonDeg(lonDeg: number): number {
  const wrapped = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

/** Unit vector in MOON_ME for planetocentric latitude / east longitude. */
export function latLonToBodyUnit(latDeg: number, lonDeg: number): Vec3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const c = Math.cos(lat);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
}

/** Planetocentric latitude / east longitude of a body-fixed direction. */
export function bodyToLatLon(v: Vec3): { latDeg: number; lonDeg: number } {
  const [x, y, z] = v;
  const horizontal = Math.hypot(x, y);
  const latDeg = Math.atan2(z, horizontal) / DEG;
  // At the exact poles longitude is undefined; report 0 by convention.
  const lonDeg = horizontal < 1e-12 ? 0 : normalizeLonDeg(Math.atan2(y, x) / DEG);
  return { latDeg, lonDeg };
}

/**
 * Rendering-only rotation of a body-fixed direction into the local surface
 * scene at a site: x = east, y = up (radial), z = south (so north is −z).
 * This is the same east/north/up basis the science module uses; all displayed
 * numbers still come from the science module, never from this function.
 */
export function bodyToLocalScene(direction: Vec3, latDeg: number, lonDeg: number, target = new Vector3()): Vector3 {
  const phi = latDeg * DEG;
  const lambda = lonDeg * DEG;
  const [x, y, z] = direction;
  const east = -Math.sin(lambda) * x + Math.cos(lambda) * y;
  const north = -Math.sin(phi) * Math.cos(lambda) * x - Math.sin(phi) * Math.sin(lambda) * y + Math.cos(phi) * z;
  const up = Math.cos(phi) * Math.cos(lambda) * x + Math.cos(phi) * Math.sin(lambda) * y + Math.sin(phi) * z;
  return target.set(east, up, -north);
}

/** Inverse of the rendering ENU rotation. Used for walking and the moving compass. */
export function localSceneToBody(v:Vector3,latDeg:number,lonDeg:number):Vec3 {
  const p=latDeg*DEG,l=lonDeg*DEG;
  return [
    -Math.sin(l)*v.x+Math.cos(p)*Math.cos(l)*v.y+Math.sin(p)*Math.cos(l)*v.z,
    Math.cos(l)*v.x+Math.cos(p)*Math.sin(l)*v.y+Math.sin(p)*Math.sin(l)*v.z,
    Math.sin(p)*v.y-Math.cos(p)*v.z,
  ];
}

/** Unit view direction in the local surface scene for a compass heading and pitch (degrees). */
export function headingPitchToLocal(headingDeg: number, pitchDeg: number, target = new Vector3()): Vector3 {
  const h = headingDeg * DEG;
  const p = pitchDeg * DEG;
  return target.set(Math.cos(p) * Math.sin(h), Math.sin(p), -Math.cos(p) * Math.cos(h));
}

/** Compass heading [0, 360) and pitch of a local-scene direction; heading is null when looking straight up or down. */
export function localToHeadingPitch(v: Vector3): { headingDeg: number | null; pitchDeg: number } {
  const horizontal = Math.hypot(v.x, v.z);
  const pitchDeg = Math.atan2(v.y, horizontal) / DEG;
  if (horizontal < 1e-9) return { headingDeg: null, pitchDeg };
  return { headingDeg: (Math.atan2(v.x, -v.z) / DEG + 360) % 360, pitchDeg };
}
