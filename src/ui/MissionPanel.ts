import type { Condition, EphemerisData, Site, TimeInterval } from '../contracts.ts';
import { compareMissionStarts, findMissionWindow, type MissionModel, type MissionRequest, type MissionResult } from '../science/mission.ts';
import { button, errorText, make } from './dom.ts';
import { formatLatLon } from './format.ts';
import {
  DURATION_PRESETS_HOURS, MISSION_CONDITION_LABEL, MISSION_MODEL_LABEL, applyWhatIf, describeCurrent, describeSearch, describeWhatIf,
  formatRequired, freezeRequest, parseDurationHours, requestKey, type MissionFormat, type WhatIfChange,
} from './mission.ts';

export type MissionSiteId = 'a' | 'b';

export interface MissionSiteInfo {
  name: string;
  site: Site;
  heightM: number;
}

/** A request to stand on the surface at a fixed start. The app evaluates it again with the science module. */
export interface ExperiencePlan {
  siteId: MissionSiteId;
  request: MissionRequest;
  /** Short English description of which start this is, e.g. "your start". */
  label: string;
}

export interface MissionHost {
  data(): EphemerisData | null;
  site(id: MissionSiteId): MissionSiteInfo;
  /** The app's single current time, or null without data. */
  viewEt(): number | null;
  /** The comparison period from the time panel. */
  comparisonPeriod(): TimeInterval | null;
  format: MissionFormat;
  /** Strict UTC text (ending in Z) -> ET; throws an English message. */
  parseUtc(text: string, what: string): number;
  /** ET -> strict UTC text with whole seconds. */
  utcText(et: number): string;
  /** Change the observer height of a site (the same value the site card shows). */
  setHeight(id: MissionSiteId, heightM: number): void;
  openCatalogue(id: MissionSiteId): void;
  /** Move the app's current time (widening the comparison period when needed). */
  goTo(et: number): void;
  experience(plan: ExperiencePlan): void;
}

export interface MissionFormValues {
  siteId: MissionSiteId;
  condition: Condition;
  requiredSeconds: number;
  startUtc: string;
  range: 'all' | 'period';
  model: MissionModel;
}

interface FoundResult {
  id: number;
  siteId: MissionSiteId;
  request: MissionRequest;
  result: MissionResult;
  totalMs: number;
}

interface WhatIfResult {
  id: number;
  siteId: MissionSiteId;
  baseline: MissionRequest;
  alternative: MissionRequest;
  change: WhatIfChange;
  comparison: ReturnType<typeof compareMissionStarts>;
  ms: number;
}

const SITE_LABEL: Record<MissionSiteId, string> = { a: 'Site A', b: 'Site B' };
const nextPaint = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 0));

/**
 * Compact mission query beside the 3D view: "is there enough continuous Sun / Earth time for this mission?"
 * It owns the form, the plain-English result, the What-if comparison and their loading / error / stale states.
 * Every number comes from src/science/mission.ts.
 */
export class MissionPanel {
  readonly root = make('section', 'mission');
  private readonly form = make('form', 'mission-form');
  private readonly siteButtons = {} as Record<MissionSiteId, HTMLButtonElement>;
  private readonly siteText = make('span', 'mission-site-text');
  private readonly height = make('input');
  private readonly condition = make('select');
  private readonly durationButtons: HTMLButtonElement[] = [];
  private readonly customHours = make('input');
  private readonly start = make('input');
  private readonly range = make('select');
  private readonly model = make('select');
  private readonly findButton = make('button', 'btn primary', 'Find a window');
  private readonly formError = make('p', 'field-error');
  private readonly output = make('div', 'mission-output');
  private readonly whatIfHost = make('div', 'mission-whatif');
  private siteId: MissionSiteId = 'a';
  private requiredSeconds = 48 * 3600;
  private startTouched = false;
  private generation = 0;
  private found: FoundResult | null = null;
  private whatIf: WhatIfResult | null = null;
  private readonly whatIfHeight = make('input');

