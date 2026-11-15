/**
 * One camera path between an Orbit pose and the eye-level pose at a site, as pure numbers.
 * Both renderers are driven from this same pose during a descent or an ascent, so the hand-over
 * between them is a dissolve between two pictures of the same view, never a cover-up.
 *
 * Frame: the site's local frame in metres, origin on the site's ground point,
 * x = east, y = up (radial), z = south. Presentation only; no astronomy here.
 */
export type Triple = [number, number, number];

export interface CameraPose {
  position: Triple;
  /** Unit view direction. */
  forward: Triple;
  /** Approximate screen-up; the renderer orthogonalises it against `forward`. */
  up: Triple;
  fovDeg: number;
}

const add = (a: Triple, b: Triple): Triple => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Triple, b: Triple): Triple => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Triple, s: number): Triple => [a[0] * s, a[1] * s, a[2] * s];
const length = (a: Triple): number => Math.hypot(a[0], a[1], a[2]);
const dot = (a: Triple, b: Triple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Triple): Triple => { const n = length(a); return n > 1e-12 ? scale(a, 1 / n) : [0, 1, 0]; };
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Spherical interpolation between unit vectors (falls back to a normalised blend when nearly opposite or equal). */
function slerp(a: Triple, b: Triple, t: number): Triple {
  const cosine = Math.min(1, Math.max(-1, dot(a, b)));
  const angle = Math.acos(cosine);
  if (angle < 1e-6 || angle > Math.PI - 1e-4) return unit(add(scale(a, 1 - t), scale(b, t)));
  const s = Math.sin(angle);
  return add(scale(a, Math.sin((1 - t) * angle) / s), scale(b, Math.sin(t * angle) / s));
}

/** Distance scale below which the approach stops being logarithmic and eases linearly onto the eye point. */
const SOFT_LANDING_M = 40;
/** Elevation of the final approach above the local horizontal, from behind the arrival heading. */
const APPROACH_ELEVATION_DEG = 32;
/** Never closer to the Moon's centre than this far above the site's ground radius while still far from the site. */
const FAR_CLEARANCE_M = 3000;
const FAR_DISTANCE_M = 25000;

/**
 * Pose at progress t in [0, 1]: t = 0 is `orbit`, t = 1 is `eye`. The same function serves the ascent
 * with t running backwards, and a reversal at any moment simply turns t around.
 * `groundRadiusM` is the distance of the site's ground point from the Moon's centre.
 */
export function poseAlongDescent(orbit: CameraPose, eye: CameraPose, groundRadiusM: number, t: number): CameraPose {
  const e = t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10); // smootherstep: zero speed at both ends
  const offset = sub(orbit.position, eye.position);
  const startDistance = Math.max(length(offset), 1e-3);
  const startDirection = unit(offset);
  const heading = unit([eye.forward[0], 0, eye.forward[2]]);
  const horizontal = Math.hypot(eye.forward[0], eye.forward[2]) > 1e-6 ? heading : ([0, 0, -1] as Triple);
  const elevation = APPROACH_ELEVATION_DEG * Math.PI / 180;
  const approach = unit(add(scale(horizontal, -Math.cos(elevation)), [0, Math.sin(elevation), 0]));
  // Direction settles early, while still far away, so the close part of the path is a clean glide down.
  const direction = slerp(startDirection, approach, smooth(0, 0.5, e));
  const distance = Math.pow(startDistance + SOFT_LANDING_M, 1 - e) * Math.pow(SOFT_LANDING_M, e) - SOFT_LANDING_M;
  let position = add(eye.position, scale(direction, Math.max(0, distance)));
  if (distance > FAR_DISTANCE_M) {
    // Keep clear of the Moon's bulk while far out (the local frame's origin is `groundRadiusM` above the centre).
    const fromCentre: Triple = [position[0], position[1] + groundRadiusM, position[2]];
    const radius = length(fromCentre);
    const minimum = groundRadiusM + FAR_CLEARANCE_M;
    if (radius < minimum) {
      const lifted = scale(fromCentre, minimum / radius);
      position = [lifted[0], lifted[1] - groundRadiusM, lifted[2]];
    }
  }
  const toSite = unit(sub(eye.position, position));
  let forward = distance > 1e-3 ? slerp(toSite, eye.forward, smooth(0.5, 1, e)) : eye.forward;
  forward = slerp(forward, orbit.forward, 1 - smooth(0, 0.22, e));
  const arriving = smooth(0.55, 1, e);
  let up = unit(add(scale(horizontal, 1 - arriving), scale(eye.up, arriving)));
  up = slerp(up, unit(orbit.up), 1 - smooth(0, 0.3, e));
  return { position, forward: unit(forward), up, fovDeg: orbit.fovDeg + (eye.fovDeg - orbit.fovDeg) * e };
}

/** Distance from the eye point, used to decide which renderer shows the pose. */
export function distanceFromEye(pose: CameraPose, eye: CameraPose): number {
  return length(sub(pose.position, eye.position));
}

/**
 * Share of the picture taken from the first-person renderer at a given distance from the eye point:
 * 0 far away (Orbit renderer only), 1 close (first-person only), a logarithmic dissolve in between.
 */
export function surfaceShare(distanceM: number, farM: number, nearM: number): number {
  if (distanceM >= farM) return 0;
  if (distanceM <= nearM) return 1;
  return smooth(0, 1, Math.log(farM / distanceM) / Math.log(farM / nearM));
}
