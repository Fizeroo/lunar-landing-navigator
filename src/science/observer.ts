import type { BodyObservation, EphemerisData, Observation, Site, SiteAnalysis, TimeInterval, Vec3 } from '../contracts.ts';
import { observeAt } from './index.ts';
import { analyzeSite } from './intervals.ts';

const DEG = 180 / Math.PI;

export function sphereHorizonDipDeg(heightM: number): number {
  if (!Number.isFinite(heightM) || heightM < 0 || heightM > 10000) throw new RangeError('Observer height must be between 0 and 10000 m');
  const radius = 1737400;
  return Math.acos(radius / (radius + heightM)) * DEG;
}

export function observeObserver(data: EphemerisData, et: number, site: Site, heightM: number): Observation {
  sphereHorizonDipDeg(heightM);
  if (!site || !Number.isFinite(site.latDeg) || site.latDeg < -90 || site.latDeg > 90 ||
      !Number.isFinite(site.lonDeg) || site.lonDeg < -180 || site.lonDeg >= 180 ||
      site.heightAboveReferenceSphereM !== 0) {
    throw new RangeError('Site must use valid planetocentric coordinates and h=0; observer height is a separate argument');
  }
  const baseSite = { ...site, heightAboveReferenceSphereM: 0 };
  const base = observeAt(data, et, baseSite);
  const phi = site.latDeg * Math.PI / 180, lambda = site.lonDeg * Math.PI / 180;
  const radial: Vec3 = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  const east: Vec3 = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north: Vec3 = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const body = (source: BodyObservation, radius: number): BodyObservation => {
    const distance = source.distanceM;
    const moonPosition = source.direction.map((v, i) => v * distance + data.model.referenceRadiusM * radial[i]!) as Vec3;
    const d = moonPosition.map((v, i) => v - (data.model.referenceRadiusM + heightM) * radial[i]!) as Vec3;
    const distanceM = Math.hypot(...d), direction = d.map(v => v / distanceM) as Vec3;
    const up = direction.reduce((sum, v, i) => sum + v * radial[i]!, 0);
    const e = direction.reduce((sum, v, i) => sum + v * east[i]!, 0);
    const n = direction.reduce((sum, v, i) => sum + v * north[i]!, 0);
    const horizontal = Math.hypot(e, n);
    const altDeg = Math.atan2(up, horizontal) * DEG;
    const azDeg = Math.abs(site.latDeg) === 90 || horizontal < 1e-12 ? null : ((Math.atan2(e, n) * DEG) % 360 + 360) % 360;
    const angularRadiusDeg = Math.asin(radius / distanceM) * DEG;
    return { ...source, azDeg, distanceM, direction, altDeg, angularRadiusDeg,
      centerAboveReferenceHorizon: altDeg > 0,
      diskState: altDeg + angularRadiusDeg <= 0 ? 'none' : altDeg - angularRadiusDeg >= 0 ? 'full' : 'partial' };
  };
  return { ...base, site: { ...site, heightAboveReferenceSphereM: heightM }, sun: body(base.sun, data.model.sunRadiusM), earth: body(base.earth, data.model.earthRadiusM) };
}

export function analyzeObserver(data: EphemerisData, site: Site, period: TimeInterval, heightM: number): SiteAnalysis {
  sphereHorizonDipDeg(heightM);
  if (site.heightAboveReferenceSphereM !== 0) throw new RangeError('Site height must be zero; observer height is a separate argument');
  const phi = site.latDeg * Math.PI / 180, lambda = site.lonDeg * Math.PI / 180;
  const radial: Vec3 = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  // Shifting every radial target component by h preserves linearity on each segment,
  // making the existing exact crossing solver equivalent to a displaced observer.
  const shifted: EphemerisData = { ...data, samples: data.samples.map(row => ({ ...row,
    sunM: row.sunM.map((v, i) => v - heightM * radial[i]!) as Vec3,
    earthM: row.earthM.map((v, i) => v - heightM * radial[i]!) as Vec3 })) };
  const result = analyzeSite(shifted, { ...site, heightAboveReferenceSphereM: 0 }, period);
  return { ...result, site: { ...site, heightAboveReferenceSphereM: heightM } };
}
