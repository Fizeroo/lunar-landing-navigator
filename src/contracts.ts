/** Canonical boundary. Astronomy is computed in src/science, never in the renderer. */
export type Vec3 = [number, number, number];
export type Condition = 'sun' | 'earth' | 'both';
export interface TimeInterval { startEt: number; endEt: number }
export interface ConditionSummary {
  intervals: TimeInterval[];
  totalSeconds: number;
  fraction: number;
  longestSeconds: number;
}
export interface SiteAnalysis {
  site: Site;
  period: TimeInterval;
  sun: ConditionSummary;
  earth: ConditionSummary;
  both: ConditionSummary;
}
export interface Site {
  latDeg: number;
  lonDeg: number;
  heightAboveReferenceSphereM: number;
}
export interface EphemerisSample {
  utc: string;
  et: number;
  sunM: Vec3;
  earthM: Vec3;
}
export interface EphemerisData {
  schemaVersion: '1.0';
  id: string;
  model: {
    frame: 'MOON_ME_DE440_ME421';
    originNaifId: 301;
    abcorr: 'NONE';
    units: 'm';
    referenceRadiusM: 1737400;
    sunRadiusM: number;
    earthRadiusM: number;
    horizon: 'reference-tangent-h0';
  };
  coverage: { startUtc: string; endUtc: string; startEt: number; endEt: number };
  provenance: Record<string, unknown>;
  samples: EphemerisSample[];
}
export interface BodyObservation {
  azDeg: number | null;
  altDeg: number;
  /** Surface-site to target unit vector, expressed in the lunar body-fixed frame (not ENU). */
  direction: Vec3;
  distanceM: number;
  angularRadiusDeg: number;
  centerAboveReferenceHorizon: boolean;
  diskState: 'none' | 'partial' | 'full';
}
export interface Observation {
  et: number;
  utc: string;
  site: Site;
  sun: BodyObservation;
  earth: BodyObservation;
  /** Moon-center to target unit vectors in the same body-fixed frame, for globe rendering. */
  sunDirectionBody: Vec3;
  earthDirectionBody: Vec3;
}
