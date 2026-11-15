import './style.css';
import { Vector3 } from 'three';
import type { Condition, EphemerisData, Observation, Site, SiteAnalysis, TimeInterval, Vec3 } from './contracts';
import { etToUtc, utcToEt, validateEphemeris } from './science/index';
import { getUpcomingEvents } from './science/events';
import { findMissionWindow, type MissionRequest } from './science/mission';
import { analyzeObserver, observeObserver, sphereHorizonDipDeg } from './science/observer';
import { buildTerrainMesh, observeTerrain, observeTerrainInstant, sampleTerrainContinuous, validateTerrainPatch, type TerrainPatch, type TerrainProfile, type TerrainVisibility } from './science/terrain';
import { preparedCandidateRegion, searchCandidatesAsync, type CandidateRegion, type CandidateResult } from './science/candidates';
import { MoonScene, type BodyPose, type OrbitMarker } from './scene/MoonScene';
import { buildMoonHost, parseGlobalHeights, parseRegionalContext, type GlobalHeights, type MoonHost, type RegionalContext } from './scene/context';
import { distanceFromEye, poseAlongDescent, surfaceShare, type CameraPose } from './scene/transition';
import { selectCandidateShortlist } from './science/candidate-assessment';
import { MIN_EYE_HEIGHT_M, WALK_MARGIN_M, SurfaceScene } from './scene/SurfaceScene';
import { bodyToLatLon, bodyToLocalScene, latLonToBodyUnit, localSceneToBody, normalizeLonDeg } from './scene/coords';
import { findCatalogueEntry, type CatalogueEntry } from './ui/catalogue';
import { CONDITIONS, CONDITION_DESCRIPTION, CONDITION_LABEL, buildConclusion } from './ui/comparison';
import { button, el, errorText, make, setupDialog } from './ui/dom';
import { compassPoint, formatDuration, formatEyeHeight, formatHeight, formatLatLon, formatPercent, formatSignedDeg, formatUtcMinute, formatUtcSecond } from './ui/format';
import { GuidedDemo } from './ui/GuidedDemo';
import { experienceStop, formatSpeed, playbackStep, type ExperienceStop, type MissionFormat } from './ui/mission';
import { MissionPanel, type ExperiencePlan } from './ui/MissionPanel';
import { PointCard, type PointBody } from './ui/PointCard';
import { CandidatesPanel, candidateTone } from './ui/CandidatesPanel';
import { renderCatalogue, renderDataPanel } from './ui/panels';
import type { Scenario } from './ui/scenario';
import { ScenarioPanel, type ScenarioResult } from './ui/ScenarioPanel';
import { SiteCard, type SiteId } from './ui/SiteCard';
import { TerrainProfileView } from './ui/TerrainProfileView';
import { Timeline, type TimelineRow, type TimelineTick } from './ui/Timeline';

/** Extended dataset first; the original November dataset is a real, labelled fallback. */
const DATA_URLS = ['/data/ephemeris-2026-10_2027-02.json', '/data/ephemeris-2026-11.json'] as const;
const TERRAIN_URL = '/data/terrain-pgda90-southpolar.json';
/** Visual-context assets: drawn around the scientific patch, never read by any calculation. */
const CONTEXT_URL = '/data/visual-context-pgda90-80km.json';
const GLOBAL_CONTEXT_URL = '/data/visual-context-lola-global-4ppd.json';
const REFERENCE_RADIUS_M = 1737400;
const DEMO_URL = '/data/mission-demo.json';
const SITE_IDS = ['a', 'b'] as const;
const SITE_NAME: Record<SiteId, string> = { a: 'Site A', b: 'Site B' };
const DEFAULT_ENTRY: Record<SiteId, string> = { a: 'shackleton', b: 'mons-mouton' };
/** Default observer height: standing eye height. Saved scenarios keep their own heights. */
const EYE_HEIGHT_M = 1.7;
const ANALYSIS_CACHE_LIMIT = 64;
const STEP_BUTTONS = { 'step-back-day': -86400, 'step-back-hour': -3600, 'step-fwd-hour': 3600, 'step-fwd-day': 86400 } as const;

type View = 'overview' | 'space' | 'surface';
type GroundModel = 'sphere' | 'terrain';

interface SiteState {
  site: Site;
  /** Observer height above the reference sphere (sphere model) or above the DEM ground (terrain view), metres. */
  heightM: number;
  name: string;
  sourceText: string;
  sourceUrl: string | null;
}

interface State {
  data: EphemerisData | null;
  dataUrl: string;
  dataError: string | null;
  terrain: TerrainPatch | null;
  terrainError: string | null;
  sites: Record<SiteId, SiteState>;
  active: SiteId;
  period: TimeInterval | null;
  et: number | null;
  playing: boolean;
  lastFrame: number | null;
  view: View;
  ground: GroundModel;
  /** The continuous drawing mesh (detailed terrain seated in its surroundings). Rendering only. */
  host: MoonHost | null;
  /** Short statement of anything about the picture that did not load. Empty when all is as intended. */
  pictureNotes: string[];
}

const ui = {
  status: el<HTMLSpanElement>('data-status'),
  overlay: el<HTMLDivElement>('scene-overlay'),
  hint: el<HTMLParagraphElement>('pick-hint'),
  fade: el<HTMLDivElement>('view-fade'),
  sceneHost: el<HTMLDivElement>('scene'),
  surfaceHost: el<HTMLDivElement>('surface'),
  layers: { overview: el<HTMLDivElement>('layer-overview'), space: el<HTMLDivElement>('layer-space'), surface: el<HTMLDivElement>('layer-surface') },
  tabs: { overview: el<HTMLButtonElement>('tab-overview'), surface: el<HTMLButtonElement>('tab-surface') },
  spaceButton: el<HTMLButtonElement>('tab-space'),
  analysis: el<HTMLElement>('analysis'),
  openAnalysis: el<HTMLButtonElement>('open-analysis'),
  modelChip: el<HTMLSpanElement>('model-chip'),
  surfaceKeys: el<HTMLParagraphElement>('surface-keys'),
  periodError: el<HTMLParagraphElement>('period-error'),
  surfaceCompass: el<HTMLDivElement>('surface-compass'),
  surfaceStatus: make('p', 'surface-status'),
  surfaceNote: el<HTMLParagraphElement>('surface-note'),
  surfaceBar: el<HTMLDivElement>('surface-bar'),
  experience: {
    root: el<HTMLDivElement>('experience'),
    text: el<HTMLParagraphElement>('experience-text'),
    play: el<HTMLButtonElement>('experience-play'),
    speed: el<HTMLSelectElement>('experience-speed'),
    rate: el<HTMLSpanElement>('experience-rate'),
    restart: el<HTMLButtonElement>('experience-restart'),
    end: el<HTMLButtonElement>('experience-end'),
  },
  periodForm: el<HTMLFormElement>('period-form'),
  periodStart: el<HTMLInputElement>('period-start'),
  periodEnd: el<HTMLInputElement>('period-end'),
  periodApply: el<HTMLButtonElement>('period-apply'),
  periodFull: el<HTMLButtonElement>('period-full'),
  utcForm: el<HTMLFormElement>('utc-form'),
  utcInput: el<HTMLInputElement>('utc-input'),
  utcApply: el<HTMLButtonElement>('utc-apply'),
  timeError: el<HTMLParagraphElement>('time-error'),
  slider: el<HTMLInputElement>('time-slider'),
  play: el<HTMLButtonElement>('play'),
  speed: el<HTMLSelectElement>('speed'),
  comparison: el<HTMLDivElement>('comparison'),
  dialogs: { catalogue: el<HTMLDialogElement>('dialog-catalogue'), scenarios: el<HTMLDialogElement>('dialog-scenarios'), data: el<HTMLDialogElement>('dialog-data') },
};

function entrySite(entry: CatalogueEntry): SiteState {
  return {
    site: { latDeg: entry.latDeg, lonDeg: entry.lonDeg, heightAboveReferenceSphereM: 0 },
    heightM: EYE_HEIGHT_M,
    name: entry.name,
    sourceText: `Illustrative point: ${entry.kind} from the IAU/USGS Gazetteer, on the smooth sphere. Not a surveyed landing position.`,
    sourceUrl: entry.sourceUrl,
  };
}

function defaultSite(id: SiteId): SiteState {
  const entry = findCatalogueEntry(DEFAULT_ENTRY[id]);
  if (!entry) throw new Error(`Unknown catalogue entry ${DEFAULT_ENTRY[id]}`);
  return entrySite(entry);
}

const state: State = {
  data: null,
  dataUrl: DATA_URLS[0],
  dataError: null,
  terrain: null,
  terrainError: null,
  sites: { a: defaultSite('a'), b: defaultSite('b') },
  active: 'a',
  period: null,
  et: null,
  playing: false,
  lastFrame: null,
  view: 'overview',
  ground: 'sphere',
  host: null,
  pictureNotes: [],
};

const moon = new MoonScene(ui.sceneHost);
const surface = new SurfaceScene(ui.surfaceHost);
const timeline = new Timeline(el<HTMLDivElement>('timeline'), (et) => {
  setPlaying(false);
  setEt(et);
});
const analysisCache = new Map<string, SiteAnalysis>();

// ---------- site cards ----------

const cards = {} as Record<SiteId, SiteCard>;
for (const id of SITE_IDS) {
  cards[id] = new SiteCard(id, {
    onPick: () => setActive(id),
    onCatalogue: () => {
      setActive(id);
      ui.dialogs.catalogue.showModal();
    },
    onExplore: () => requestExplore(id),
    onSet: (latDeg, lonDeg, heightM) => {
      setSite(id, { site: { latDeg, lonDeg: normalizeLonDeg(lonDeg), heightAboveReferenceSphereM: 0 }, heightM, name: 'custom point', sourceText: 'Custom point on the smooth reference sphere.', sourceUrl: null });
      if (state.view !== 'surface') frameSite(id);
    },
    onJump: (et) => jumpTo(et),
  });
  el<HTMLElement>('sites').append(cards[id].root);
}

function renderSiteCard(id: SiteId): void {
  const s = state.sites[id];
  cards[id].renderLocation({ name: s.name, latDeg: s.site.latDeg, lonDeg: s.site.lonDeg, heightM: s.heightM, sourceText: s.sourceText, sourceUrl: s.sourceUrl, dipDeg: sphereHorizonDipDeg(s.heightM) });
  // The mission form shows the same site and height: one state, so results there become stale when it changes.
  missionPanel.sync();
}

/** Change only the observer height of a site (site card, surface slider and mission form share this value). */
function setHeight(id: SiteId, heightM: number): void {
  if (state.sites[id].heightM === heightM) return;
  state.sites[id] = { ...state.sites[id], heightM };
  if (state.view === 'surface' && id === state.active) surface.setEyeHeight(heightM);
  invalidateCandidates();
  renderSiteCard(id);
  refreshAnalysis();
  refreshObservation();
  reevaluateExperience(id);
}

function setActive(id: SiteId): void {
  state.active = id;
  syncMarkers();
  for (const key of SITE_IDS) cards[key].setActive(key === id);
  if (!transit) ui.hint.textContent = moon.regionShown ? REGION_HINT : ORBIT_HINT;
  renderPointCard();
}

function setSite(id: SiteId, next: SiteState): void {
  if (!selectingCandidate) invalidateCandidates();
  // Standing on real terrain and the point moves somewhere without it (Analysis, catalogue, scenario):
  // the ground model is never swapped under the viewer. The surface is left, with a visible reason.
  const leaving = state.view === 'surface' && id === state.active && state.ground === 'terrain' && !terrainAvailableAt(next.site);
  if (leaving) {
    surface.setWalking(null, next.site, next.heightM);
    hasWalked = false;
  }
  state.sites[id] = next;
  syncMarkers();
  renderSiteCard(id);
  refreshAnalysis();
  if (state.view === 'surface' && id === state.active && !leaving) prepareSurfaceGround();
  if (leaving) {
    refreshObservation('orbit');
    void leaveSurfaceForOrbit('Detailed terrain is not prepared at the new point — returned to Orbit. “Explore here” offers a labelled smooth sphere.');
  } else refreshObservation();
  reevaluateExperience(id);
}

