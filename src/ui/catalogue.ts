/**
 * Site catalogue. Every coordinate is the current feature-centre value shown on
 * that feature's own page in the IAU/USGS Gazetteer of Planetary Nomenclature
 * (checked 2026-11-14; listed as +East, -180..180, on the 1737.4 km sphere).
 *
 * These are ILLUSTRATIVE reference points for comparing geometry on a smooth
 * sphere. A crater centre is usually not a place one would land, and for the
 * mission entries the point is the named feature, not a surveyed lander position.
 */
export type CatalogueGroupId = 'south-pole' | 'historical' | 'clps';

export interface CatalogueEntry {
  id: string;
  name: string;
  latDeg: number;
  lonDeg: number;
  /** What the point is, e.g. "crater centre". */
  kind: string;
  /** Short context shown in the catalogue. */
  note: string;
  group: CatalogueGroupId;
  /** Gazetteer page the coordinates were read from. */
  sourceUrl: string;
}

export interface CatalogueGroup {
  id: CatalogueGroupId;
  title: string;
  description: string;
  /** Background reading for the group (not a coordinate source). */
  contextUrl: string;
  contextLabel: string;
}

const gazetteer = (featureId: number): string => `https://planetarynames.wr.usgs.gov/Feature/${featureId}`;

export const ARTEMIS_REGIONS_URL = 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/';
export const CLPS_URL = 'https://www.nasa.gov/commercial-lunar-payload-services/';
export const GAZETTEER_URL = 'https://planetarynames.wr.usgs.gov/';

export const CATALOGUE_GROUPS: readonly CatalogueGroup[] = [
  {
    id: 'south-pole',
    title: 'South polar features',
    description: 'Named craters and mountains near the south pole. Feature centres only: NASA’s Artemis III candidate regions are named after some of these features, but NASA’s release gives no coordinates and this app does not reproduce those regions.',
    contextUrl: ARTEMIS_REGIONS_URL,
    contextLabel: 'NASA: Artemis III candidate landing regions (2024)',
  },
  {
    id: 'historical',
    title: 'Historical landing sites',
    description: 'Landing sites that have an IAU-approved name (“Statio”). The coordinate is the named feature in the gazetteer.',
    contextUrl: GAZETTEER_URL,
    contextLabel: 'IAU/USGS Gazetteer of Planetary Nomenclature',
  },
  {
    id: 'clps',
    title: 'CLPS context features',
    description: 'Named features that NASA’s Commercial Lunar Payload Services deliveries were reported to land near. These are feature centres for context, not lander positions.',
    contextUrl: CLPS_URL,
    contextLabel: 'NASA: Commercial Lunar Payload Services',
  },
];

export const CATALOGUE: readonly CatalogueEntry[] = [
  { id: 'shackleton', name: 'Shackleton', latDeg: -89.67, lonDeg: 129.78, kind: 'crater centre', note: 'Crater at the south pole', group: 'south-pole', sourceUrl: gazetteer(5450) },
  { id: 'de-gerlache', name: 'de Gerlache', latDeg: -88.48, lonDeg: -88.34, kind: 'crater centre', note: 'Crater near the pole', group: 'south-pole', sourceUrl: gazetteer(1439) },
  { id: 'shoemaker', name: 'Shoemaker', latDeg: -88.14, lonDeg: 45.91, kind: 'crater centre', note: 'Crater near the pole', group: 'south-pole', sourceUrl: gazetteer(5494) },
  { id: 'slater', name: 'Slater', latDeg: -88.08, lonDeg: 111.29, kind: 'crater centre', note: 'Crater near the pole', group: 'south-pole', sourceUrl: gazetteer(15325) },
  { id: 'faustini', name: 'Faustini', latDeg: -87.18, lonDeg: 84.31, kind: 'crater centre', note: 'Crater near the pole', group: 'south-pole', sourceUrl: gazetteer(1919) },
  { id: 'nobile', name: 'Nobile', latDeg: -85.28, lonDeg: 53.27, kind: 'crater centre', note: 'Large south polar crater', group: 'south-pole', sourceUrl: gazetteer(4321) },
  { id: 'malapert', name: 'Malapert', latDeg: -85.0, lonDeg: 11.4, kind: 'crater centre', note: 'South polar crater on the near side', group: 'south-pole', sourceUrl: gazetteer(3603) },
  { id: 'mons-mouton', name: 'Mons Mouton', latDeg: -84.6, lonDeg: 31.0, kind: 'mountain centre', note: 'Flat-topped mountain near the pole', group: 'south-pole', sourceUrl: gazetteer(16070) },
  { id: 'amundsen', name: 'Amundsen', latDeg: -84.44, lonDeg: 83.07, kind: 'crater centre', note: 'Large south polar crater', group: 'south-pole', sourceUrl: gazetteer(247) },

  { id: 'tranquillitatis', name: 'Statio Tranquillitatis', latDeg: 0.67, lonDeg: 23.47, kind: 'named landing site', note: 'Apollo 11 (1969)', group: 'historical', sourceUrl: gazetteer(5684) },
  { id: 'guang-han-gong', name: 'Guang Han Gong', latDeg: 44.12, lonDeg: -19.51, kind: 'named landing site', note: 'Chang’e-3 (2013)', group: 'historical', sourceUrl: gazetteer(15415) },
  { id: 'tianhe', name: 'Statio Tianhe', latDeg: -45.45, lonDeg: 177.6, kind: 'named landing site', note: 'Chang’e-4 (2019), far side', group: 'historical', sourceUrl: gazetteer(15781) },
  { id: 'tianchuan', name: 'Statio Tianchuan', latDeg: 43.06, lonDeg: -51.92, kind: 'named landing site', note: 'Chang’e-5 (2020)', group: 'historical', sourceUrl: gazetteer(15994) },
  { id: 'shiv-shakti', name: 'Statio Shiv Shakti', latDeg: -69.37, lonDeg: 32.32, kind: 'named landing site', note: 'Chandrayaan-3 (2023)', group: 'historical', sourceUrl: gazetteer(16272) },
  { id: 'tianjiang', name: 'Statio Tianjiang', latDeg: -41.63, lonDeg: -153.98, kind: 'named landing site', note: 'Chang’e-6 (2024), far side', group: 'historical', sourceUrl: gazetteer(16328) },

  { id: 'malapert-a', name: 'Malapert A', latDeg: -80.18, lonDeg: -3.79, kind: 'crater centre', note: 'Near the IM-1 landing area (2024)', group: 'clps', sourceUrl: gazetteer(11081) },
  { id: 'mons-latreille', name: 'Mons Latreille', latDeg: 18.47, lonDeg: 61.92, kind: 'mountain centre', note: 'Near the Blue Ghost Mission 1 landing area (2025)', group: 'clps', sourceUrl: gazetteer(15996) },
];

export function findCatalogueEntry(id: string): CatalogueEntry | undefined {
  return CATALOGUE.find((entry) => entry.id === id);
}

export function entriesInGroup(group: CatalogueGroupId): CatalogueEntry[] {
  return CATALOGUE.filter((entry) => entry.group === group);
}