  constructor(private readonly host: MissionHost) {
    this.root.setAttribute('aria-label', 'Mission window');
    const head = make('header', 'mission-head');
    head.append(make('h2', undefined, 'Mission window'), make('p', 'mission-lead', 'Is there enough continuous Sun or Earth time for a mission that starts at a given moment?'));

    this.form.noValidate = true;
    const row = (label: string, ...children: Array<Node | string>): HTMLDivElement => {
      const wrap = make('div', 'mf-row');
      wrap.append(make('span', 'mf-label', label));
      const body = make('div', 'mf-body');
      body.append(...children);
      wrap.append(body);
      this.form.append(wrap);
      return wrap;
    };

    // Site: A or B (the same two sites as the cards) and the observer height.
    for (const id of ['a', 'b'] as const) {
      const b = button(SITE_LABEL[id], `btn seg site-${id}`, `Use ${SITE_LABEL[id]} for the mission`);
      b.addEventListener('click', () => {
        this.siteId = id;
        this.sync();
      });
      this.siteButtons[id] = b;
    }
    const catalogue = button('Change…', 'btn small', 'Choose a named site from the catalogue');
    catalogue.addEventListener('click', () => this.host.openCatalogue(this.siteId));
    row('Where', this.siteButtons.a, this.siteButtons.b, catalogue, this.siteText);

    this.height.type = 'number';
    this.height.min = '0';
    this.height.max = '10000';
    this.height.step = 'any';
    this.height.className = 'mf-short';
    this.height.setAttribute('aria-label', 'Observer height above the reference sphere, metres, 0 to 10000');
    this.height.addEventListener('change', () => this.applyHeight());
    // Typing already makes a shown result stale; the value is applied to the site on change.
    this.height.addEventListener('input', () => this.checkStale());
    for (const [value, label] of [['reference-sphere', MISSION_MODEL_LABEL['reference-sphere']], ['terrain', `${MISSION_MODEL_LABEL.terrain} (search unavailable)`]] as const) this.model.append(new Option(label, value));
    this.model.setAttribute('aria-label', 'Ground model for the mission search');
    this.model.title = 'Mission search works on the reference sphere. The small terrain patch cannot certify continuous visibility, so a terrain search is refused, never replaced silently.';
    row('Height', this.height, make('span', 'mf-unit', 'm above'), this.model);

    for (const key of ['both', 'sun', 'earth'] as const) this.condition.append(new Option(MISSION_CONDITION_LABEL[key], key));
    this.condition.setAttribute('aria-label', 'What the mission needs');
    row('Needs', this.condition);

    for (const hours of DURATION_PRESETS_HOURS) {
      const b = button(`${hours} h`, 'btn seg', `Mission lasts ${hours} hours`);
      b.addEventListener('click', () => {
        this.requiredSeconds = hours * 3600;
        this.customHours.value = '';
        this.formError.textContent = '';
        this.renderDuration();
        this.checkStale();
      });
      this.durationButtons.push(b);
    }
    this.customHours.type = 'text';
    this.customHours.inputMode = 'decimal';
    this.customHours.placeholder = 'other';
    this.customHours.className = 'mf-short';
    this.customHours.setAttribute('aria-label', 'Custom mission duration, hours');
    this.customHours.addEventListener('input', () => {
      this.renderDuration();
      this.checkStale();
    });
    row('For', ...this.durationButtons, this.customHours, make('span', 'mf-unit', 'h'));

    this.start.type = 'text';
    this.start.spellcheck = false;
    this.start.autocomplete = 'off';
    this.start.placeholder = '2026-11-16T21:00:00Z';
    this.start.setAttribute('aria-label', 'Mission start, UTC, ISO 8601 ending in Z');
    this.start.addEventListener('input', () => {
      this.startTouched = true;
      this.checkStale();
    });
    const useView = button('Use view time', 'btn small', 'Copy the time currently shown in the 3D view');
    useView.addEventListener('click', () => {
      const et = this.host.viewEt();
      if (et === null) return;
      this.start.value = this.host.utcText(et);
      this.startTouched = true;
      this.checkStale();
    });
    row('Start, UTC', this.start, useView);

    this.range.append(new Option('All prepared data', 'all'), new Option('Comparison period only', 'period'));
    this.range.setAttribute('aria-label', 'Where to search for a window');
    row('Search in', this.range);

    for (const node of [this.condition, this.range, this.model]) node.addEventListener('change', () => this.checkStale());

    const actions = make('div', 'mission-actions');
    this.findButton.type = 'submit';
    this.findButton.title = 'Evaluate this exact start and search the range for suitable starts';
    actions.append(this.findButton);
    this.formError.setAttribute('role', 'alert');
    this.form.append(actions, this.formError);
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.find();
    });

    this.output.setAttribute('role', 'status');
    this.output.setAttribute('aria-live', 'polite');
    this.root.append(head, this.form, this.output, this.whatIfHost);
    this.renderDuration();
    this.renderIdle();
  }

  /** Add an extra control (e.g. the guided-demo button) next to Find window. */
  addAction(node: HTMLElement): void {
    this.form.querySelector('.mission-actions')?.append(node);
  }

  /** Call when data, a site, a height, the view time or the comparison period changed outside the form. */
  sync(): void {
    const data = this.host.data();
    const info = this.host.site(this.siteId);
    for (const id of ['a', 'b'] as const) this.siteButtons[id].setAttribute('aria-pressed', String(id === this.siteId));
    this.siteText.textContent = `${info.name} · ${formatLatLon(info.site.latDeg, info.site.lonDeg)}`;
    this.siteText.title = this.siteText.textContent;
    if (document.activeElement !== this.height) this.height.value = String(info.heightM);
    for (const node of [this.height, this.condition, this.customHours, this.start, this.range, this.model, this.findButton, ...this.durationButtons]) node.disabled = !data;
    // Until the user types a start or searches, the start field follows the view time.
    if (data && !this.startTouched && !this.found && document.activeElement !== this.start) {
      const et = this.host.viewEt();
      if (et !== null) this.start.value = this.host.utcText(et);
    }
    const period = this.host.comparisonPeriod();
    const periodOption = this.range.options[1];
    if (periodOption && data && period) periodOption.textContent = `Comparison period only (${this.host.format.when(period.startEt).slice(0, 10)} to ${this.host.format.when(period.endEt).slice(0, 10)})`;
    const allOption = this.range.options[0];
    if (allOption && data) allOption.textContent = `All prepared data (${data.coverage.startUtc.slice(0, 10)} to ${data.coverage.endUtc.slice(0, 10)})`;
    if (!this.found && (this.output.dataset['state'] === 'idle' || this.output.dataset['state'] === 'no-data')) this.renderIdle();
    this.checkStale();
  }

  /** Fill the form programmatically (guided demo). Does not run a search. */
  setForm(values: MissionFormValues): void {
    this.siteId = values.siteId;
    this.condition.value = values.condition;
    this.requiredSeconds = values.requiredSeconds;
    this.customHours.value = (DURATION_PRESETS_HOURS as readonly number[]).includes(values.requiredSeconds / 3600) ? '' : String(Number((values.requiredSeconds / 3600).toFixed(4)));
    this.start.value = values.startUtc;
    this.startTouched = true;
    this.range.value = values.range;
    this.model.value = values.model;
    this.formError.textContent = '';
    this.renderDuration();
    this.sync();
  }

  get selectedSite(): MissionSiteId {
    return this.siteId;
  }

  /** The frozen request of the last displayed result, or null. */
  get currentRequest(): MissionRequest | null {
    return this.found?.request ?? null;
  }

  private renderDuration(): void {
    const custom = this.customHours.value.trim() !== '';
    for (const [index, b] of this.durationButtons.entries()) b.setAttribute('aria-pressed', String(!custom && this.requiredSeconds === DURATION_PRESETS_HOURS[index]! * 3600));
  }

  private applyHeight(): void {
    const value = Number(this.height.value);
    if (this.height.value.trim() === '' || !Number.isFinite(value) || value < 0 || value > 10000) {
      this.formError.textContent = 'Height must be a number from 0 to 10000 m.';
      return;
    }
    this.formError.textContent = '';
    this.host.setHeight(this.siteId, value);
  }

  /** Build the request exactly as written in the form. Nothing is clamped or shifted. */
  private buildRequest(): MissionRequest {
    const data = this.host.data();
    if (!data) throw new Error('No ephemeris data is loaded, so a mission search is not possible.');
    const info = this.host.site(this.siteId);
    const heightValue = Number(this.height.value);
    if (this.height.value.trim() === '' || !Number.isFinite(heightValue) || heightValue < 0 || heightValue > 10000) throw new Error('Height must be a number from 0 to 10000 m.');
    if (heightValue !== info.heightM) this.host.setHeight(this.siteId, heightValue);
    const requiredSeconds = this.customHours.value.trim() === '' ? this.requiredSeconds : parseDurationHours(this.customHours.value);
    const currentStartEt = this.host.parseUtc(this.start.value, 'Mission start');
    let range: TimeInterval;
    if (this.range.value === 'period') {
      const period = this.host.comparisonPeriod();
      if (!period) throw new Error('No comparison period is set.');
      range = { ...period };
    } else {
      range = { startEt: data.coverage.startEt, endEt: data.coverage.endEt };
    }
    return {
      site: { latDeg: info.site.latDeg, lonDeg: info.site.lonDeg, heightAboveReferenceSphereM: 0 },
      observerHeightM: heightValue,
      model: this.model.value === 'terrain' ? 'terrain' : 'reference-sphere',
      range,
      requiredSeconds,
      condition: this.condition.value as Condition,
      currentStartEt,
    };
  }

  /**
   * Evaluate the exact start and search the range. Each call gets a generation id; a result is shown
   * only if no newer request was made meanwhile. Returns the shown result, or null.
   */
  async find(): Promise<MissionResult | null> {
    const id = ++this.generation;
    this.formError.textContent = '';
    let request: MissionRequest;
    try {
      request = this.buildRequest();
    } catch (error) {
      this.found = null;
      this.whatIf = null;
      this.renderError(errorText(error), false);
      return null;
    }
    const siteId = this.siteId;
    this.startTouched = true;
    const began = performance.now();
    this.renderLoading(id);
    await nextPaint();
    if (id !== this.generation) return null;
    const data = this.host.data();
    if (!data) {
      this.renderError('No ephemeris data is loaded, so a mission search is not possible.', false);
      return null;
    }
    let result: MissionResult;
    try {
      result = findMissionWindow(data, request);
    } catch (error) {
      if (id !== this.generation) return null;
      this.found = null;
      this.whatIf = null;
      this.renderError(errorText(error), request.model === 'terrain');
      return null;
    }
    if (id !== this.generation) return null;
    this.found = { id, siteId, request: freezeRequest(request), result, totalMs: performance.now() - began };
    this.whatIf = null;
    this.renderResult();
    return result;
  }

  /**
   * Compare the frozen baseline (the displayed result's request) with ONE explicit change.
   * Both sides are fixed starts; the alternative is never searched or shifted.
   */
  runWhatIf(change: WhatIfChange): WhatIfResult['comparison'] | null {
    const data = this.host.data();
    const found = this.found;
    if (!data || !found) return null;
    const id = ++this.generation;
    try {
      const baseline = found.request;
      const alternative = applyWhatIf(baseline, change);
      const began = performance.now();
      const comparison = compareMissionStarts(data, baseline, alternative);
      this.whatIf = { id, siteId: change.kind === 'site' ? (found.siteId === 'a' ? 'b' : 'a') : found.siteId, baseline, alternative, change, comparison, ms: performance.now() - began };
      this.renderWhatIf();
      return comparison;
    } catch (error) {
      this.whatIf = null;
      this.renderWhatIf(errorText(error));
      return null;
    }
  }

  /** The alternative request of the displayed What-if, for the guided demo's surface step. */
  get whatIfPlan(): ExperiencePlan | null {
    return this.whatIf ? { siteId: this.whatIf.siteId, request: this.whatIf.alternative, label: 'the What-if start' } : null;
  }

  /** Mark shown results stale when the form or the sites no longer match the request they answer. */
  private checkStale(): void {
    if (!this.found) return;
    let stale = true;
    try {
      const data = this.host.data();
      const info = this.host.site(this.found.siteId);
      const sameSite = this.siteId === this.found.siteId && info.site.latDeg === this.found.request.site.latDeg && info.site.lonDeg === this.found.request.site.lonDeg;
      stale = !data || !sameSite || requestKey(this.peekRequest()) !== requestKey(this.found.request);
    } catch {
      stale = true;
    }
    this.output.classList.toggle('stale', stale);
    this.whatIfHost.classList.toggle('stale', stale);
    const banner = this.output.querySelector<HTMLElement>('.mission-stale');
    if (banner) banner.hidden = !stale;
    for (const node of this.root.querySelectorAll<HTMLButtonElement>('[data-needs-fresh]')) node.disabled = stale;
  }

  /** Like buildRequest but without side effects on the site height. */
  private peekRequest(): MissionRequest {
    const data = this.host.data();
    if (!data) throw new Error('no data');
    const info = this.host.site(this.siteId);
    const range = this.range.value === 'period' ? this.host.comparisonPeriod() : { startEt: data.coverage.startEt, endEt: data.coverage.endEt };
    if (!range) throw new Error('no period');
    return {
      site: { latDeg: info.site.latDeg, lonDeg: info.site.lonDeg, heightAboveReferenceSphereM: 0 },
      observerHeightM: Number(this.height.value),
      model: this.model.value === 'terrain' ? 'terrain' : 'reference-sphere',
      range: { ...range },
      requiredSeconds: this.customHours.value.trim() === '' ? this.requiredSeconds : parseDurationHours(this.customHours.value),
      condition: this.condition.value as Condition,
      currentStartEt: this.host.parseUtc(this.start.value, 'Mission start'),
    };
  }

  private renderIdle(): void {
    this.output.dataset['state'] = this.host.data() ? 'idle' : 'no-data';
    this.output.classList.remove('stale');
    this.output.replaceChildren(make('p', 'mission-idle', this.host.data()
      ? 'Choose a site, what the mission needs, how long it lasts and when it starts, then press Find a window.'
      : 'No ephemeris data is loaded, so a mission search is not possible. No substitute values are used.'));
    this.whatIfHost.replaceChildren();
  }

  private renderLoading(id: number): void {
    this.output.dataset['state'] = 'loading';
    this.output.classList.remove('stale');
    this.output.replaceChildren(make('p', 'mission-idle', `Searching… (request #${id})`));
    this.whatIfHost.replaceChildren();
  }

  private renderError(message: string, unsupportedModel: boolean): void {
    this.output.dataset['state'] = unsupportedModel ? 'unsupported' : 'error';
    this.output.classList.remove('stale');
    const box = make('div', 'mission-verdict fail');
    box.append(make('strong', undefined, unsupportedModel ? 'Terrain search is not available' : 'Cannot search'), make('p', undefined, message.replace(/^Mission: /, '')));
    this.output.replaceChildren(box);
    if (unsupportedModel) {
      const note = make('p', 'mission-note', 'No reference-sphere result is shown in its place. To search on the smooth reference sphere, choose it yourself:');
      const choose = button('Switch the form to Reference sphere', 'btn small', 'Sets the model field only; press Find a window afterwards');
      choose.addEventListener('click', () => {
        this.model.value = 'reference-sphere';
        this.output.replaceChildren(make('p', 'mission-idle', 'Model set to Reference sphere. Press Find a window to search with it.'));
        this.output.dataset['state'] = 'idle';
      });
      this.output.append(note, choose);
    }
    this.whatIfHost.replaceChildren();
  }

  private renderResult(): void {
    const found = this.found;
    if (!found) return;
    const { result, request } = found;
    const format = this.host.format;
    const info = this.host.site(found.siteId);
    this.output.dataset['state'] = 'result';
    this.output.dataset['requestId'] = String(found.id);
    this.output.dataset['computeMs'] = result.computeMilliseconds.toFixed(2);
    this.output.dataset['requirementMet'] = String(result.current.requirementMet);

    const stale = make('p', 'mission-stale', 'The form or the site changed after this result. Press Find a window to update it.');
    stale.hidden = true;

    const verdict = describeCurrent(result.current, request, format);
    const box = make('div', `mission-verdict ${verdict.tone}`);
    box.append(make('strong', undefined, verdict.headline), make('p', undefined, verdict.detail));

    const search = describeSearch(result, format);
    const searchBox = make('div', 'mission-search');
    searchBox.append(make('h3', undefined, 'Search in the range'), make('p', undefined, search.nearest));
    for (const note of search.notes) searchBox.append(make('p', 'mission-note', note));

    const actions = make('div', 'mission-result-actions');
    const insideData = result.current.endReason !== 'outside-data';
    const goStart = button('Show my start', 'btn small', 'Move the 3D view to the requested start time');
    goStart.disabled = !insideData;
    goStart.addEventListener('click', () => this.host.goTo(request.currentStartEt));
    const recommended = result.recommendedStartEt;
    const shifted = recommended !== null && Math.abs(recommended - request.currentStartEt) >= 1;
    if (result.current.requirementMet || !shifted) {
      // The window that contains the requested start (or, with no window at all, just the requested start).
      const experienceStart = button(result.current.requirementMet ? 'Experience this window ▸' : 'Experience my start ▸', 'btn small accent', 'Stand on the surface at the requested start and play time forward');
      experienceStart.disabled = !insideData;
      experienceStart.dataset['needsFresh'] = '';
      experienceStart.addEventListener('click', () => this.host.experience({ siteId: found.siteId, request, label: 'your start' }));
      actions.append(experienceStart, goStart);
    } else {
      // The requested start fails; the window on offer is the one the search found, clearly labelled as such.
      const experienceBest = button('Experience this window ▸', 'btn small accent', `Stand on the surface at ${format.when(recommended)}, the earliest suitable start found by the search (not your start)`);
      experienceBest.dataset['needsFresh'] = '';
      experienceBest.addEventListener('click', () => this.host.experience({ siteId: found.siteId, request: freezeRequest({ ...request, currentStartEt: recommended }), label: 'the earliest suitable start found by the search' }));
      const experienceStart = button('Experience my start ▸', 'btn small', 'Stand on the surface at the requested start, where the mission does not fit');
      experienceStart.disabled = !insideData;
      experienceStart.dataset['needsFresh'] = '';
      experienceStart.addEventListener('click', () => this.host.experience({ siteId: found.siteId, request, label: 'your start' }));
      const useBest = button('Use found start in the form', 'btn small', 'Copy the earliest suitable start into the form; press Find a window to evaluate it');
      useBest.addEventListener('click', () => {
        this.start.value = this.host.utcText(recommended);
        this.startTouched = true;
        this.checkStale();
      });
      actions.append(experienceBest, experienceStart, useBest, goStart);
    }

    const meta = make('p', 'mission-meta',
      `${SITE_LABEL[found.siteId]} · ${info.name} · ${request.observerHeightM} m · ${MISSION_MODEL_LABEL[request.model]} · ${formatRequired(request.requiredSeconds)} · search ${result.computeMilliseconds.toFixed(1)} ms (${found.totalMs.toFixed(0)} ms with display) · request #${found.id}`);
    meta.title = 'Times are rounded to the minute; they come from 10-minute samples and are approximate. Body centre above the local tangent plane; no terrain, eclipses, power or radio-link calculation.';

    this.output.replaceChildren(stale, box, searchBox, actions, meta);
    this.renderWhatIf();
    this.checkStale();
  }

  private renderWhatIf(error?: string): void {
    const found = this.found;
    if (!found) {
      this.whatIfHost.replaceChildren();
      return;
    }
    const format = this.host.format;
    const other: MissionSiteId = found.siteId === 'a' ? 'b' : 'a';
    const otherInfo = this.host.site(other);
    const fold = make('details', 'fold mission-whatif-fold');
    fold.open = this.whatIf !== null || error !== undefined || this.whatIfHost.querySelector('details')?.open === true;
    const summary = make('summary');
    summary.append(make('span', 'fold-title', 'What if…'), make('span', 'fold-note', 'one change, the same fixed start rule'));
    const buttons = make('div', 'mission-whatif-buttons');
    const later = button('Start one day later', 'btn small', 'Start exactly one UTC day later; everything else unchanged');
    later.addEventListener('click', () => this.runWhatIf({ kind: 'start-plus-1-day' }));
    const site = button(`Try ${SITE_LABEL[other]}`, 'btn small', `Same start, duration, need and height at ${SITE_LABEL[other]} (${otherInfo.name})`);
    site.addEventListener('click', () => this.runWhatIf({ kind: 'site', site: this.host.site(other).site, siteName: `${SITE_LABEL[other]} (${this.host.site(other).name})` }));
    this.whatIfHeight.type = 'number';
    this.whatIfHeight.min = '0';
    this.whatIfHeight.max = '10000';
    this.whatIfHeight.step = 'any';
    this.whatIfHeight.className = 'mf-short';
    this.whatIfHeight.placeholder = 'metres';
    this.whatIfHeight.setAttribute('aria-label', 'What-if observer height, metres');
    const heightButton = button('Change observer height', 'btn small', 'Same start at this observer height; everything else unchanged');
    heightButton.addEventListener('click', () => {
      if (this.whatIfHeight.value.trim() === '') return this.renderWhatIf('Enter a What-if height in metres (0 to 10000).');
      this.runWhatIf({ kind: 'height', observerHeightM: Number(this.whatIfHeight.value) });
    });
    for (const node of [later, site, heightButton]) node.dataset['needsFresh'] = '';
    const heightGroup = make('span', 'mission-whatif-height');
    heightGroup.append(heightButton, make('span', 'mf-unit', 'to'), this.whatIfHeight, make('span', 'mf-unit', 'm'));
    buttons.append(later, site, heightGroup);
    fold.append(summary, buttons);

    if (error !== undefined) {
      const p = make('p', 'field-error', error.replace(/^Mission: /, ''));
      p.setAttribute('role', 'alert');
      fold.append(p);
    } else if (this.whatIf) {
      const w = this.whatIf;
      const text = describeWhatIf(w.comparison, w.baseline, w.alternative, w.change, format);
      const box = make('div', `mission-compare ${w.comparison.alternative.requirementMet ? 'ok' : 'fail'}`);
      box.dataset['requestId'] = String(w.id);
      box.dataset['alternativeMet'] = String(w.comparison.alternative.requirementMet);
      box.append(make('strong', undefined, text.headline), make('p', 'cmp-base', text.baseline), make('p', 'cmp-alt', text.alternative), make('p', 'cmp-delta', text.delta), make('p', 'mission-note', text.limit));
      const actions = make('div', 'mission-result-actions');
      const insideData = w.comparison.alternative.endReason !== 'outside-data';
      const experience = button('Experience the changed case ▸', 'btn small accent', 'Stand on the surface with this one change applied');
      experience.disabled = !insideData;
      experience.addEventListener('click', () => this.host.experience({ siteId: w.siteId, request: w.alternative, label: 'the What-if case' }));
      const adopt = button('Put the change into the form', 'btn small', 'Copies the changed value into the form; press Find a window for a separate new search');
      adopt.addEventListener('click', () => this.adopt(w));
      actions.append(experience, adopt);
      box.append(actions, make('p', 'mission-note', `Both sides are fixed starts evaluated as written; the changed case was not searched or moved. Baseline frozen at request #${found.id}.`));
      fold.append(box);
    }
    this.whatIfHost.replaceChildren(fold);
  }

  /** Copy a What-if change into the form. The existing result becomes stale; a new Find is a separate action. */
  private adopt(w: WhatIfResult): void {
    if (w.change.kind === 'start-plus-1-day') {
      this.start.value = this.host.utcText(w.alternative.currentStartEt);
      this.startTouched = true;
    } else if (w.change.kind === 'site') {
      this.siteId = w.siteId;
      this.host.setHeight(w.siteId, w.alternative.observerHeightM);
    } else {
      this.height.value = String(w.change.observerHeightM);
      this.host.setHeight(this.siteId, w.change.observerHeightM);
    }
    this.sync();
  }
}
