/**
 * Preset reference points. Coordinates are feature-centre values copied from the
 * IAU/USGS Gazetteer of Planetary Nomenclature (retrieved 2026-11-14; listed as
 * +East, -180..180; latitude on the 1737.4 km sphere). They are ILLUSTRATIVE
 * reference points for comparing geometry, not designated landing sites.
 */
export interface Preset {
  id: string;
  name: string;
  latDeg: number;
  lonDeg: number;
  kind: string;
  sourceUrl: string;
}

const gazetteer = (featureId: number): string => `https://planetarynames.wr.usgs.gov/Feature/${featureId}`;

export const PRESETS: readonly Preset[] = [
  { id: 'shackleton', name: 'Shackleton', latDeg: -89.67, lonDeg: 129.78, kind: 'crater centre', sourceUrl: gazetteer(5450) },
  { id: 'de-gerlache', name: 'de Gerlache', latDeg: -88.48, lonDeg: -88.34, kind: 'crater centre', sourceUrl: gazetteer(1439) },
  { id: 'slater', name: 'Slater', latDeg: -88.08, lonDeg: 111.29, kind: 'crater centre', sourceUrl: gazetteer(15325) },
  { id: 'nobile', name: 'Nobile', latDeg: -85.28, lonDeg: 53.27, kind: 'crater centre', sourceUrl: gazetteer(4321) },
  { id: 'malapert', name: 'Malapert', latDeg: -85.0, lonDeg: 11.4, kind: 'crater centre', sourceUrl: gazetteer(3603) },
  { id: 'mons-mouton', name: 'Mons Mouton', latDeg: -84.6, lonDeg: 31.0, kind: 'mountain centre', sourceUrl: gazetteer(16070) },
  { id: 'shiv-shakti', name: 'Statio Shiv Shakti', latDeg: -69.37, lonDeg: 32.32, kind: 'Chandrayaan-3 landing site name', sourceUrl: gazetteer(16272) },
  { id: 'tranquillitatis', name: 'Statio Tranquillitatis', latDeg: 0.67, lonDeg: 23.47, kind: 'Apollo 11 landing site name', sourceUrl: gazetteer(5684) },
];

export const ARTEMIS_REGIONS_URL = 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/';

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
