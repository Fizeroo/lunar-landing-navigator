import type { SiteAnalysis } from '../contracts.ts';
import { button, errorText, make } from './dom.ts';
import { formatDuration, formatHeight, formatLatLon, formatPercent, formatUtcMinute } from './format.ts';
import {
  DEFAULT_DURATION_SECONDS,
  MAX_SCENARIOS,
  SCENARIO_STORAGE_KEY,
  cleanName,
  decodeScenarioFragment,
  defaultScenarios,
  encodeScenarioFragment,
  newScenarioId,
  parseScenarioSet,
  serializeScenarioSet,
  validateScenario,
  validateScenarioSet,
  type Scenario,
  type ScenarioSeed,
  type ScenarioSet,
} from './scenario.ts';

export interface ScenarioResult {
  analysis: SiteAnalysis;
  /** Window analysed: exactly the requested start and duration (never moved or shortened). */
  startUtc: string;
  endUtc: string;
}

export interface ScenarioHost {
  /** Dataset identity, or null while no data is loaded. */
  datasetId(): string | null;
  /** Current app time as strict UTC, or null. */
  nowUtc(): string | null;
  seeds(): { a: ScenarioSeed; b: ScenarioSeed };
  /** Analyse with the reference-sphere model; throws with an English reason. */
  analyse(scenario: Scenario): ScenarioResult;
  /** Put the scenario's site, height and window into Site A or B. */
  load(target: 'a' | 'b', scenario: Scenario): void;
}

/** Saved scenarios: equal-duration windows compared on the reference-sphere model. */
export class ScenarioPanel {
  private scenarios: Scenario[] = [];
  private readonly message = make('p', 'panel-message');
  private readonly tableHost = make('div', 'scenario-table-host');
  private readonly duration = make('input');
  private readonly fileInput = make('input');
  private loadedFromLink = false;
  /** True while the list is still the untouched automatic defaults, which follow the current time. */
  private pristine = false;

  constructor(private readonly host: HTMLElement, private readonly app: ScenarioHost) {
    this.message.setAttribute('role', 'status');
    this.message.setAttribute('aria-live', 'polite');

    const intro = make('p', 'panel-intro',
      'A scenario is a site, a start time, a duration and an observer height. All scenarios share one duration so their shares are comparable. ' +
      'Results always use the reference-sphere model (body centre above the local tangent plane at that height) — never terrain, even when the surface view shows terrain.');

    const toolbar = make('div', 'panel-toolbar');
    const durationLabel = make('label', 'inline-field');
    durationLabel.append(make('span', undefined, 'Duration for all, days'));
    this.duration.type = 'number';
    this.duration.min = '0.25';
    this.duration.max = '120';
    this.duration.step = '0.25';
    this.duration.setAttribute('aria-label', 'Duration for all scenarios, days');
    durationLabel.append(this.duration);
    const applyDuration = button('Apply', 'btn', 'Give every scenario this duration');
    applyDuration.addEventListener('click', () => this.applyDuration());
    const addA = button('+ Site A now', 'btn', 'Add a scenario for Site A starting at the current time');
    addA.addEventListener('click', () => this.addFromSite('a'));
    const addB = button('+ Site B now', 'btn', 'Add a scenario for Site B starting at the current time');
    addB.addEventListener('click', () => this.addFromSite('b'));
    const reset = button('Reset to defaults', 'btn', 'Replace all scenarios with: A now, A +3 days, B now');
    reset.addEventListener('click', () => this.resetDefaults(true));
    const exportButton = button('Export JSON', 'btn', 'Download the scenarios as a JSON file');
    exportButton.addEventListener('click', () => this.exportFile());
    const importButton = button('Import JSON…', 'btn', 'Load scenarios from a JSON file (validated before use)');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/json,.json';
    this.fileInput.hidden = true;
    this.fileInput.setAttribute('aria-label', 'Scenario JSON file');
    importButton.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => void this.importFile());
    const share = button('Copy share link', 'btn', 'Copy a link that carries these scenarios in its fragment');
    share.addEventListener('click', () => void this.copyLink());
    toolbar.append(durationLabel, applyDuration, addA, addB, reset, exportButton, importButton, this.fileInput, share);

