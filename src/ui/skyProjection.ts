/**
 * Schematic local-sky projection (presentation only).
 * Horizontal axis: azimuth 0..360°, north = 0°, east = 90°.
 * Vertical axis: altitude −90..+90° on a SQUARE-ROOT scale that enlarges the
 * region near the horizon (polar sites keep the Sun within a few degrees of it).
 */
export const ALTITUDE_GRID_DEG = [-90, -30, -5, 0, 5, 30, 90] as const;

/** Altitude in degrees -> −1 (nadir) .. 0 (horizon) .. +1 (zenith). */
export function altitudeToUnit(altDeg: number): number {
  const clamped = Math.min(90, Math.max(-90, altDeg));
  return Math.sign(clamped) * Math.sqrt(Math.abs(clamped) / 90);
}

/** Azimuth in degrees -> 0 (north) .. 1 (north again), wrapped into [0, 1). */
export function azimuthToUnit(azDeg: number): number {
  return (((azDeg % 360) + 360) % 360) / 360;
}