async function leaveSurfaceForOrbit(reason: string): Promise<void> {
  // The ground under the viewer no longer belongs to the selected point, so there is nothing to fly up from.
  snapToOrbit();
  frameSite(state.active);
  ui.hint.textContent = reason;
  ui.timeError.textContent = reason;
}

// ---------- analysis (cached; never per playback frame) ----------

/** Reference-sphere analysis at an observer height. Cached by dataset, site, height and period. */
function analysisFor(data: EphemerisData, site: Site, heightM: number, period: TimeInterval): SiteAnalysis {
  const key = `${data.id}|${site.latDeg}|${site.lonDeg}|${heightM}|${period.startEt}|${period.endEt}`;
  const cached = analysisCache.get(key);
  if (cached) return cached;
  const result = analyzeObserver(data, { ...site, heightAboveReferenceSphereM: 0 }, period, heightM);
  if (analysisCache.size >= ANALYSIS_CACHE_LIMIT) {
    const oldest = analysisCache.keys().next().value;
    if (oldest !== undefined) analysisCache.delete(oldest);
  }
  analysisCache.set(key, result);
  return result;
}

function coverage(data: EphemerisData): TimeInterval {
  return { startEt: data.coverage.startEt, endEt: data.coverage.endEt };
}

function buildTicks(data: EphemerisData, period: TimeInterval): TimelineTick[] {
  const startMs = Date.parse(etToUtc(data, period.startEt));
  const endMs = Date.parse(etToUtc(data, period.endEt));
  const spanSeconds = (endMs - startMs) / 1000;
  const steps = [600, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 2 * 86400, 5 * 86400, 10 * 86400];
  const step = steps.find((candidate) => spanSeconds / candidate <= 31) ?? 10 * 86400;
  const ticks: TimelineTick[] = [];
  const stepMs = step * 1000;
  for (let ms = Math.ceil(startMs / stepMs) * stepMs; ms <= endMs; ms += stepMs) {
    const iso = new Date(ms).toISOString();
    try {
      ticks.push({ et: utcToEt(data, `${iso.slice(0, 19)}Z`), label: step >= 86400 ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`, major: false });
    } catch {
      // A tick the dataset cannot place is simply not drawn.
    }
  }
  const stride = Math.max(1, Math.ceil(ticks.length / (step >= 86400 ? 7 : 5)));
  return ticks.map((tick, index) => (index % stride === 0 ? { ...tick, major: true } : { ...tick, label: '' }));
}

const ROW_LABEL: Record<Condition, string> = { sun: 'Sun', earth: 'Earth', both: 'Sun + Earth' };

function refreshAnalysis(): void {
  const { data, period } = state;
  if (!data || !period) return;
  let analyses: Record<SiteId, SiteAnalysis>;
  try {
    analyses = {
      a: analysisFor(data, state.sites.a.site, state.sites.a.heightM, period),
      b: analysisFor(data, state.sites.b.site, state.sites.b.heightM, period),
    };
  } catch (error) {
    // Never leave stale bars or numbers next to an error.
    const message = `Interval analysis failed: ${errorText(error)}`;
    timeline.clear(message);
    ui.comparison.replaceChildren(make('p', 'comparison-error', message));
    return;
  }
  const rows: TimelineRow[] = [];
  for (const id of SITE_IDS) {
    for (const condition of CONDITIONS) {
      const summary = analyses[id][condition];
      rows.push({
        label: `${id.toUpperCase()} · ${ROW_LABEL[condition]}`,
        description: `${SITE_NAME[id]}: ${CONDITION_DESCRIPTION[condition]}`,
        site: id,
        condition,
        intervals: summary.intervals,
        summary: formatPercent(summary.fraction),
      });
    }
  }
  timeline.setData({
    period,
    rows,
    ticks: buildTicks(data, period),
    describe: (row, interval) =>
      `${row.description}\n${formatUtcMinute(etToUtc(data, interval.startEt))} → ${formatUtcMinute(etToUtc(data, interval.endEt))}\n${formatDuration(interval.endEt - interval.startEt)} (approximate)`,
  });
  timeline.setCursor(state.et);
  renderComparison(analyses.a, analyses.b);
}

function renderComparison(a: SiteAnalysis, b: SiteAnalysis): void {
  const verdicts = buildConclusion(a, b);
  const table = make('div', 'cmp-table');
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'Share of the period, total time and longest continuous interval for each condition at Site A and Site B');
  table.append(make('span', 'cmp-corner'), make('span', 'cmp-head site-a', 'Site A'), make('span', 'cmp-head site-b', 'Site B'), make('span', 'cmp-sub', 'Condition'));
  for (let i = 0; i < 2; i += 1) table.append(make('span', 'cmp-sub num', 'share'), make('span', 'cmp-sub num', 'total time'), make('span', 'cmp-sub num', 'longest run'));
  for (const verdict of verdicts) {
    const label = make('span', 'cmp-label');
    label.append(make('i', `tl-dot cond-${verdict.condition}`), document.createTextNode(CONDITION_LABEL[verdict.condition]));
    table.append(label);
    for (const [id, analysis] of [['a', a], ['b', b]] as const) {
      const summary = analysis[verdict.condition];
      const share = make('strong', `cmp-num site-${id}`, formatPercent(summary.fraction));
      if (verdict.leader === id.toUpperCase()) share.classList.add('lead');
      table.append(share, make('span', 'cmp-num', formatDuration(summary.totalSeconds)), make('span', 'cmp-num', formatDuration(summary.longestSeconds)));
    }
  }
  const list = make('ul', 'cmp-sentences');
  for (const verdict of verdicts) list.append(make('li', undefined, verdict.sentence));
  ui.comparison.replaceChildren(table, list);
}

// ---------- surface view helpers ----------

const terrainProfileHost = make('div', 'terrain-profile-host');
const terrainProfile = new TerrainProfileView(terrainProfileHost);
const groundToggle = make('div', 'ground-toggle');
groundToggle.setAttribute('role', 'group');
groundToggle.setAttribute('aria-label', 'Ground model for the surface view');
const groundSphere = button('Reference sphere', 'btn seg', 'Stand on the smooth reference sphere');
const groundTerrain = button('Real terrain patch', 'btn seg', 'Stand on the measured LOLA terrain patch (only where it has data)');
const terrainPoint = button('Go to prepared region', 'btn', 'Move the selected point to the prepared region: the checked point inside the measured LOLA terrain patch');
groundToggle.append(make('span', 'group-label', 'Ground'), groundSphere, groundTerrain, terrainPoint);
const viewSettings = make('details', 'surface-settings');
viewSettings.append(make('summary', '', 'View settings'));
viewSettings.append(groundToggle);
const skyControls = ui.surfaceBar.querySelector('.sky-toggle');
if (skyControls) viewSettings.append(skyControls);
const aboutView = ui.surfaceBar.querySelector('.surface-about');
if (aboutView) viewSettings.append(aboutView);
ui.surfaceBar.append(viewSettings);
ui.surfaceStatus.id = 'surface-status';
ui.surfaceNote.before(ui.surfaceStatus);
const SURFACE_KEYS = 'W A S D walk on the measured ground · Shift fast traverse · drag or mouse look · Esc releases the mouse';
const REGION_HINT = 'Inside the amber line: measured 80 m terrain, used for the calculations · around it: real coarser terrain, picture only';
const ORBIT_HINT = 'Click the Moon to choose a point · drag to rotate · scroll to zoom';
const DESCENT_HINT = 'Descending… Esc or Orbit turns back';
ui.surfaceKeys.textContent = SURFACE_KEYS;
const terrainDetails = make('details', 'fold terrain-details');
terrainDetails.append(make('summary', '', 'Local terrain diagnostics'), terrainProfileHost);
ui.analysis.querySelector('.analysis-body')!.append(terrainDetails);
terrainProfileHost.hidden = true;
let surfaceEntry: SiteState | null = null;
let hasWalked = false;
let enhancedSky = true;
let visibleTerrainProfile:TerrainProfile|null=null;
const eyeControl=make('label','eye-control','Eye height ');
const eyeInput=make('input'); eyeInput.type='range'; eyeInput.min='0.5';eyeInput.max='3';eyeInput.step='0.1';eyeInput.value=String(EYE_HEIGHT_M);
eyeInput.setAttribute('aria-label','Eye height above the local ground, metres');
const eyeOutput=make('output','', '1.7 m');
eyeInput.addEventListener('input',()=>{const height=Number(eyeInput.value); eyeOutput.textContent=formatEyeHeight(height);setHeight(state.active,height);});
// A height set in Analysis or loaded with a scenario can lie outside the slider. It is then shown as it is
// (camera, model and read-out all use it) with an explicit way back to standing height; it is never relabelled.
const eyeReset=button('Reset eyes to 1.7 m','btn','Use standing eye height. The saved scenario itself is not changed.');
eyeReset.id='eye-reset';eyeReset.hidden=true;
eyeReset.addEventListener('click',()=>setHeight(state.active,EYE_HEIGHT_M));
eyeControl.append(eyeInput,eyeOutput,eyeReset);viewSettings.insertBefore(eyeControl,viewSettings.children[1] ?? null);

function terrainAvailableAt(site: Site): boolean {
  if (!state.terrain) return false;
  try {
    return sampleTerrainContinuous(state.terrain, site.latDeg, site.lonDeg) !== null;
  } catch {
    return false;
  }
}

/** Reference-sphere point of a site, Moon-fixed metres. */
function spherePoint(site: Site): Vec3 {
  const u = latLonToBodyUnit(site.latDeg, site.lonDeg);
  return [u[0] * REFERENCE_RADIUS_M, u[1] * REFERENCE_RADIUS_M, u[2] * REFERENCE_RADIUS_M];
}

/** Exact ground point of a site for drawing: on the measured terrain where it exists, otherwise on the reference sphere. */
function groundPoint(site: Site): Vec3 {
  if (state.terrain) {
    try {
      const sample = sampleTerrainContinuous(state.terrain, site.latDeg, site.lonDeg);
      if (sample) return sample.positionBodyM;
    } catch {
      // fall through to the sphere
    }
  }
  return spherePoint(site);
}

/** Origin of the first-person local frame for the chosen ground model. */
function surfaceOrigin(site: Site): Vec3 {
  return state.ground === 'terrain' && terrainAvailableAt(site) ? groundPoint(site) : spherePoint(site);
}

/**
 * Build what the surface view stands on for the chosen ground model. The model itself is only ever
 * changed by an explicit user action; where terrain is requested but missing, nothing is substituted
 * (callers leave the surface or ask first), and the view reports the problem instead of a sphere.
 */
function prepareSurfaceGround(): void {
  const { site } = state.sites[state.active];
  const available = terrainAvailableAt(site);
  const mesh = state.ground === 'terrain' && available && state.terrain && state.host ? state.host : null;
  surface.setWorld(mesh ? { host: mesh, originBodyM: groundPoint(site), latDeg: site.latDeg, lonDeg: site.lonDeg } : null);
  surfaceEntry = { ...state.sites[state.active], site: { ...site } };
  hasWalked = false;
  surface.setWalking(mesh ? state.terrain : null, site, state.sites[state.active].heightM);
  groundSphere.setAttribute('aria-pressed', String(state.ground === 'sphere'));
  groundTerrain.setAttribute('aria-pressed', String(state.ground === 'terrain'));
  groundTerrain.disabled = !available;
  groundTerrain.title = !state.terrain
    ? 'No terrain patch is loaded'
    : available ? 'Stand on the measured LOLA terrain patch' : 'Terrain coverage insufficient: this site is outside the small LOLA patch';
  terrainPoint.disabled = !state.terrain;
  terrainProfileHost.hidden = state.ground !== 'terrain';
}

// ---------- selected-point card ----------

interface PointInfo {
  sun: PointBody | null;
  earth: PointBody | null;
  model: string;
  problem: string | null;
}
let pointInfo: PointInfo = { sun: null, earth: null, model: '', problem: 'Loading ephemeris…' };

const pointCard = new PointCard(el<HTMLElement>('point-card'), {
  onExplore: () => requestExplore(state.active),
  onOrbit: () => void setView('overview'),
});

// Searches are bounded, explicit and replaceable. They never run on every slider frame.
let candidateGeneration = 0;
let candidateAbort: AbortController | null = null;
let candidateResults: ReadonlyArray<CandidateResult> = [];
/** What is shown, in display order: the list rows, the numbered markers and the selected name all use this. */
let candidateShortlist: ReadonlyArray<CandidateResult> = [];
let selectedCandidateId: string | null = null;
let selectingCandidate = false;
const findCandidates = el<HTMLButtonElement>('find-candidates');
const candidatePanel = new CandidatesPanel(el<HTMLElement>('candidates'), selectCandidate, invalidateCandidates);

function invalidateCandidates(): void {
  candidateGeneration += 1;
  candidateAbort?.abort(); candidateAbort = null;
  candidateResults = [];
  candidateShortlist = [];
  selectedCandidateId = null;
  candidatePanel.clear();
  syncMarkers(); // the selected point keeps its own marker
  findCandidates.disabled = !state.data || !state.terrain;
}

function selectCandidate(candidate: CandidateResult): void {
  selectingCandidate = true;
  try {
    state.ground = 'terrain';
    setSite(state.active, { site: { ...candidate.site }, heightM: candidate.lighting.request.observerHeightM,
      name: `Option ${candidateShortlist.indexOf(candidate) + 1}`,
      sourceText: 'Evaluated illustrative point in the measured PGDA90 patch. Reference-sphere ranking with separate finite-terrain diagnostics; not a certified landing site.',
      sourceUrl: state.terrain?.source.productPage ?? null });
    candidatePanel.select(candidate.id);
    selectedCandidateId = candidate.id;
    syncMarkers();
    ui.hint.textContent = 'Point selected · “Explore here” descends to the measured terrain';
  } finally { selectingCandidate = false; }
}

async function runCandidateSearch(): Promise<void> {
  const { data, terrain, et } = state;
  if (!data || !terrain || et === null) { candidatePanel.error('Prepared ephemeris and terrain data are required.'); return; }
  setPlaying(false);
  invalidateCandidates();
  const generation = candidateGeneration;
  const abort = new AbortController(); candidateAbort = abort;
  const region: CandidateRegion = preparedCandidateRegion(terrain);
  const observerHeightM=state.sites[state.active].heightM;
  const when = `${formatUtcMinute(etToUtc(data, et))} · eyes ${formatEyeHeight(observerHeightM)}`;
  candidatePanel.progress(region, when);
  findCandidates.disabled = true;
  try {
    const results = await searchCandidatesAsync(data, terrain, { region, gridSide: 5, minimumCoverageMarginM: WALK_MARGIN_M, observerHeightM, currentEt: et },
      { requestId: generation, signal: abort.signal, batchSize: 1,
        onProgress: (progress) => { if (generation === candidateGeneration) candidatePanel.progress(region, when, progress.completed, progress.total); } });
    if (generation !== candidateGeneration || state.et !== et) return;
    candidateResults = results;
    candidateShortlist = selectCandidateShortlist(results, 3);
    candidatePanel.show(results, candidateShortlist, region, when);
    // A repeated search must keep the active site's selection if that same point is still listed.
    const activeSite = state.sites[state.active].site;
    const selected = candidateShortlist.find((candidate) => Math.abs(candidate.site.latDeg - activeSite.latDeg) < 1e-7
      && Math.abs(normalizeLonDeg(candidate.site.lonDeg - activeSite.lonDeg)) < 1e-7);
    if (selected) {
      selectedCandidateId = selected.id;
      candidatePanel.select(selected.id);
    }
    syncMarkers();
    if (state.view !== 'overview' || transit) await setView('overview');
    if (generation !== candidateGeneration) return;
    // Searching is an orbital action. Keep the whole Moon as context; only Explore descends.
    moon.flyToGlobePoint(terrain.observer.site.latDeg, terrain.observer.site.lonDeg);
    ui.hint.textContent = REGION_HINT;
  } catch (error) {
    if (generation === candidateGeneration && (error as Error).name !== 'AbortError') candidatePanel.error(errorText(error));
  } finally {
    if (generation === candidateGeneration) findCandidates.disabled = false;
  }
}

// The regional picture moves aside while the list is open, so no marker sits under it.
const candidatesHost = el<HTMLElement>('candidates');
const syncCandidateInset = (): void => moon.setRightInset(candidatesHost.hidden ? 0 : candidatesHost.offsetWidth + 24);
new MutationObserver(syncCandidateInset).observe(candidatesHost, { attributes: true, attributeFilter: ['hidden'] });
window.addEventListener('resize', syncCandidateInset);

findCandidates.disabled = true;
findCandidates.addEventListener('click', () => void runCandidateSearch());
moon.onMarker((id) => { const point = candidateShortlist.find((item) => item.id === id); if (point) selectCandidate(point); });

/** Badges on the Moon: the two sites and the shortlisted options, each on its exact ground point. */
function syncMarkers(): void {
  const markers: OrbitMarker[] = [];
  const near = (a: Site, b: Site): boolean => Math.abs(a.latDeg - b.latDeg) < 1e-7 && Math.abs(a.lonDeg - b.lonDeg) < 1e-7;
  candidateShortlist.forEach((candidate, index) => {
    const tone = candidateTone(candidate);
    markers.push({ id: candidate.id, label: String(index + 1), tone, bodyM: groundPoint(candidate.site), selected: candidate.id === selectedCandidateId, clickable: true,
      title: `Option ${index + 1}: ${tone === 'blocked' ? 'blocked by measured terrain' : tone === 'option' ? 'confirmed on measured terrain at this instant' : 'reference option, terrain unknown'}` });
  });
  for (const id of SITE_IDS) {
    const { site, name } = state.sites[id];
    // A site standing exactly on a shown option is marked by that option's (ringed) badge.
    if (candidateShortlist.some((candidate) => near(candidate.site, site))) continue;
    markers.push({ id: `site-${id}`, label: id.toUpperCase(), tone: id === 'a' ? 'site-a' : 'site-b', bodyM: groundPoint(site), selected: id === state.active, clickable: false, title: `${SITE_NAME[id]}: ${name}` });
  }
  moon.setMarkers(markers);
}

/** Bring a site into view on the whole Moon. */
function frameSite(id: SiteId): void {
  const { site } = state.sites[id];
  moon.flyToGlobePoint(site.latDeg, site.lonDeg);
}

/** No silent terrain substitution when the user asks for a detailed surface. */
function requestExplore(id: SiteId): void {
  setActive(id);
  if (terrainAvailableAt(state.sites[id].site)) {
    state.ground = 'terrain';
    setAnalysisOpen(false);
    void enterSurface(id);
    return;
  }
  const dialog = make('dialog', 'panel');
  const heading = make('h2', '', 'Detailed terrain is not prepared here');
  const body = make('div', 'panel-body');
  body.append(make('p', '', 'Explore the real LOLA south-polar region, or explicitly continue on a smooth sphere with no terrain.'));
  const go = button('Go to prepared region', 'btn primary');
  go.disabled = !state.terrain;
  go.addEventListener('click', () => { dialog.close(); dialog.remove(); terrainPoint.click(); });
  const sphere = button('Smooth sphere only', 'btn');
  sphere.addEventListener('click', () => { dialog.close(); dialog.remove(); state.ground = 'sphere'; void enterSurface(id); });
  const cancel = button('Cancel', 'btn'); cancel.addEventListener('click', () => { dialog.close(); dialog.remove(); });
  body.append(go, sphere, cancel); dialog.append(heading, body); document.body.append(dialog); dialog.showModal();
  dialog.addEventListener('cancel', () => dialog.remove(), { once: true });
}

function renderPointCard(): void {
  const s = state.sites[state.active];
  pointCard.render({
    badge: state.active === 'a' ? 'A' : 'B',
    name: s.name,
    latDeg: s.site.latDeg,
    lonDeg: s.site.lonDeg,
    ...pointInfo,
    view: state.view === 'overview' ? 'orbit' : state.view,
    moved: hasWalked && state.view === 'surface',
  });
  const localTerrain=state.ground==='terrain' && terrainAvailableAt(s.site);
  const surfaceTerrain = state.view === 'surface' && state.ground === 'terrain';
  ui.modelChip.textContent = state.view === 'surface'
    ? `${surfaceTerrain ? 'Calculations: measured LOLA terrain, 80 m grid · beyond the amber line: picture only, unknown to the calculations' : 'Smooth reference sphere · no terrain'} · ${enhancedSky ? 'Enhanced sky: real star map, orientation illustrative' : 'Natural exposure'}`
    : localTerrain
      ? 'Measured LOLA terrain at this point · 80 m grid · terrain beyond the patch unknown · Orbit sizes schematic'
      : 'Reference sphere · no terrain · Orbit sizes schematic';
  if (state.pictureNotes.length) ui.modelChip.textContent += ` · ${state.pictureNotes.join(' · ')}`;
}

/** Reference-sphere state of one body for the card: its centre against the local tangent plane. */
function referenceBody(body: Observation['sun']): PointBody {
  return { altDeg: body.altDeg, azDeg: body.azDeg, state: body.altDeg > 0 ? 'above horizon' : 'below horizon', tone: body.altDeg > 0 ? 'pos' : 'neg' };
}

function bodyLine(name: string, altDeg: number, azDeg: number | null): string {
  return `${name}: altitude ${formatSignedDeg(altDeg)}, azimuth ${azDeg === null ? 'undefined here' : `${azDeg.toFixed(1)}° ${compassPoint(azDeg)}`}.`;
}

/** Card wording for a body on real terrain. Unknown terrain is never shown as a pass. */
function terrainBody(body: Observation['sun'], check: TerrainVisibility): PointBody {
  return {
    altDeg: body.altDeg,
    azDeg: body.azDeg,
    state: check.status === 'blocked' ? 'blocked by terrain' : check.status === 'clear' ? 'clear of terrain' : 'terrain unknown',
    tone: check.status === 'blocked' ? 'neg' : check.status === 'clear' ? 'pos' : 'unknown',
  };
}

/** Calculation height and, only where the camera cannot be drawn that low, the separate drawn eye height. */
function heightLabel(heightM: number): string {
  return heightM < MIN_EYE_HEIGHT_M
    ? `calculated at ${formatEyeHeight(heightM)} · camera drawn ${formatEyeHeight(MIN_EYE_HEIGHT_M)} up (display minimum)`
    : `eyes ${formatEyeHeight(heightM)}`;
}

/** What the last terrain surface frame drew, for the browser checks. */
let lastTerrainStatus: { sun: TerrainVisibility['status']; earth: TerrainVisibility['status'] } | null = null;

const TERRAIN_STATUS_TEXT: Record<TerrainVisibility['status'], string> = {
  blocked: 'Blocked',
  clear: 'Clear',
  insufficient: 'Terrain coverage insufficient',
};

function renderSurface(): void {
  const id = state.active;
  const s = state.sites[id];
  const { data, et } = state;
  const compassDefined = Math.abs(s.site.latDeg) !== 90;
  const eye = Math.max(s.heightM, MIN_EYE_HEIGHT_M);
  if (document.activeElement !== eyeInput) {
    eyeInput.value = String(Math.min(3, Math.max(0.5, s.heightM)));
    const outside = s.heightM < 0.5 || s.heightM > 3;
    eyeOutput.textContent = !outside ? formatEyeHeight(s.heightM)
      : `${formatEyeHeight(s.heightM)} · set in Analysis, outside the 0.5–3 m slider${s.heightM < MIN_EYE_HEIGHT_M ? ` · camera drawn ${formatEyeHeight(MIN_EYE_HEIGHT_M)} up` : ''}`;
    eyeReset.hidden = !outside;
  }
  lastTerrainStatus = null;
  const eyeNote = s.heightM < MIN_EYE_HEIGHT_M ? ` The camera eye is drawn ${MIN_EYE_HEIGHT_M} m up (display minimum) so it never sits inside the ground; the numbers use ${formatHeight(s.heightM)}.` : '';
  if (!data || et === null) {
    surface.update(null);
    terrainProfile.update(null, null);
    ui.surfaceStatus.replaceChildren('No ephemeris data: nothing is drawn in the sky.');
    ui.surfaceNote.textContent = '';
    pointInfo = { sun: null, earth: null, model: '', problem: 'No ephemeris data: nothing is calculated or drawn.' };
    return;
  }
  const lines: string[] = [];
  try {
    if (state.ground === 'terrain' && state.terrain) {
      const t = observeTerrainInstant(data, et, { ...s.site, heightAboveReferenceSphereM: 0 }, s.heightM, state.terrain);
      if (!t) throw new Error('This point is outside the prepared terrain mesh. Return to the prepared region.');
      // The discs are always placed on their SPICE directions and the drawn mesh hides whatever it covers,
      // so a partly covered disc shows partly. The label states the separate centre-ray result.
      const ghost = (v: TerrainVisibility): string | null => (v.status === 'blocked' ? 'centre behind terrain' : null);
      surface.update({ observation: t.observation, latDeg: s.site.latDeg, lonDeg: s.site.lonDeg, observerHeightM: eye, compassDefined, draw: { sun: true, earth: true }, ghost: { sun: ghost(t.sun), earth: ghost(t.earth) } });
      lastTerrainStatus = { sun: t.sun.status, earth: t.earth.status };
      terrainProfile.update(ui.analysis.hidden ? null : visibleTerrainProfile, t.observation);
      pointInfo = {
        sun: terrainBody(t.observation.sun, t.sun),
        earth: terrainBody(t.observation.earth, t.earth),
        model: `Body centres vs LOLA 80 m mesh · ${heightLabel(s.heightM)} · far terrain unknown`,
        problem: null,
      };
      lines.push(`${bodyLine('Sun', t.observation.sun.altDeg, t.observation.sun.azDeg)} Terrain check: ${TERRAIN_STATUS_TEXT[t.sun.status]} — ${t.sun.reason}`);
      lines.push(`${bodyLine('Earth', t.observation.earth.altDeg, t.observation.earth.azDeg)} Terrain check: ${TERRAIN_STATUS_TEXT[t.earth.status]} — ${t.earth.reason}`);
      ui.surfaceNote.textContent =
        `Ground: measured LOLA terrain patch. Here the ground is ${formatSignedDeg(t.sample.groundHeightM, 1).replace('°', '')} m relative to the 1737.4 km sphere and the observer is ${formatHeight(s.heightM)} above that ground.${eyeNote} ` +
        'Sun and Earth are drawn on their calculated directions and hidden by the same mesh you stand on; the card reports the body-centre ray only, not how much of a disc shows. ' +
        'Beyond the amber line there is no terrain data: unknown, not flat, so nothing is drawn there. Analysis (timelines, events, scenarios) stays on the reference-sphere model.';
    } else {
      const observation = observeObserver(data, et, { ...s.site, heightAboveReferenceSphereM: 0 }, s.heightM);
      const dip = sphereHorizonDipDeg(s.heightM);
      const describe = (body: Observation['sun']): { ghost: string | null; text: string } => {
        if (body.altDeg > 0) return { ghost: null, text: 'Above the reference horizon.' };
        if (body.altDeg + body.angularRadiusDeg > -dip) {
          return {
            ghost: null,
            text: dip > 0.005
              ? `Below the reference horizon (the tangent plane used for timelines and events), but still above the smooth-sphere limb, which lies ${dip.toFixed(2)}° lower at this height — so it is drawn in view.`
              : 'Centre below the reference horizon; part of the disc is still above the smooth-sphere limb.',
          };
        }
        return { ghost: 'below the horizon', text: 'Below the smooth-sphere limb: hidden by the Moon.' };
      };
      const sun = describe(observation.sun);
      const earth = describe(observation.earth);
      surface.update({ observation, latDeg: s.site.latDeg, lonDeg: s.site.lonDeg, observerHeightM: eye, compassDefined, draw: { sun: true, earth: true }, ghost: { sun: sun.ghost, earth: earth.ghost } });
      terrainProfile.update(null, null);
      pointInfo = { sun: referenceBody(observation.sun), earth: referenceBody(observation.earth), model: `Smooth reference sphere · ${heightLabel(s.heightM)} · no terrain`, problem: null };
      lines.push(`${bodyLine('Sun', observation.sun.altDeg, observation.sun.azDeg)} ${sun.text}`);
      lines.push(`${bodyLine('Earth', observation.earth.altDeg, observation.earth.azDeg)} ${earth.text}`);
      const terrainHint = !state.terrain
        ? ''
        : terrainAvailableAt(s.site) ? ' A measured terrain patch is available here: choose “Real terrain patch”.' : ' Terrain coverage insufficient here: the small LOLA patch does not include this site (use “Go to terrain test point”).';
      ui.surfaceNote.textContent =
        `Ground: smooth reference sphere, no terrain. Observer ${formatHeight(s.heightM)} above the sphere; rings on the ground mark 10 m, 100 m, 1 km, 10 km and 100 km.${eyeNote} ` +
        `The blue line is the reference horizon (altitude 0°).${terrainHint}`;
    }
  } catch (error) {
    surface.update(null);
    terrainProfile.update(null, null);
    lines.length = 0;
    lines.push(`Calculation failed: ${errorText(error)}`);
    pointInfo = { sun: null, earth: null, model: '', problem: `Calculation failed: ${errorText(error)}` };
  }
  ui.surfaceStatus.replaceChildren(...lines.map((line) => make('span', 'surface-line', line)));
}

// ---------- observation (per time change) ----------

let lastSunDirection: Vec3 | null = null;

function refreshObservation(as: 'current' | 'orbit' = 'current'): void {
  const { data, et } = state;
  const onSurface = (state.view === 'surface' || transit !== null) && as === 'current';
  let sunDirection: Observation['sunDirectionBody'] | null = null;
  let earthDirection: Observation['earthDirectionBody'] | null = null;
  for (const id of SITE_IDS) {
    const card = cards[id];
    const s = state.sites[id];
    let observation: Observation | null = null;
    if (data && et !== null) {
      try {
        observation = observeObserver(data, et, { ...s.site, heightAboveReferenceSphereM: 0 }, s.heightM);
        card.showError('');
      } catch (error) {
        card.showError(`Calculation failed: ${errorText(error)}`);
      }
    }
    card.renderObservation(observation);
    if (id === state.active && !onSurface) {
      pointInfo = observation
        ? { sun: referenceBody(observation.sun), earth: referenceBody(observation.earth), model: `Smooth reference sphere · eyes ${formatEyeHeight(s.heightM)} · no terrain here`, problem: null }
        : { sun: null, earth: null, model: '', problem: data ? 'Calculation failed for this point.' : state.dataError ? 'No ephemeris data: nothing is calculated.' : 'Loading ephemeris…' };
    }
    if (observation && !sunDirection) {
      sunDirection = observation.sunDirectionBody;
      earthDirection = observation.earthDirectionBody;
      if (document.activeElement !== ui.utcInput) ui.utcInput.value = formatUtcSecond(observation.utc);
    }
    // Next changes: searched in ALL available data, not only the comparison period.
    if (data && et !== null) {
      try {
        const full = analysisFor(data, s.site, s.heightM, coverage(data));
        card.renderEvents(getUpcomingEvents(full, et), et, (when) => formatUtcMinute(etToUtc(data, when)),
          `Searched in all available data (${data.coverage.startUtc.slice(0, 10)} to ${data.coverage.endUtc.slice(0, 10)}), reference-sphere model.`);
      } catch (error) {
        card.renderEvents(null, null, () => '', '');
        card.showError(`Event search failed: ${errorText(error)}`);
      }
    } else {
      card.renderEvents(null, null, () => '', '');
    }
  }
  lastSunDirection = sunDirection;
  moon.setSunDirection(sunDirection);
  moon.setEarthDirection(earthDirection);
  timeline.setCursor(et);
  if (et !== null && document.activeElement !== ui.slider) ui.slider.value = String(et);
  if (onSurface) renderSurface();
  else if (state.ground === 'terrain' && state.terrain && data && et !== null) {
    const selected = state.sites[state.active];
    let local: ReturnType<typeof observeTerrainInstant> = null;
    try {
      local = observeTerrainInstant(data, et, selected.site, selected.heightM, state.terrain);
    } catch {
      local = null; // the reference-sphere result above stays, labelled as such
    }
    if (local) {
      pointInfo = { sun: terrainBody(local.observation.sun, local.sun), earth: terrainBody(local.observation.earth, local.earth),
        model: `Body centres vs LOLA 80 m mesh · eyes ${formatEyeHeight(selected.heightM)} · far terrain unknown`, problem: null };
    }
  }
  renderPointCard();
}

// ---------- time and period ----------

function setEt(et: number): void {
  const data = state.data;
  if (!data) return;
  const next = Math.min(data.coverage.endEt, Math.max(data.coverage.startEt, et));
  if (next !== state.et) invalidateCandidates();
  state.et = next;
  ui.timeError.textContent = '';
  refreshObservation();
}

function setPeriod(period: TimeInterval): void {
  const data = state.data;
  if (!data) return;
  state.period = period;
  ui.slider.min = String(data.coverage.startEt);
  ui.slider.max = String(data.coverage.endEt);
  ui.periodStart.value = formatUtcSecond(etToUtc(data, period.startEt));
  ui.periodEnd.value = formatUtcSecond(etToUtc(data, period.endEt));
  // One state for the current time: clamp it into the new period.
  const nextEt=Math.min(period.endEt, Math.max(period.startEt, state.et ?? period.startEt));
  if(nextEt!==state.et)invalidateCandidates();
  state.et=nextEt;
  refreshAnalysis();
  refreshObservation();
  missionPanel.sync();
}

/** Jump to an event time; widen the comparison period to all data when the event lies outside it. */
function jumpTo(et: number): void {
  const { data, period } = state;
  if (!data || !period) return;
  if(et!==state.et)invalidateCandidates();
  setPlaying(false);
  if (et < period.startEt || et > period.endEt) {
    state.et = et;
    setPeriod(coverage(data));
    ui.timeError.textContent = '';
  }
  setEt(et);
}

function parseUtcField(data: EphemerisData, input: HTMLInputElement, what: string): number {
  return parseUtcText(data, input.value, what);
}

function parseUtcText(data: EphemerisData, value: string, what: string): number {
  const text = value.trim();
  if (!/Z$/.test(text)) throw new Error(`${what} must be UTC in ISO 8601 form ending in Z, for example 2026-11-15T12:00:00Z.`);
  try {
    return utcToEt(data, text);
  } catch (error) {
    throw new Error(`${what}: ${errorText(error)}. Available range: ${data.coverage.startUtc} to ${data.coverage.endUtc}.`);
  }
}

function setPlaying(playing: boolean): void {
  // The shared time controls and the experience playback never run at once.
  if (experience?.playing) {
    experience.playing = false;
    renderExperience();
  }
  state.playing = playing && state.data !== null && state.period !== null;
  state.lastFrame = null;
  ui.play.textContent = state.playing ? '❚❚ Pause' : '▶ Play';
  ui.play.setAttribute('aria-pressed', String(state.playing));
  if (state.playing) requestAnimationFrame(tick);
}

function tick(now: number): void {
  if (!state.playing || !state.period || state.et === null) return;
  if (state.lastFrame!==null && now-state.lastFrame<125) { requestAnimationFrame(tick);return; }
  if (state.lastFrame !== null) {
    const dt = Math.min(0.25, (now - state.lastFrame) / 1000);
    const next = state.et + dt * Number(ui.speed.value);
    if (next >= state.data!.coverage.endEt) {
      setEt(state.data!.coverage.endEt);
      setPlaying(false);
      return;
    }
    setEt(next);
  }
  state.lastFrame = now;
  requestAnimationFrame(tick);
}

// ---------- views ----------

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

function showLayers(view: View): void {
  for (const key of ['overview', 'space', 'surface'] as const) ui.layers[key].hidden = key !== view;
  // Space view is a secondary look at the same orbit scene, so the Orbit tab stays selected for it.
  ui.tabs.overview.setAttribute('aria-selected', String(view !== 'surface'));
  ui.tabs.surface.setAttribute('aria-selected', String(view === 'surface'));
  ui.spaceButton.setAttribute('aria-pressed', String(view === 'space'));
  ui.spaceButton.textContent = view === 'space' ? 'Leave Space view' : 'Space view';
  document.body.dataset['view'] = view;
}

/** How much of the picture comes from the first-person renderer: 0 Orbit only, 1 first person only. */
function setSurfaceShare(share: number): void {
  ui.surfaceHost.hidden = share <= 0;
  ui.sceneHost.hidden = share >= 1;
  ui.surfaceHost.style.opacity = share > 0 && share < 1 ? String(share) : '';
  moon.setActive(share < 1);
  surface.setActive(share > 0);
}

/**
 * A descent or an ascent in progress. Both renderers draw the SAME camera pose, taken from one path,
 * and the picture dissolves from one to the other while they agree. `direction` can be turned at any
 * moment; `token` makes sure a superseded run can never finish later and change the view.
 */
interface Transit {
  token: number;
  direction: 1 | -1;
  t: number;
  durationS: number;
  orbit: CameraPose;
  eye: CameraPose;
  originBodyM: Vec3;
  site: Site;
  farM: number;
  nearM: number;
  /** Where the Orbit camera is anchored if the path ends at the top. */
  ascentTo: 'saved' | Vec3;
  last: number | null;
  waiters: Array<() => void>;
}
let transit: Transit | null = null;
let transitToken = 0;
const ORBIT_SKY_EXPOSURE = 0.9;
const ENHANCED_SKY_EXPOSURE = 1.35;

function toLocalPose(pose: BodyPose, origin: Vec3, site: Site): CameraPose {
  const rotate = (v: Vec3): [number, number, number] => { const l = bodyToLocalScene(v, site.latDeg, site.lonDeg); return [l.x, l.y, l.z]; };
  return { position: rotate([pose.positionBodyM[0] - origin[0], pose.positionBodyM[1] - origin[1], pose.positionBodyM[2] - origin[2]]), forward: rotate(pose.forwardBody), up: rotate(pose.upBody), fovDeg: pose.fovDeg };
}

function toBodyPose(pose: CameraPose, origin: Vec3, site: Site): BodyPose {
  const rotate = (v: [number, number, number]): Vec3 => localSceneToBody(new Vector3(v[0], v[1], v[2]), site.latDeg, site.lonDeg);
  const p = rotate(pose.position);
  return { positionBodyM: [p[0] + origin[0], p[1] + origin[1], p[2] + origin[2]], forwardBody: rotate(pose.forward), upBody: rotate(pose.up), fovDeg: pose.fovDeg };
}

function applyTransit(x: Transit): void {
  const pose = poseAlongDescent(x.orbit, x.eye, Math.hypot(...x.originBodyM), x.t);
  moon.setExternalPose(toBodyPose(pose, x.originBodyM, x.site));
  surface.setExternalPose(pose);
  const share = surfaceShare(distanceFromEye(pose, x.eye), x.farM, x.nearM);
  setSurfaceShare(share);
  moon.setSkyExposure(ORBIT_SKY_EXPOSURE + ((enhancedSky ? ENHANCED_SKY_EXPOSURE : 0) - ORBIT_SKY_EXPOSURE) * Math.min(1, x.t * 1.6));
  // The controls belong to whichever picture is in front.
  const view: View = share >= 0.5 ? 'surface' : 'overview';
  if (state.view !== view) {
    state.view = view;
    showLayers(view);
    renderPointCard();
  }
}

function stepTransit(now: number): void {
  const x = transit;
  if (!x) return;
  const token = x.token;
  if (x.last !== null) x.t = Math.min(1, Math.max(0, x.t + (x.direction * Math.min(0.1, (now - x.last) / 1000)) / x.durationS));
  x.last = now;
  applyTransit(x);
  if (transit !== x || x.token !== token) return;
  if ((x.direction === 1 && x.t >= 1) || (x.direction === -1 && x.t <= 0)) finishTransit(x);
  else requestAnimationFrame(stepTransit);
}

function finishTransit(x: Transit): void {
  transit = null;
  surface.setExternalPose(null);
  if (x.t >= 1) {
    setSurfaceShare(1);
    state.view = 'surface';
    showLayers('surface');
    ui.surfaceKeys.textContent = SURFACE_KEYS;
    renderSurface();
    renderPointCard();
  } else {
    setSurfaceShare(0);
    moon.releaseExternalPose(x.ascentTo);
    moon.setSkyExposure(ORBIT_SKY_EXPOSURE);
    state.view = 'overview';
    showLayers('overview');
    // A candidate list survives the visit only if nothing invalidated it (time, height, point, region).
    if (candidateResults.length) {
      candidatePanel.setVisible(true);
      ui.hint.textContent = REGION_HINT;
    } else ui.hint.textContent = ORBIT_HINT;
    refreshObservation();
  }
  for (const done of x.waiters) done();
}

/** Resolves when the current descent or ascent has ended, whichever way it ended. */
function transitEnded(): Promise<void> {
  const x = transit;
  return x ? new Promise((resolve) => x.waiters.push(resolve)) : Promise.resolve();
}

/** Turn a descent into an ascent or back, from exactly where it is. */
function reverseTransit(): void {
  if (!transit) return;
  transit.direction = transit.direction === 1 ? -1 : 1;
  ui.hint.textContent = transit.direction === 1 ? DESCENT_HINT : 'Returning to Orbit…';
}

/** Leave the first-person view at once, with no flight (used when its ground no longer matches the selected point). */
function snapToOrbit(): void {
  const x = transit;
  if (!x && state.view !== 'surface') return;
  transit = null;
  transitToken += 1;
  surface.setExternalPose(null);
  surface.releaseMouse();
  setSurfaceShare(0);
  moon.releaseExternalPose('saved');
  moon.setSkyExposure(ORBIT_SKY_EXPOSURE);
  state.view = 'overview';
  showLayers('overview');
  renderPointCard();
  if (x) for (const done of x.waiters) done();
}

function beginTransit(direction: 1 | -1, orbit: CameraPose, eye: CameraPose, origin: Vec3, site: Site, ascentTo: 'saved' | Vec3): void {
  const startDistance = Math.max(10, distanceFromEye(orbit, eye));
  const onTerrain = state.ground === 'terrain';
  transitToken += 1;
  transit = {
    token: transitToken, direction, t: direction === 1 ? 0 : 1,
    durationS: 2.4 + 0.5 * Math.log10(startDistance / 10),
    orbit, eye, originBodyM: origin, site,
    // On the smooth sphere the two pictures differ in ground height, so they change over higher up.
    farM: onTerrain ? 7000 : 120000, nearM: onTerrain ? 2600 : 40000,
    ascentTo, last: null, waiters: [],
  };
  applyTransit(transit);
  requestAnimationFrame(stepTransit);
}

/** Descend to a site in one continuous move and stand on it. Resolves when the move has ended (either way). */
async function enterSurface(id: SiteId): Promise<void> {
  setActive(id);
  if (transit) {
    if (transit.direction === -1) reverseTransit();
    return transitEnded();
  }
  if (state.view === 'surface') {
    prepareSurfaceGround();
    renderSurface();
    return;
  }
  if (state.view === 'space') {
    state.view = 'overview';
    showLayers('overview');
    moon.setMode('overview');
  }
  candidatePanel.setVisible(false);
  const { site } = state.sites[id];
  prepareSurfaceGround();
  renderSurface();
  // Frame a real, unobstructed body and its skyline when available, never lift a hidden body.
  // This only chooses the camera heading; the card keeps the finite-DEM uncertainty.
  const picture = surface.probe();
  if (pointInfo.sun && pointInfo.sun.altDeg >= 0 && !picture.centreRayHitsMesh.sun && !picture.contextHides.sun) surface.lookAt('sun', true);
  else if (pointInfo.earth && pointInfo.earth.altDeg >= 0 && !picture.centreRayHitsMesh.earth && !picture.contextHides.earth) surface.lookAt('earth', true);
  else if (!surface.lookAtRelief(true)) surface.lookAt('sun', true);
  const origin = surfaceOrigin(site);
  ui.hint.textContent = DESCENT_HINT;
  beginTransit(1, toLocalPose(moon.getPose(), origin, site), surface.getEyePose(), origin, site, 'saved');
  return transitEnded();
}

async function setView(view: 'overview' | 'space'): Promise<void> {
  endExperience();
  if (transit) {
    if (transit.direction === 1) reverseTransit();
    await transitEnded();
  } else if (state.view === 'surface') {
    surface.releaseMouse();
    if (hasWalked) returnToEntry();
    const { site } = state.sites[state.active];
    const origin = surfaceOrigin(site);
    // Return to the actual orbital view, including its anchor and distance limits.
    const target = moon.savedPoseBody() ?? moon.regionPoseBody(origin);
    beginTransit(-1, toLocalPose(target, origin, site), surface.getEyePose(), origin, site, 'saved');
    await transitEnded();
  }
  if (state.view === 'surface' || state.view === view) return; // turned back, or already there
  state.view = view;
  showLayers(view);
  moon.setMode(view);
  renderPointCard();
}

// A press on the picture can turn a descent back at any point.
for (const host of [ui.sceneHost, ui.surfaceHost]) {
  host.addEventListener('pointerdown', () => { if (transit && transit.direction === 1) reverseTransit(); }, true);
}

// ---------- scenarios ----------

function analyseScenario(scenario: Scenario): ScenarioResult {
  const data = state.data;
  if (!data) throw new Error('No ephemeris data loaded.');
  let startEt: number;
  try {
    startEt = utcToEt(data, scenario.startUtc);
  } catch {
    throw new Error(`Start is outside the available data (${data.coverage.startUtc} to ${data.coverage.endUtc}).`);
  }
  if (scenario.datasetId !== data.id) throw new Error(`Saved for dataset ${scenario.datasetId}; the loaded dataset is ${data.id}.`);
  // Strict: the requested window is analysed exactly as written, or not at all. Dates are never moved or shortened.
  const endEt = startEt + scenario.durationSeconds;
  if (endEt > data.coverage.endEt) throw new Error(`The window extends beyond the available data (ends ${data.coverage.endUtc}). Change the start or the duration; dates are never shifted automatically.`);
  const analysis = analysisFor(data, { ...scenario.site }, scenario.observerHeightM, { startEt, endEt });
  return { analysis, startUtc: etToUtc(data, startEt), endUtc: etToUtc(data, endEt) };
}

const scenarioPanel = new ScenarioPanel(el<HTMLDivElement>('scenarios-body'), {
  datasetId: () => state.data?.id ?? null,
  nowUtc: () => (state.data && state.et !== null ? formatUtcSecond(etToUtc(state.data, state.et)) : null),
  seeds: () => ({
    a: { name: `A · ${state.sites.a.name}`, latDeg: state.sites.a.site.latDeg, lonDeg: state.sites.a.site.lonDeg, observerHeightM: state.sites.a.heightM },
    b: { name: `B · ${state.sites.b.name}`, latDeg: state.sites.b.site.latDeg, lonDeg: state.sites.b.site.lonDeg, observerHeightM: state.sites.b.heightM },
  }),
  analyse: analyseScenario,
  load: (target, scenario) => {
    const data = state.data;
    if (!data) return;
    let result: ScenarioResult;
    try {
      result = analyseScenario(scenario);
    } catch (error) {
      ui.timeError.textContent = errorText(error);
      return;
    }
    setPlaying(false);
    setSite(target, { site: { ...scenario.site }, heightM: scenario.observerHeightM, name: scenario.name, sourceText: 'Loaded from a saved scenario (reference-sphere model).', sourceUrl: null });
    state.et = result.analysis.period.startEt;
    setPeriod(result.analysis.period);
    ui.dialogs.scenarios.close();
    if (state.view !== 'surface') frameSite(target);
  },
});

// ---------- mission window, experience and guided demo ----------

const missionFormat: MissionFormat = {
  when: (et) => {
    if (!state.data) return '—';
    try {
      return formatUtcMinute(etToUtc(state.data, et));
    } catch {
      return 'a time outside the prepared data';
    }
  },
  duration: formatDuration,
};

function requireData(): EphemerisData {
  if (!state.data) throw new Error('No ephemeris data is loaded.');
  return state.data;
}

const missionPanel = new MissionPanel({
  data: () => state.data,
  site: (id) => ({ name: state.sites[id].name, site: state.sites[id].site, heightM: state.sites[id].heightM }),
  viewEt: () => state.et,
  comparisonPeriod: () => state.period,
  format: missionFormat,
  parseUtc: (text, what) => parseUtcText(requireData(), text, what),
  // Rounded UP to a whole second so a copied window start is never a fraction of a second before the window.
  utcText: (et) => `${new Date(Math.ceil(Date.parse(etToUtc(requireData(), et)) / 1000) * 1000).toISOString().slice(0, 19)}Z`,
  setHeight,
  openCatalogue: (id) => {
    setActive(id);
    ui.dialogs.catalogue.showModal();
  },
  goTo: (et) => jumpTo(et),
  experience: (plan) => void startExperience(plan),
});
el<HTMLDivElement>('mission-host').append(missionPanel.root);

interface Experience {
  plan: ExperiencePlan;
  /** Where accelerated playback pauses, from the science module; null when there is nothing to wait for. */
  stop: ExperienceStop | null;
  playing: boolean;
  lastFrame: number | null;
  /** Explanation shown after a pause or a recalculation. */
  note: string;
  rate: string;
}
let experience: Experience | null = null;

function evaluateStop(request: MissionRequest): ExperienceStop | null {
  const result = findMissionWindow(requireData(), request);
  return experienceStop(result.current, request, missionFormat, result.nearest ? result.nearest.startEt : null);
}

function renderExperience(): void {
  const x = experience;
  ui.experience.root.hidden = x === null;
  if (!x) return;
  const ahead = x.stop !== null && state.et !== null && x.stop.et > state.et;
  const status = x.note !== ''
    ? x.note
    : ahead ? `${x.stop!.heading}.`
      : x.stop ? 'Past the pause point: Play now runs time on freely.'
        : 'The condition is not met at this start and the search found no later suitable window, so there is no pause point. Play runs time freely.';
  const text = `Experience · ${SITE_NAME[x.plan.siteId]} · ${x.plan.label} · reference-sphere result. ${status}`;
  if (ui.experience.text.textContent !== text) ui.experience.text.textContent = text;
  ui.experience.play.textContent = x.playing ? '❚❚ Pause' : '▶ Play';
  ui.experience.play.setAttribute('aria-pressed', String(x.playing));
  const rate = x.playing ? `Now ${x.rate}` : 'Paused';
  if (ui.experience.rate.textContent !== rate) ui.experience.rate.textContent = rate;
}

function endExperience(): void {
  if (!experience) return;
  experience = null;
  renderExperience();
}

/**
 * Put the plan's site, height, model and start into the app's single state and stand on the surface.
 * Nothing is locked: the look buttons, height, time controls and tabs all keep working.
 */
async function startExperience(plan: ExperiencePlan): Promise<void> {
  const data = state.data;
  if (!data) return;
  let stop: ExperienceStop | null;
  try {
    stop = evaluateStop(plan.request);
  } catch (error) {
    ui.timeError.textContent = `Experience unavailable: ${errorText(error)}`;
    return;
  }
  setPlaying(false);
  setAnalysisOpen(false);
  experience = null;
  const { site, observerHeightM, currentStartEt } = plan.request;
  const s = state.sites[plan.siteId];
  // Mission results are reference-sphere results, so the experience stands on the reference sphere.
  // Chosen before the point moves: this is the explicit, labelled model of the experience bar.
  state.ground = 'sphere';
  if (s.site.latDeg !== site.latDeg || s.site.lonDeg !== site.lonDeg) {
    setSite(plan.siteId, { site: { ...site }, heightM: observerHeightM, name: 'mission point', sourceText: 'Point of a mission query, on the smooth reference sphere.', sourceUrl: null });
  } else {
    setHeight(plan.siteId, observerHeightM);
  }
  const last = stop ? Math.max(stop.et, currentStartEt) : currentStartEt;
  if (state.period && (currentStartEt < state.period.startEt || last > state.period.endEt)) {
    state.et = currentStartEt;
    setPeriod(coverage(data));
  }
  setEt(currentStartEt);
  const mine: Experience = { plan, stop, playing: false, lastFrame: null, note: '', rate: '' };
  experience = mine;
  renderExperience();
  await enterSurface(plan.siteId);
  if (experience !== mine) return;
  if (state.view !== 'surface') return endExperience();
  surface.lookAt(stop?.lookAt ?? (plan.request.condition === 'earth' ? 'earth' : 'sun'));
}

/** After the site or height of the experienced site changed: recompute the pause point for the new values. */
function reevaluateExperience(id: SiteId): void {
  const x = experience;
  if (!x || x.plan.siteId !== id) return;
  const s = state.sites[id];
  const old = x.plan.request;
  if (old.site.latDeg === s.site.latDeg && old.site.lonDeg === s.site.lonDeg && old.observerHeightM === s.heightM) return;
  const request: MissionRequest = { ...old, site: { latDeg: s.site.latDeg, lonDeg: s.site.lonDeg, heightAboveReferenceSphereM: 0 }, range: { ...old.range }, observerHeightM: s.heightM };
  x.playing = false;
  x.plan = { ...x.plan, request };
  try {
    x.stop = evaluateStop(request);
    x.note = `The site or height changed, so the pause point was recalculated for the new values${x.stop ? `: ${x.stop.heading.replace(/^Playing toward /, '')}` : ' (none found)'}.`;
  } catch (error) {
    x.stop = null;
    x.note = `The pause point could not be recalculated: ${errorText(error)}`;
  }
  renderExperience();
}

function setExperiencePlaying(playing: boolean): void {
  const x = experience;
  if (!x) return;
  if (playing) setPlaying(false);
  x.playing = playing && state.et !== null && state.period !== null;
  x.lastFrame = null;
  if (x.playing) {
    x.note = '';
    x.rate = formatSpeed(Number(ui.experience.speed.value));
    requestAnimationFrame(experienceTick);
  }
  renderExperience();
}

function experienceTick(now: number): void {
  const x = experience;
  if (!x || !x.playing || state.et === null || !state.period || !state.data) return;
  if (x.lastFrame !== null) {
    const dt = Math.min(0.25, (now - x.lastFrame) / 1000);
    const stopEt = x.stop && x.stop.et > state.et ? x.stop.et : null;
    const step = playbackStep(state.et, dt, Number(ui.experience.speed.value), stopEt);
    x.rate = `${formatSpeed(step.speed)}${step.slowed ? ' — slowed down near the end' : ''}`;
    if (!step.reachedStop && step.et >= state.period.endEt) {
      setEt(state.period.endEt);
      x.playing = false;
      x.note = state.period.endEt >= state.data.coverage.endEt
        ? 'Paused: the prepared data ends here. Nothing is extrapolated beyond it.'
        : 'Paused at the end of the comparison period.';
      renderExperience();
      return;
    }
    setEt(step.et);
    if (step.reachedStop && x.stop) {
      x.playing = false;
      x.note = x.stop.reached;
      if (x.stop.lookAt) surface.lookAt(x.stop.lookAt);
      renderExperience();
      return;
    }
    renderExperience();
  }
  x.lastFrame = now;
  requestAnimationFrame(experienceTick);
}

ui.experience.play.addEventListener('click', () => setExperiencePlaying(!experience?.playing));
ui.experience.speed.addEventListener('change', () => {
  if (experience?.playing) experience.rate = formatSpeed(Number(ui.experience.speed.value));
  renderExperience();
});
ui.experience.restart.addEventListener('click', () => {
  const x = experience;
  if (!x) return;
  setExperiencePlaying(false);
  x.note = '';
  jumpTo(x.plan.request.currentStartEt);
  renderExperience();
  surface.lookAt(x.stop?.lookAt ?? (x.plan.request.condition === 'earth' ? 'earth' : 'sun'));
});
ui.experience.end.addEventListener('click', () => endExperience());

const demo = new GuidedDemo(el<HTMLDivElement>('demo'), {
  data: () => state.data,
  loadFixture: () => fetchJson(DEMO_URL),
  panel: missionPanel,
  format: missionFormat,
  parseUtc: (text, what) => parseUtcText(requireData(), text, what),
  setSite: (id, site, name, heightM) => setSite(id, {
    site: { latDeg: site.latDeg, lonDeg: normalizeLonDeg(site.lonDeg), heightAboveReferenceSphereM: 0 },
    heightM,
    name,
    sourceText: 'Point of the prepared guided demo, on the smooth reference sphere. Illustrative; not a landing site.',
    sourceUrl: null,
  }),
  setPeriod: (period) => {
    setPlaying(false);
    setPeriod(period);
  },
  showFromOrbit: (id, et) => {
    jumpTo(et);
    setActive(id);
    if (state.view === 'surface') void setView('overview');
    else frameSite(id);
  },
  experience: (plan) => void startExperience(plan),
});
const demoButton = button('Guided demo', 'btn', 'A five-step example with real data: a start that fails, one explicit change, and the view from the surface');
demoButton.addEventListener('click', () => void demo.start());
missionPanel.addAction(demoButton);

// ---------- events ----------

moon.onPick((latDeg, lonDeg) => {
  if (state.view !== 'overview') return;
  setSite(state.active, { site: { latDeg, lonDeg: normalizeLonDeg(lonDeg), heightAboveReferenceSphereM: 0 }, heightM: state.sites[state.active].heightM, name: 'custom point', sourceText: 'Custom point picked on the globe, on the smooth reference sphere.', sourceUrl: null });
});
moon.onTextureState((textureState, message) => {
  if (textureState === 'error') showOverlay(message ?? 'Texture error');
});
surface.onView((view) => {
  const compassDefined = Math.abs(state.sites[state.active].site.latDeg) !== 90;
  const heading = view.headingDeg === null ? 'heading —' : compassDefined ? `heading ${view.headingDeg.toFixed(0)}° ${compassPoint(view.headingDeg)}` : 'compass undefined at the exact pole';
  ui.surfaceCompass.textContent = `${heading} · pitch ${formatSignedDeg(view.pitchDeg, 0)} · field of view ${view.fovDeg.toFixed(0)}°`;
});
surface.onPosition((sample, boundary) => {
  // Only the position follows the walker. The scientific observer height is the user's (or a scenario's) value
  // and is never inferred from the camera, which is drawn no lower than the display minimum.
  const previous = state.sites[state.active];
  state.sites[state.active] = { ...previous, site: { ...sample.site } };
  hasWalked = !!surfaceEntry && (Math.abs(sample.site.latDeg - surfaceEntry.site.latDeg) > 1e-8 || Math.abs(sample.site.lonDeg - surfaceEntry.site.lonDeg) > 1e-8);
  renderSurface(); renderPointCard();
  ui.surfaceKeys.textContent = boundary ? 'Edge of terrain data — walking stops here. Terrain beyond the prepared mesh is unknown.' : SURFACE_KEYS;
});
surface.onPointerLock((locked) => {
  const control = el<HTMLButtonElement>('mouse-look');
  control.textContent = locked ? 'Mouse captured · Escape to release' : 'Enter mouse look';
  control.setAttribute('aria-pressed', String(locked));
});
el<HTMLButtonElement>('mouse-look').addEventListener('click', () => {
  if (document.pointerLockElement) surface.releaseMouse();
  else void surface.enterMouseLook().catch(() => { ui.surfaceKeys.textContent = 'Mouse capture unavailable — drag to look instead. WASD still walks within the DEM.'; });
});
/** Put the walker back and make the selected point exactly the one that was entered, not a re-sampled neighbour. */
function returnToEntry(): void {
  surface.returnToPoint();
  if (surfaceEntry) state.sites[state.active] = { ...surfaceEntry, site: { ...surfaceEntry.site }, heightM: state.sites[state.active].heightM };
  hasWalked = false;
  if (state.view === 'surface') renderSurface();
  renderPointCard();
  ui.surfaceKeys.textContent = SURFACE_KEYS;
}
el<HTMLButtonElement>('return-point').addEventListener('click', returnToEntry);
for (const [id, enhanced] of [['sky-natural', false], ['sky-enhanced', true]] as const) {
  el<HTMLButtonElement>(id).setAttribute('aria-pressed', String(enhanced));
  el<HTMLButtonElement>(id).addEventListener('click', () => {
    surface.setEnhancedSky(enhanced);
    enhancedSky=enhanced;renderPointCard();
    el<HTMLButtonElement>('sky-natural').setAttribute('aria-pressed', String(!enhanced));
    el<HTMLButtonElement>('sky-enhanced').setAttribute('aria-pressed', String(enhanced));
    ui.surfaceKeys.textContent = enhanced ? 'Enhanced sky: the real NASA star map at raised exposure; its orientation is illustrative, not for navigation. Calculations unchanged.' : 'Natural exposure: black sky as beside sunlit ground. Calculations unchanged.';
  });
}

ui.tabs.overview.addEventListener('click', () => void setView('overview'));
ui.spaceButton.addEventListener('click', () => void setView(state.view === 'space' ? 'overview' : 'space'));
ui.tabs.surface.addEventListener('click', () => requestExplore(state.active));

function setAnalysisOpen(open: boolean): void {
  ui.analysis.hidden = !open;
  if (open) missionPanel.sync();
  if (open) { surface.releaseMouse(); refreshAnalysis(); refreshObservation(); }
  if (open && state.terrain && state.data && state.et!==null && terrainAvailableAt(state.sites[state.active].site)) {
    const selected=state.sites[state.active];
    const full=observeTerrain(state.data,state.et,selected.site,selected.heightM,state.terrain);
    visibleTerrainProfile=full.profile;terrainProfile.update(full.profile,full.observation);
  }
  ui.openAnalysis.setAttribute('aria-expanded', String(open));
  document.body.dataset['analysis'] = open ? 'open' : 'closed';
}
ui.openAnalysis.addEventListener('click', () => setAnalysisOpen(ui.analysis.hidden !== false));
el<HTMLButtonElement>('close-analysis').addEventListener('click', () => setAnalysisOpen(false));
el<HTMLButtonElement>('look-sun').addEventListener('click', () => surface.lookAt('sun'));
el<HTMLButtonElement>('look-earth').addEventListener('click', () => surface.lookAt('earth'));
el<HTMLButtonElement>('look-north').addEventListener('click', () => surface.lookHeading(0));

groundSphere.addEventListener('click', () => {
  state.ground = 'sphere';
  prepareSurfaceGround();
  renderSurface();
  renderPointCard();
});
groundTerrain.addEventListener('click', () => {
  state.ground = 'terrain';
  prepareSurfaceGround();
  renderSurface();
  renderPointCard();
});
terrainPoint.addEventListener('click', () => {
  const patch = state.terrain;
  if (!patch) return;
  state.ground = 'terrain';
  setSite(state.active, {
    site: { latDeg: patch.observer.site.latDeg, lonDeg: normalizeLonDeg(patch.observer.site.lonDeg), heightAboveReferenceSphereM: 0 },
    heightM: EYE_HEIGHT_M,
    name: 'Prepared LOLA region',
    sourceText: 'The one checked point inside the LOLA terrain patch. Cards and timelines still use the reference sphere here.',
    sourceUrl: patch.source.productPage,
  });
  void enterSurface(state.active);
});

ui.periodForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = state.data;
  if (!data) return;
  try {
    const startEt = parseUtcField(data, ui.periodStart, 'Period start');
    const endEt = parseUtcField(data, ui.periodEnd, 'Period end');
    if (!(startEt < endEt)) throw new Error('Period start must be earlier than period end.');
    setPlaying(false);
    ui.periodError.textContent = '';
    setPeriod({ startEt, endEt });
  } catch (error) {
    ui.periodError.textContent = errorText(error);
  }
});

ui.periodFull.addEventListener('click', () => {
  const data = state.data;
  if (!data) return;
  setPlaying(false);
  ui.periodError.textContent = '';
  setPeriod(coverage(data));
});

ui.utcForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const { data, period } = state;
  if (!data || !period) return;
  try {
    const et = parseUtcField(data, ui.utcInput, 'Current time');
    if (et < data.coverage.startEt || et > data.coverage.endEt) throw new Error('Current time is outside the prepared data. Choose a covered UTC date.');
    setPlaying(false);
    setEt(et);
    ui.utcInput.blur();
  } catch (error) {
    ui.timeError.textContent = errorText(error);
  }
});

ui.slider.addEventListener('input', () => {
  setPlaying(false);
  setEt(Number(ui.slider.value));
});

ui.play.addEventListener('click', () => {
  if (!state.period || state.et === null) return;
  if (!state.playing && state.et >= state.data!.coverage.endEt) setEt(state.data!.coverage.startEt);
  setPlaying(!state.playing);
});

for (const [id, delta] of Object.entries(STEP_BUTTONS)) {
  el<HTMLButtonElement>(id).addEventListener('click', () => {
    if (state.et === null) return;
    setPlaying(false);
    setEt(state.et + delta);
  });
}

el<HTMLButtonElement>('view-region').addEventListener('click', () => {
  if (!state.terrain) return;
  moon.flyToRegion(groundPoint(state.terrain.observer.site));
  ui.hint.textContent = REGION_HINT;
});
el<HTMLButtonElement>('look-relief').addEventListener('click', () => { if (!surface.lookAtRelief()) surface.lookHeading(0); });
el<HTMLButtonElement>('view-near').addEventListener('click', () => { moon.flyHome(); ui.hint.textContent = ORBIT_HINT; });
el<HTMLButtonElement>('view-point').addEventListener('click', () => {
  const { site } = state.sites[state.active];
  // Close in where there is measured terrain to see; otherwise the whole Moon turned to the point.
  if (terrainAvailableAt(site)) { moon.flyToRegion(groundPoint(site)); ui.hint.textContent = REGION_HINT; }
  else { frameSite(state.active); ui.hint.textContent = ORBIT_HINT; }
});
el<HTMLButtonElement>('time-now').addEventListener('click', () => {
  if (!state.data) return;
  try { const now=utcToEt(state.data,new Date().toISOString());setPlaying(false);setEt(now); }
  catch { ui.timeError.textContent='Now is outside the prepared UTC range. Choose a covered date; the time was not moved.'; }
});

for (const dialog of Object.values(ui.dialogs)) setupDialog(dialog);
el<HTMLButtonElement>('open-catalogue').addEventListener('click', () => ui.dialogs.catalogue.showModal());
el<HTMLButtonElement>('open-scenarios').addEventListener('click', () => {
  scenarioPanel.open();
  ui.dialogs.scenarios.showModal();
});
const openData = (): void => {
  surface.releaseMouse();
  renderDataPanel(el<HTMLDivElement>('data-body'), { data: state.data, dataUrl: state.dataUrl, dataError: state.dataError, terrain: state.terrain, terrainError: state.terrainError });
  const extra=make('section','immersive-accuracy');
  extra.append(make('h3','','Explorer model & appearance'),make('p','','First person uses a shared triangle mesh from the real LOLA 80 m grid. Eyes default to 1.7 m above that same ground. The finite 8 km patch cannot certify distant horizon clearance or route safety. Walking stops at a 160 m coverage margin. Slope is a triangle-scale estimate, not a landing-safety score.'),
    make('p','','Sun and Earth are drawn on their SPICE directions and are hidden by the drawn terrain, including its coarser visual surroundings, so a disc can show partly. The card reports only the ray to each body centre against the detailed scientific patch: “blocked by terrain” or “terrain unknown”. No visible fraction of a disc is calculated, and nothing is moved above the horizon. Ground shading and shadows come from the same mesh and the real Sun direction; they are finite-DEM shading, not solar-disc photometry.'),
    make('p','','On arrival the camera faces the calculated Sun and its skyline when its centre ray is not hidden in the drawn terrain, otherwise Earth when available, otherwise the measured relief. This is a viewing choice, not a certified visibility result or a score. The fine grain on nearby ground is colour only, added so movement is perceptible; it carries no relief, and the 80 m grid resolves no rocks.'),
    make('p','','The search covers only the named polygon given in the result list, sampled at 25 grid points. It does not scan the whole 8 km terrain patch or the Moon. Shown points are a display shortlist: points with a body blocked by measured terrain go last, otherwise the reference-sphere order is kept. No point is called confirmed unless the measured terrain confirms it; unknown terrain is not a pass.'),
    make('p','','One Moon is drawn throughout. Inside the thin amber line is the measured 80 m terrain that every calculation uses. Around it, an 80 km area of the same LOLA product at 800 m and a global LOLA map sampled at about 7.6 km (overview mesh steps up to 1 degree) are drawn so the terrain sits in its real surroundings; they are joined vertex to vertex with no added walls. These surroundings are a picture only (' + (state.host ? `context: ${state.host.surroundings.context === 'real-800m' ? 'loaded' : 'not loaded'}, global relief: ${state.host.surroundings.globe === 'real-global' ? 'loaded' : 'not loaded, smooth reference globe'}` : 'not built') + '). They can hide a body or cast a shadow in the picture, and a label then says “picture only, not calculated”; visibility results, slopes, candidates and the ground you walk on never use them. From regional height a neutral fill light is added so relief stays readable; it is not physical and fades out on the way down.'),
    make('p','','Lighting & Earth visibility candidates compare a reproducible 25-point regional grid at the displayed UTC instant. Points blocked by the measured terrain are listed last. Within each group the reference-sphere order is kept: both centres up, Sun up, Earth up, remaining current joint duration, Sun altitude. Incomplete terrain coverage remains unknown, never a confirmed pass.'),
    make('p','','Sky: the NASA Scientific Visualization Studio “Deep Star Maps 2020” combined map (Hipparcos-2, Tycho-2 and Gaia DR2 stars with the Milky Way), 4096 × 2048, converted from the full 4k OpenEXR source without a generated star layer. Its projection and handedness are correct and the Moon’s axis is set on the ecliptic pole, but its rotation about that axis is illustrative: it is not computed for the displayed UTC and must not be used for navigation or timing. Enhanced shows it at raised exposure; Natural shows the black sky seen beside sunlit ground. Neither changes any calculation. Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio; Gaia DR2: ESA/Gaia/DPAC.'),
    make('p','','Earth: NASA Blue Marble Next Generation (January 2004, with topography and bathymetry; credit NASA Earth Observatory, R. Stöckli), 4096 × 2048, without clouds. Its direction and angular size come from SPICE, and its day and night sides are lit from the calculated Sun direction with a small illustrative night-side fill (brightness is not calibrated). The face turned toward the Moon is illustrative: Earth’s rotation is not calculated. The Sun is drawn at its true angular size with limb darkening and a small glare; its brightness is not to scale. Terrain shading uses the drawn meshes; no rocks or sub-grid terrain are synthesized.'),
    state.pictureNotes.length ? make('p','', `Not loaded in this session: ${state.pictureNotes.join('; ')}. Nothing was substituted for it.`) : make('span'));
  const link=make('a','','NASA SVS Deep Star Maps 2020');link.href='https://svs.gsfc.nasa.gov/4851/';link.target='_blank';link.rel='noopener noreferrer';extra.append(link, document.createTextNode(' · '));
  const earthLink=make('a','','NASA Blue Marble Next Generation');earthLink.href='https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/';earthLink.target='_blank';earthLink.rel='noopener noreferrer';extra.append(earthLink);
  el<HTMLDivElement>('data-body').append(extra);
  ui.dialogs.data.showModal();
};
el<HTMLButtonElement>('open-data').addEventListener('click', openData);

renderCatalogue(el<HTMLDivElement>('catalogue-body'), (target, entry) => {
  setSite(target, { ...entrySite(entry), heightM: state.sites[target].heightM });
  setActive(target);
  ui.dialogs.catalogue.close();
  if (state.view !== 'surface') frameSite(target);
});

document.addEventListener('keydown', (event) => {
  // Escape also works while Explore (or a time field) still owns keyboard focus.
  if (event.code === 'Escape' && transit && transit.direction === 1) {
    event.preventDefault();
    reverseTransit();
    return;
  }
  const target = event.target as HTMLElement | null;
  if (target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'].includes(target.tagName)) return;
  if (document.querySelector('dialog[open]')) return;
  if (event.code === 'Space') {
    event.preventDefault();
    ui.play.click();
  }
  if (event.code === 'Escape' && !ui.analysis.hidden && document.pointerLockElement === null) setAnalysisOpen(false);
});

// ---------- status and loading ----------

function setStatus(text: string, tone: 'info' | 'ok' | 'error'): void {
  ui.status.textContent = text;
  ui.status.dataset['tone'] = tone;
}

function showOverlay(message: string | null): void {
  ui.overlay.textContent = message ?? '';
  ui.overlay.hidden = message === null;
}

function enableTimeControls(enabled: boolean): void {
  for (const node of [ui.periodStart, ui.periodEnd, ui.periodApply, ui.periodFull, ui.utcInput, ui.utcApply, ui.slider, ui.play, ui.speed]) node.disabled = !enabled;
  for (const id of Object.keys(STEP_BUTTONS)) el<HTMLButtonElement>(id).disabled = !enabled;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) throw new Error(`${url} was not found (the server returned ${contentType || 'an unknown type'})`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${url} is not valid JSON`);
  }
}

/** Note something about the picture that is not as intended; shown compactly, never hidden. */
function pictureNote(note: string): void {
  if (!state.pictureNotes.includes(note)) state.pictureNotes.push(note);
  renderPointCard();
}
const ASSET_NOTE = {
  sky: 'Star map not loaded: the sky is black',
  earth: 'Earth map not loaded: plain disc',
} as const;
moon.onAssetState((asset, assetState) => { if (assetState === 'error') pictureNote(ASSET_NOTE[asset]); });
surface.onAssetState((asset, assetState) => { if (assetState === 'error') pictureNote(ASSET_NOTE[asset]); });

/**
 * Visual-context assets around the scientific patch. Each is optional: what fails to load or to pass its
 * checks is left out and named, and the patch is then joined to what remains (down to the reference sphere).
 */
async function loadVisualContext(patch: TerrainPatch): Promise<void> {
  const detail = buildTerrainMesh(patch);
  let context: RegionalContext | null = null;
  let global: GlobalHeights | null = null;
  try {
    context = parseRegionalContext(await fetchJson(CONTEXT_URL), detail);
  } catch (error) {
    console.warn(errorText(error));
    pictureNote('Regional context not loaded: reference surroundings, not measured terrain');
  }
  try {
    const meta = await fetchJson(GLOBAL_CONTEXT_URL);
    const file = typeof (meta as { dataFile?: unknown }).dataFile === 'string' ? (meta as { dataFile: string }).dataFile : '';
    const response = await fetch(`/data/${file}`, { cache: 'no-cache' });
    if (!file || !response.ok) throw new Error(`Visual context: HTTP ${response.status} for the global height file`);
    global = parseGlobalHeights(meta, await response.arrayBuffer());
  } catch (error) {
    console.warn(errorText(error));
    pictureNote('Global relief not loaded: smooth reference globe');
  }
  state.host = buildMoonHost(detail, context, global);
  moon.setHost(state.host);
}

/** Read-only state for the browser checks (tests/browser/immersive-flow.mjs). Nothing in the app reads it. */
(window as unknown as { __lln?: unknown }).__lln = {
  probe: () => ({
    view: state.view,
    ground: state.ground,
    et: state.et,
    utc: state.data && state.et !== null ? etToUtc(state.data, state.et) : null,
    site: { ...state.sites[state.active].site },
    heightM: state.sites[state.active].heightM,
    cameraEyeM: surface.eyeHeightM,
    hasWalked,
    terrainStatus: lastTerrainStatus,
    bodies: pointInfo.problem === null && pointInfo.sun && pointInfo.earth
      ? { sun: { altDeg: pointInfo.sun.altDeg, azDeg: pointInfo.sun.azDeg, state: pointInfo.sun.state }, earth: { altDeg: pointInfo.earth.altDeg, azDeg: pointInfo.earth.azDeg, state: pointInfo.earth.state } }
      : null,
    subsolar: lastSunDirection ? bodyToLatLon(lastSunDirection) : null,
    candidates: candidateResults.length,
    regionShown: moon.regionShown,
    orbit: { ...moon.controlState, altitudeKm: moon.altitudeKm },
    transit: transit ? { t: transit.t, direction: transit.direction, token: transit.token } : null,
    surfaceShare: ui.surfaceHost.hidden ? 0 : ui.sceneHost.hidden ? 1 : Number(ui.surfaceHost.style.opacity || 1),
    shortlist: candidateShortlist.map((candidate) => candidate.id),
    selectedCandidate: selectedCandidateId,
    surroundings: state.host ? state.host.surroundings : null,
    pictureNotes: [...state.pictureNotes],
    surface: surface.probe(),
  }),
};

async function loadTerrain(): Promise<void> {
  try {
    state.terrain = validateTerrainPatch(await fetchJson(TERRAIN_URL));
    state.terrainError = null;
  } catch (error) {
    state.terrain = null;
    state.terrainError = errorText(error);
  }
  if (state.terrain) await loadVisualContext(state.terrain);
  prepareSurfaceGround();
  syncMarkers();
  findCandidates.disabled = !state.terrain || !state.data;
  if (state.view === 'surface') renderSurface();
}

/**
 * Fresh-start defaults, applied once when the ephemeris and the terrain patch have both loaded:
 * the selected point is the prepared terrain region and the time is a moment when the Sun and Earth
 * are both above the horizon there (taken from the science module's intervals, not invented).
 * Saved scenarios are not touched.
 */
function applyStartDefaults(): void {
  const data = state.data;
  if (!data) return;
  const patch = state.terrain;
  if (patch) {
    state.ground = 'terrain';
    setSite('a', {
      site: { latDeg: -88.89822426645465, lonDeg: 1.440668007133082, heightAboveReferenceSphereM: 0 },
      heightM: EYE_HEIGHT_M,
      name: 'Prepared ridge',
      sourceText: 'Illustrative point on the measured LOLA grid (row 12, column 60), chosen for a readable surface view. Not a mission landing site.',
      sourceUrl: patch.source.productPage,
    });
  }
  setActive('a');
  try {
    const s = state.sites.a;
    const full = analysisFor(data, s.site, s.heightM, coverage(data));
    const inside = (span: TimeInterval): boolean => span.startEt > data.coverage.startEt && span.endEt < data.coverage.endEt;
    const span = full.both.intervals.find((item) => inside(item) && item.endEt - item.startEt >= 2 * 86400) ?? full.sun.intervals.find(inside);
    // Reproducible checked example, not an implicit claim that this is the current date.
    // Both centre rays are locally unobstructed at the prepared point; distant terrain stays unknown.
    const demonstration=utcToEt(data,'2026-11-24T04:00:00Z');
    if (patch) setEt(demonstration);
    else if (span) setEt(span.startEt + Math.min(12 * 3600, (span.endEt - span.startEt) / 2));
  } catch {
    // Keep the start of the data as the time; the card shows any calculation problem.
  }
  frameSite('a');
  missionPanel.sync();
}

async function loadEphemeris(): Promise<void> {
  setStatus('Loading ephemeris…', 'info');
  timeline.clear('Loading ephemeris…');
  ui.comparison.replaceChildren(make('p', 'comparison-wait', 'Waiting for ephemeris data…'));
  const failures: string[] = [];
  for (const url of DATA_URLS) {
    try {
      const data = validateEphemeris(await fetchJson(url));
      state.data = data;
      state.dataUrl = url;
      state.dataError = null;
      enableTimeControls(true);
      const range = `${data.coverage.startUtc.slice(0, 10)} to ${data.coverage.endUtc.slice(0, 10)} UTC`;
      setStatus(url === DATA_URLS[0] ? `Data ready · ${range}` : `Data ready · ${range} (extended dataset not found)`, 'ok');
      setPeriod(coverage(data));
      scenarioPanel.initialise();
      if (scenarioPanel.openedFromLink) ui.dialogs.scenarios.showModal();
      return;
    } catch (error) {
      failures.push(errorText(error));
    }
  }
  state.data = null;
  state.period = null;
  state.et = null;
  state.dataError = failures.join(' | ');
  enableTimeControls(false);
  setStatus('Ephemeris data unavailable', 'error');
  timeline.clear(`No data: ${failures[0] ?? 'unknown error'}`);
  ui.comparison.replaceChildren(make('p', 'comparison-error', `No data: ${failures[0] ?? 'unknown error'}`));
  showOverlay(`Ephemeris not loaded: ${failures[0] ?? 'unknown error'}. Lighting, angles, intervals and events are not shown — no substitute values are used.`);
  refreshObservation();
  missionPanel.sync();
}

for (const id of SITE_IDS) {
  renderSiteCard(id);
}
setActive('a');
showLayers('overview');
setSurfaceShare(0);
prepareSurfaceGround();
refreshObservation();
void Promise.all([loadEphemeris(), loadTerrain()]).then(() => applyStartDefaults());
