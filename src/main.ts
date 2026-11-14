import './style.css';
import type { BodyObservation, Condition, EphemerisData, Observation, Site, SiteAnalysis, TimeInterval } from './contracts';
import { etToUtc, observeAt, utcToEt, validateEphemeris } from './science/index';
import { analyzeObserver, observeObserver } from './science/observer';
import { createExplorer, type Explorer } from './ui/exploration';
import { MoonScene, type SiteId } from './scene/MoonScene';
import { normalizeLonDeg } from './scene/coords';
import { CONDITIONS, CONDITION_DESCRIPTION, CONDITION_LABEL, buildConclusion } from './ui/comparison';
import { compassPoint, formatDuration, formatLatLon, formatPercent, formatSignedDeg, formatUtcMinute, formatUtcSecond } from './ui/format';
import { ARTEMIS_REGIONS_URL, CATALOGUE as PRESETS, findCatalogueEntry as findPreset } from './ui/catalogue';
import { SkyDiagram } from './ui/SkyDiagram';
import { Timeline, type TimelineRow, type TimelineTick } from './ui/Timeline';

const DATA_URL = '/data/ephemeris-2026-10_2027-02.json';
let explorer: Explorer | null = null;
const observerHeights: Record<SiteId, number> = { a: 2, b: 2 };
const SITE_IDS = ['a', 'b'] as const;
const SITE_NAME: Record<SiteId, string> = { a: 'Site A', b: 'Site B' };
const DEFAULT_PRESET: Record<SiteId, string> = { a: 'shackleton', b: 'mons-mouton' };
const ANALYSIS_CACHE_LIMIT = 48;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ---------- static elements ----------

const ui = {
  status: el<HTMLDivElement>('data-status'),
  overlay: el<HTMLDivElement>('scene-overlay'),
  hint: el<HTMLParagraphElement>('pick-hint'),
  sites: el<HTMLElement>('sites'),
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
  credits: el<HTMLDivElement>('data-body'),
};
const STEP_BUTTONS = { 'step-back-day': -86400, 'step-back-hour': -3600, 'step-fwd-hour': 3600, 'step-fwd-day': 86400 } as const;

// ---------- state ----------

interface SiteState {
  site: Site;
  presetId: string | null;
}

interface State {
  data: EphemerisData | null;
  sites: Record<SiteId, SiteState>;
  active: SiteId;
  period: TimeInterval | null;
  et: number | null;
  playing: boolean;
  lastFrame: number | null;
}

function presetSite(id: string): SiteState {
  const preset = findPreset(id);
  if (!preset) throw new Error(`Unknown preset ${id}`);
  return { site: { latDeg: preset.latDeg, lonDeg: preset.lonDeg, heightAboveReferenceSphereM: 0 }, presetId: preset.id };
}

const state: State = {
  data: null,
  sites: { a: presetSite(DEFAULT_PRESET.a), b: presetSite(DEFAULT_PRESET.b) },
  active: 'a',
  period: null,
  et: null,
  playing: false,
  lastFrame: null,
};

const moon = new MoonScene(el<HTMLDivElement>('scene'));
const timeline = new Timeline(el<HTMLDivElement>('timeline'), (et) => {
  setPlaying(false);
  setEt(et);
});
const analysisCache = new Map<string, SiteAnalysis>();

// ---------- site cards ----------

interface SiteCard {
  root: HTMLElement;
  heading: HTMLElement;
  pick: HTMLButtonElement;
  coords: HTMLElement;
  preset: HTMLSelectElement;
  lat: HTMLInputElement;
  lon: HTMLInputElement;
  source: HTMLElement;
  error: HTMLElement;
  sky: SkyDiagram;
  rows: Record<'sun' | 'earth', { alt: HTMLElement; az: HTMLElement; state: HTMLElement }>;
}