    const note = make('p', 'panel-note',
      'Scenarios are saved only in this browser (localStorage). Export and share links contain just the fields shown here: name, coordinates, start, duration, height, model and dataset id.');
    host.append(intro, toolbar, this.message, this.tableHost, note);
  }

  /** Call once data is available: URL fragment first, then localStorage, else defaults. */
  initialise(): void {
    try {
      const fromLink = decodeScenarioFragment(window.location.hash);
      if (fromLink) {
        this.scenarios = fromLink.scenarios;
        this.loadedFromLink = true;
        this.say(`Loaded ${fromLink.scenarios.length} scenario${fromLink.scenarios.length === 1 ? '' : 's'} from the link.`);
        this.persist();
        this.render();
        return;
      }
    } catch (error) {
      this.say(`The link's scenarios were ignored: ${errorText(error)}`, true);
    }
    try {
      const stored = window.localStorage.getItem(SCENARIO_STORAGE_KEY);
      if (stored) {
        this.scenarios = parseScenarioSet(stored).scenarios;
        this.render();
        return;
      }
    } catch (error) {
      this.say(`Saved scenarios were ignored: ${errorText(error)}`, true);
    }
    this.autoDefaults();
  }

  /** Untouched defaults are not saved, so they keep following the current time and sites. */
  private autoDefaults(): void {
    this.resetDefaults(false);
    this.pristine = true;
    try {
      window.localStorage.removeItem(SCENARIO_STORAGE_KEY);
    } catch {
      // Storage unavailable: nothing to clear.
    }
  }

  /** Call when the dialog opens: untouched defaults are rebuilt for the current time and sites. */
  open(): void {
    if (this.pristine) {
      this.autoDefaults();
    } else {
      this.render();
    }
  }

  /** True when the page was opened from a share link that carried scenarios. */
  get openedFromLink(): boolean {
    return this.loadedFromLink;
  }

  render(): void {
    const first = this.scenarios[0];
    this.duration.value = String(Number(((first?.durationSeconds ?? DEFAULT_DURATION_SECONDS) / 86400).toFixed(2)));
    const table = make('table', 'scenario-table');
    const head = make('tr');
    for (const title of ['Name', 'Site', 'Start, UTC', 'Height, m', 'Analysed window', 'Sun up', 'Earth up', 'Sun + Earth up', 'Longest Sun + Earth', '']) head.append(make('th', undefined, title));
    const thead = make('thead');
    thead.append(head);
    const body = make('tbody');
    for (const scenario of this.scenarios) body.append(this.renderRow(scenario));
    table.append(thead, body);
    this.tableHost.replaceChildren(table);
  }

  private renderRow(scenario: Scenario): HTMLTableRowElement {
    const row = make('tr');
    const cell = (...children: Array<Node | string>): HTMLTableCellElement => {
      const td = make('td');
      td.append(...children);
      row.append(td);
      return td;
    };
    const name = make('input');
    name.type = 'text';
    name.value = scenario.name;
    name.maxLength = 60;
    name.setAttribute('aria-label', 'Scenario name');
    name.addEventListener('change', () => this.update(scenario.id, { name: cleanName(name.value) || scenario.name }));
    cell(name);
    cell(formatLatLon(scenario.site.latDeg, scenario.site.lonDeg));
    const start = make('input');
    start.type = 'text';
    start.value = scenario.startUtc;
    start.spellcheck = false;
    start.setAttribute('aria-label', `Start of ${scenario.name}, UTC, ISO 8601 ending in Z`);
    start.addEventListener('change', () => this.update(scenario.id, { startUtc: start.value.trim() }));
    cell(start);
    const height = make('input');
    height.type = 'number';
    height.min = '0';
    height.max = '10000';
    height.step = 'any';
    height.value = String(scenario.observerHeightM);
    height.setAttribute('aria-label', `Observer height of ${scenario.name}, metres`);
    height.addEventListener('change', () => this.update(scenario.id, { observerHeightM: Number(height.value) }));
    cell(height);

    let analysed = true;
    try {
      const result = this.app.analyse(scenario);
      cell(`${formatUtcMinute(result.startUtc)} → ${formatUtcMinute(result.endUtc)}`);
      const { sun, earth, both } = result.analysis;
      const share = (fraction: number, seconds: number): void => {
        cell(make('strong', undefined, formatPercent(fraction)), make('span', 'scenario-sub', formatDuration(seconds))).className = 'scenario-share';
      };
      share(sun.fraction, sun.totalSeconds);
      share(earth.fraction, earth.totalSeconds);
      share(both.fraction, both.totalSeconds);
      cell(formatDuration(both.longestSeconds)).className = 'scenario-share';
    } catch (error) {
      analysed = false;
      const failed = cell(`Not analysed: ${errorText(error)}`);
      failed.colSpan = 5;
      failed.className = 'scenario-error';
    }

    const actions = make('td', 'scenario-actions');
    const toA = button('→ A', 'btn tiny', 'Load this scenario into Site A and use its window as the comparison period');
    toA.addEventListener('click', () => this.app.load('a', scenario));
    const toB = button('→ B', 'btn tiny', 'Load this scenario into Site B and use its window as the comparison period');
    toB.addEventListener('click', () => this.app.load('b', scenario));
    // A scenario that cannot be analysed as written is never loaded with changed dates.
    toA.disabled = !analysed;
    toB.disabled = !analysed;
    const remove = button('Delete', 'btn tiny', `Delete ${scenario.name}`);
    remove.disabled = this.scenarios.length <= 1;
    remove.addEventListener('click', () => {
      this.scenarios = this.scenarios.filter((item) => item.id !== scenario.id);
      this.commit('Scenario deleted.');
    });
    actions.append(toA, toB, remove);
    row.append(actions);
    row.title = `Model: reference sphere · height ${formatHeight(scenario.observerHeightM)} · dataset ${scenario.datasetId}`;
    return row;
  }

  private update(id: string, patch: Partial<Scenario>): void {
    const index = this.scenarios.findIndex((item) => item.id === id);
    const current = this.scenarios[index];
    if (!current) return;
    try {
      this.scenarios[index] = validateScenario({ ...current, ...patch });
      this.commit('Scenario updated.');
    } catch (error) {
      this.say(errorText(error), true);
      this.render();
    }
  }

  private applyDuration(): void {
    const days = Number(this.duration.value);
    if (!Number.isFinite(days) || days < 0.25 || days > 120) {
      this.say('Duration must be from 0.25 to 120 days.', true);
      return;
    }
    try {
      this.scenarios = this.scenarios.map((item) => validateScenario({ ...item, durationSeconds: Math.round(days * 86400) }));
      this.commit(`All scenarios now last ${formatDuration(days * 86400).replace('≈ ', '')}.`);
    } catch (error) {
      this.say(errorText(error), true);
    }
  }

  private addFromSite(target: 'a' | 'b'): void {
    const datasetId = this.app.datasetId();
    const nowUtc = this.app.nowUtc();
    if (!datasetId || !nowUtc) return this.say('No data loaded yet.', true);
    if (this.scenarios.length >= MAX_SCENARIOS) return this.say(`At most ${MAX_SCENARIOS} scenarios.`, true);
    const seed = this.app.seeds()[target];
    try {
      this.scenarios.push(validateScenario({
        version: 1,
        id: newScenarioId(),
        name: cleanName(`${seed.name} — ${nowUtc.slice(0, 16).replace('T', ' ')}`),
        site: { latDeg: seed.latDeg, lonDeg: seed.lonDeg, heightAboveReferenceSphereM: 0 },
        startUtc: nowUtc,
        durationSeconds: this.scenarios[0]?.durationSeconds ?? DEFAULT_DURATION_SECONDS,
        observerHeightM: seed.observerHeightM,
        model: 'reference-sphere',
        datasetId,
      }));
      this.commit('Scenario added.');
    } catch (error) {
      this.say(errorText(error), true);
    }
  }

  private resetDefaults(announce: boolean): void {
    const datasetId = this.app.datasetId();
    const nowUtc = this.app.nowUtc();
    if (!datasetId || !nowUtc) return;
    const { a, b } = this.app.seeds();
    this.scenarios = defaultScenarios(a, b, nowUtc, datasetId, this.scenarios[0]?.durationSeconds ?? DEFAULT_DURATION_SECONDS).scenarios;
    this.commit(announce ? 'Reset to: A now, A +3 days, B now.' : '');
  }

  private currentSet(): ScenarioSet {
    return validateScenarioSet({ version: 1, scenarios: this.scenarios });
  }

  private commit(message: string): void {
    this.pristine = false;
    this.persist();
    this.render();
    if (message) this.say(message);
  }

  private persist(): void {
    try {
      window.localStorage.setItem(SCENARIO_STORAGE_KEY, serializeScenarioSet(this.currentSet()));
    } catch (error) {
      this.say(`Could not save in this browser: ${errorText(error)}`, true);
    }
  }

  private exportFile(): void {
    try {
      const blob = new Blob([serializeScenarioSet(this.currentSet())], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = make('a');
      a.href = url;
      a.download = 'lunar-scenarios.json';
      a.click();
      URL.revokeObjectURL(url);
      this.say('Exported lunar-scenarios.json.');
    } catch (error) {
      this.say(errorText(error), true);
    }
  }

  private async importFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    try {
      this.importText(await file.text());
    } catch (error) {
      this.say(`Import failed: ${errorText(error)}`, true);
    }
  }

  /** Validate and replace the scenarios from JSON text (also used by tests). */
  importText(text: string): void {
    try {
      this.scenarios = parseScenarioSet(text).scenarios;
      this.commit(`Imported ${this.scenarios.length} scenario${this.scenarios.length === 1 ? '' : 's'}.`);
    } catch (error) {
      this.say(`Import failed: ${errorText(error)}`, true);
    }
  }

  private async copyLink(): Promise<void> {
    try {
      const url = `${window.location.origin}${window.location.pathname}#${encodeScenarioFragment(this.currentSet())}`;
      await navigator.clipboard.writeText(url);
      this.say('Share link copied. The scenarios travel in the part after “#”, which is not sent to any server.');
    } catch (error) {
      this.say(`Could not copy the link: ${errorText(error)}`, true);
    }
  }

  private say(text: string, isError = false): void {
    this.message.textContent = text;
    this.message.dataset['tone'] = isError ? 'error' : 'info';
  }
}