function buildSiteCard(id: SiteId): SiteCard {
  const name = SITE_NAME[id];
  const root = make('article', `site-card site-${id}`);
  root.setAttribute('aria-label', name);

  const head = make('header', 'site-head');
  const badge = make('span', 'site-badge', id.toUpperCase());
  const title = make('div', 'site-title');
  const heading = make('h2', undefined, name);
  title.append(heading);
  const coords = make('p', 'site-coords', '—');
  title.append(coords);
  const pick = make('button', 'btn pick', 'Pick on globe');
  pick.type = 'button';
  pick.title = `Make ${name} the site placed by clicking the globe`;
  head.append(badge, title, pick);

  const form = make('form', 'site-form');
  form.noValidate = true;
  const preset = make('select');
  preset.setAttribute('aria-label', `${name} preset location`);
  preset.append(new Option('Custom point', ''));
  for (const p of PRESETS) preset.append(new Option(p.name, p.id));
  const lat = make('input');
  const lon = make('input');
  for (const [input, label, min, max] of [[lat, 'latitude, degrees, north positive', -90, 90], [lon, 'east longitude, degrees', -180, 360]] as const) {
    input.type = 'number';
    input.step = 'any';
    input.min = String(min);
    input.max = String(max);
    input.required = true;
    input.setAttribute('aria-label', `${name} ${label}`);
  }
  lat.placeholder = 'Lat °';
  lon.placeholder = 'Lon °E';
  lat.title = 'Planetocentric latitude, −90 to 90 (south negative)';
  lon.title = 'East-positive longitude, −180 to 360';
  const set = make('button', 'btn', 'Set');
  set.type = 'submit';
  form.append(preset, lat, lon, set);

  const source = make('p', 'site-source');
  const error = make('p', 'field-error');
  error.setAttribute('role', 'alert');

  const skyHost = make('div', 'sky-host');
  const sky = new SkyDiagram(skyHost, name);

  const table = make('div', 'readout');
  const rows = {} as SiteCard['rows'];
  for (const body of ['sun', 'earth'] as const) {
    const label = make('span', `readout-body ${body}`);
    label.append(make('i', `dot dot-${body}`), document.createTextNode(body === 'sun' ? 'Sun' : 'Earth'));
    const alt = make('span', 'readout-value', '—');
    const az = make('span', 'readout-value', '—');
    const stateNode = make('span', 'readout-state', '—');
    alt.title = 'Altitude of the body centre above the reference horizon';
    az.title = 'Azimuth: north = 0°, east = 90°';
    table.append(label, alt, az, stateNode);
    rows[body] = { alt, az, state: stateNode };
  }

  root.append(head, form, source, error, skyHost, table);

  pick.addEventListener('click', () => setActive(id));
  preset.addEventListener('change', () => {
    const chosen = findPreset(preset.value);
    if (chosen) {
      setSite(id, chosen.latDeg, chosen.lonDeg, chosen.id);
      moon.flyToSite(id);
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const latValue = Number(lat.value);
    const lonValue = Number(lon.value);
    if (lat.value.trim() === '' || !Number.isFinite(latValue) || latValue < -90 || latValue > 90) {
      error.textContent = 'Latitude must be a number from −90 to 90.';
      return;
    }
    if (lon.value.trim() === '' || !Number.isFinite(lonValue) || lonValue < -180 || lonValue > 360) {
      error.textContent = 'Longitude must be a number from −180 to 360 (east-positive).';
      return;
    }
    setSite(id, latValue, lonValue, null);
    moon.flyToSite(id);
  });

  return { root, heading, pick, coords, preset, lat, lon, source, error, sky, rows };
}

const cards: Record<SiteId, SiteCard> = { a: buildSiteCard('a'), b: buildSiteCard('b') };
ui.sites.append(cards.a.root, cards.b.root);

function renderSiteCard(id: SiteId): void {
  const card = cards[id];
  const { site, presetId } = state.sites[id];
  const preset = presetId ? findPreset(presetId) : undefined;
  card.heading.textContent = `${SITE_NAME[id]} · ${preset ? preset.name : 'custom point'}`;
  card.coords.textContent = formatLatLon(site.latDeg, site.lonDeg);
  card.preset.value = preset?.id ?? '';
  card.lat.value = String(Number(site.latDeg.toFixed(4)));
  card.lon.value = String(Number(site.lonDeg.toFixed(4)));
  card.error.textContent = '';
  card.source.replaceChildren();
  if (preset) {
    const link = make('a', undefined, 'IAU/USGS Gazetteer');
    link.href = preset.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    card.source.append(`Illustrative: ${preset.kind}, `, link, '. No terrain; not a landing site.');
    card.source.title = 'Feature-centre coordinates from the IAU/USGS Gazetteer, placed on the smooth sphere. Not a designated landing site.';
  } else {
    card.source.textContent = 'Custom point, height 0 m. Planetocentric latitude, east longitude.';
    card.source.title = 'Custom point on the smooth reference sphere at height 0 m.';
  }
}

function setActive(id: SiteId): void {
  state.active = id;
  moon.setActiveSite(id);
  for (const key of SITE_IDS) {
    cards[key].root.classList.toggle('active', key === id);
    cards[key].pick.setAttribute('aria-pressed', String(key === id));
    cards[key].pick.textContent = key === id ? 'Picking on globe' : 'Pick on globe';
  }
  ui.hint.textContent = `Click the Moon to place ${SITE_NAME[id]}. Drag to rotate, scroll to zoom.`;
  explorer?.refresh();
}

function setSite(id: SiteId, latDeg: number, lonDeg: number, presetId: string | null): void {
  state.sites[id] = { site: { latDeg, lonDeg: normalizeLonDeg(lonDeg), heightAboveReferenceSphereM: 0 }, presetId };
  moon.setSite(id, latDeg, state.sites[id].site.lonDeg);
  renderSiteCard(id);
  refreshAnalysis();
  refreshObservation();
}

// ---------- analysis (cached; never per playback frame) ----------

function analysisFor(data: EphemerisData, site: Site, period: TimeInterval): SiteAnalysis {
  const siteId = site === state.sites.b.site ? 'b' : 'a';
  const height = observerHeights[siteId];
  const key = `${data.id}|${site.latDeg}|${site.lonDeg}|${height}|${period.startEt}|${period.endEt}`;
  const cached = analysisCache.get(key);
  if (cached) return cached;
  const result = analyzeObserver(data, site, period, height);
  if (analysisCache.size >= ANALYSIS_CACHE_LIMIT) {
    const oldest = analysisCache.keys().next().value;
    if (oldest !== undefined) analysisCache.delete(oldest);
  }
  analysisCache.set(key, result);
  return result;
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
    analyses = { a: analysisFor(data, state.sites.a.site, period), b: analysisFor(data, state.sites.b.site, period) };
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

// ---------- observation (per time change) ----------

function renderBody(row: SiteCard['rows']['sun'], body: BodyObservation | null): void {
  if (!body) {
    row.alt.textContent = '—';
    row.az.textContent = '—';
    row.state.textContent = 'no data';
    row.state.dataset['tone'] = 'none';
    return;
  }
  row.alt.textContent = `alt ${formatSignedDeg(body.altDeg)}`;
  row.az.textContent = body.azDeg === null ? 'az undefined' : `az ${body.azDeg.toFixed(1)}° ${compassPoint(body.azDeg)}`;
  row.az.title = body.azDeg === null ? 'Azimuth does not exist at an exact pole, the zenith or the nadir' : 'Azimuth: north = 0°, east = 90°';
  row.state.textContent = body.centerAboveReferenceHorizon ? 'above horizon' : 'below horizon';
  row.state.dataset['tone'] = body.centerAboveReferenceHorizon ? 'pos' : 'neg';
}

function refreshObservation(): void {
  const { data, et } = state;
  let sunDirection: Observation['sunDirectionBody'] | null = null;
  let earthDirection: Observation['earthDirectionBody'] | null = null;
  for (const id of SITE_IDS) {
    const card = cards[id];
    let observation: Observation | null = null;
    if (data && et !== null) {
      try {
        observation = observeObserver(data, et, state.sites[id].site, observerHeights[id]);
        card.error.textContent = '';
      } catch (error) {
        card.error.textContent = `Calculation failed: ${errorText(error)}`;
      }
    }
    card.sky.update(observation);
    renderBody(card.rows.sun, observation?.sun ?? null);
    renderBody(card.rows.earth, observation?.earth ?? null);
    if (observation && !sunDirection) {
      sunDirection = observation.sunDirectionBody;
      earthDirection = observation.earthDirectionBody;
      if (document.activeElement !== ui.utcInput) ui.utcInput.value = formatUtcSecond(observation.utc);
    }
  }
  moon.setSunDirection(sunDirection);
  moon.setEarthDirection(earthDirection);
  timeline.setCursor(et);
  if (et !== null && document.activeElement !== ui.slider) ui.slider.value = String(et);
  explorer?.refresh();
}

// ---------- time and period ----------

function setEt(et: number): void {
  const period = state.period;
  if (!period) return;
  state.et = Math.min(period.endEt, Math.max(period.startEt, et));
  ui.timeError.textContent = '';
  refreshObservation();
}

function setPeriod(period: TimeInterval): void {
  const data = state.data;
  if (!data) return;
  state.period = period;
  ui.slider.min = String(period.startEt);
  ui.slider.max = String(period.endEt);
  ui.periodStart.value = formatUtcSecond(etToUtc(data, period.startEt));
  ui.periodEnd.value = formatUtcSecond(etToUtc(data, period.endEt));
  // One state for the current time: clamp it into the new period.
  state.et = Math.min(period.endEt, Math.max(period.startEt, state.et ?? period.startEt));
  refreshAnalysis();
  refreshObservation();
}

function parseUtcField(data: EphemerisData, input: HTMLInputElement, what: string): number {
  const text = input.value.trim();
  if (!/Z$/.test(text)) throw new Error(`${what} must be UTC in ISO 8601 form ending in Z, for example 2026-11-15T12:00:00Z.`);
  try {
    return utcToEt(data, text);
  } catch (error) {
    throw new Error(`${what}: ${errorText(error)}. Available range: ${data.coverage.startUtc} to ${data.coverage.endUtc}.`);
  }
}

function setPlaying(playing: boolean): void {
  state.playing = playing && state.data !== null && state.period !== null;
  state.lastFrame = null;
  ui.play.textContent = state.playing ? '❚❚ Pause' : '▶ Play';
  ui.play.setAttribute('aria-pressed', String(state.playing));
  if (state.playing) requestAnimationFrame(tick);
}

function tick(now: number): void {
  if (!state.playing || !state.period || state.et === null) return;
  if (state.lastFrame !== null) {
    const dt = Math.min(0.25, (now - state.lastFrame) / 1000);
    const next = state.et + dt * Number(ui.speed.value);
    if (next >= state.period.endEt) {
      setEt(state.period.endEt);
      setPlaying(false);
      return;
    }
    setEt(next);
  }
  state.lastFrame = now;
  requestAnimationFrame(tick);
}

// ---------- events ----------

moon.onPick((latDeg, lonDeg) => setSite(state.active, latDeg, lonDeg, null));
moon.onTextureState((textureState, message) => {
  if (textureState === 'error') showOverlay(message ?? 'Texture error');
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
    ui.timeError.textContent = '';
    setPeriod({ startEt, endEt });
  } catch (error) {
    ui.timeError.textContent = errorText(error);
  }
});

ui.periodFull.addEventListener('click', () => {
  const data = state.data;
  if (!data) return;
  setPlaying(false);
  ui.timeError.textContent = '';
  setPeriod({ startEt: data.coverage.startEt, endEt: data.coverage.endEt });
});

ui.utcForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const { data, period } = state;
  if (!data || !period) return;
  try {
    const et = parseUtcField(data, ui.utcInput, 'Current time');
    if (et < period.startEt || et > period.endEt) throw new Error('Current time is outside the comparison period. Change the period or choose a time inside it.');
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
  if (!state.playing && state.et >= state.period.endEt) setEt(state.period.startEt);
  setPlaying(!state.playing);
});

for (const [id, delta] of Object.entries(STEP_BUTTONS)) {
  el<HTMLButtonElement>(id).addEventListener('click', () => {
    if (state.et === null) return;
    setPlaying(false);
    setEt(state.et + delta);
  });
}

el<HTMLButtonElement>('view-south').addEventListener('click', () => moon.flySouthPole());
el<HTMLButtonElement>('view-near').addEventListener('click', () => moon.flyHome());
el<HTMLButtonElement>('view-a').addEventListener('click', () => moon.flyToSite('a'));
el<HTMLButtonElement>('view-b').addEventListener('click', () => moon.flyToSite('b'));

document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(target.tagName)) return;
  if (event.code === 'Space') {
    event.preventDefault();
    ui.play.click();
  }
});

// ---------- status, credits, loading ----------

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

function renderCredits(): void {
  const link = (text: string, href: string): HTMLAnchorElement => {
    const a = make('a', undefined, text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  };
  ui.credits.append(
    'Sources: ',
    link('NASA/JPL NAIF SPICE (DE440)', 'https://naif.jpl.nasa.gov/naif/data.html'),
    ' · texture ',
    link('NASA SVS CGI Moon Kit', 'https://svs.gsfc.nasa.gov/4720'),
    ' (appearance only) · presets ',
    link('IAU/USGS Gazetteer', 'https://planetarynames.wr.usgs.gov/'),
    ' · context ',
    link('NASA Artemis III regions', ARTEMIS_REGIONS_URL),
    '.',
  );
}

async function loadEphemeris(): Promise<void> {
  setStatus('Loading ephemeris…', 'info');
  timeline.clear('Loading ephemeris…');
  ui.comparison.replaceChildren(make('p', 'comparison-wait', 'Waiting for ephemeris data…'));
  try {
    const response = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${DATA_URL}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) throw new Error(`${DATA_URL} was not found (the server returned ${contentType || 'an unknown type'})`);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new Error(`${DATA_URL} is not valid JSON`);
    }
    const data = validateEphemeris(raw);
    state.data = data;
    enableTimeControls(true);
    setStatus(`${data.coverage.startUtc.slice(0, 10)} — ${data.coverage.endUtc.slice(0, 10)} UTC · Reference sphere`, 'ok');
    const initial = utcToEt(data, '2026-11-14T00:00:00Z');
    setPeriod({ startEt: initial, endEt: initial + 7 * 86400 });
    explorer?.loaded();
  } catch (error) {
    state.data = null;
    state.period = null;
    state.et = null;
    enableTimeControls(false);
    const message = errorText(error);
    setStatus('Ephemeris data unavailable', 'error');
    timeline.clear(`No data: ${message}`);
    ui.comparison.replaceChildren(make('p', 'comparison-error', `No data: ${message}`));
    showOverlay(`Ephemeris not loaded: ${message}. Lighting, angles and intervals are not shown — no substitute values are used.`);
    refreshObservation();
  }
}

renderCredits();
for (const id of SITE_IDS) {
  const { site } = state.sites[id];
  moon.setSite(id, site.latDeg, site.lonDeg);
  renderSiteCard(id);
}
setActive('a');
explorer = createExplorer({
  moon,
  getState: () => state,
  getHeight: id => observerHeights[id],
  setHeight: (id, height) => { observerHeights[id] = height; refreshAnalysis(); refreshObservation(); },
  setSite: (id, site, presetId) => setSite(id, site.latDeg, site.lonDeg, presetId ?? null),
  setActive,
  setPeriod,
  seek: et => { setPlaying(false); if (state.data && state.period && (et < state.period.startEt || et > state.period.endEt)) setPeriod({ startEt: state.data.coverage.startEt, endEt: state.data.coverage.endEt }); setEt(et); },
});
refreshObservation();
void loadEphemeris();
