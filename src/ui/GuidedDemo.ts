import type { EphemerisData, Site, TimeInterval } from '../contracts.ts';
import { button, errorText, make } from './dom.ts';
import type { ExperiencePlan, MissionPanel } from './MissionPanel.ts';
import {
  DEMO_STEPS, DEMO_STEP_TITLE, MISSION_CONDITION_LABEL, demoMismatch, describeChange, describeCurrent, describeWhatIf, formatRequired,
  validateMissionDemo, type DemoStep, type MissionDemo, type MissionFormat, type WhatIfChange,
} from './mission.ts';

export interface DemoHost {
  data(): EphemerisData | null;
  /** Fetch the prepared fixture (public/data/mission-demo.json). */
  loadFixture(): Promise<unknown>;
  panel: MissionPanel;
  format: MissionFormat;
  parseUtc(text: string, what: string): number;
  setSite(id: 'a' | 'b', site: Site, name: string, heightM: number): void;
  setPeriod(period: TimeInterval): void;
  /** Show the site from orbit and move the view time. */
  showFromOrbit(id: 'a' | 'b', et: number): void;
  experience(plan: ExperiencePlan): void;
}

/**
 * Guided demo: select -> failure -> one explicit change -> result -> surface.
 * Every step is computed live by the science module from the fixture's inputs; the fixture's recorded
 * numbers are only cross-checked. It can be cancelled at any step, and a cancelled run can never
 * continue (each run has its own id).
 */
export class GuidedDemo {
  private readonly label = make('span', 'demo-step');
  private readonly title = make('strong', 'demo-title');
  private readonly text = make('p', 'demo-text');
  private readonly next = button('Next ▸', 'btn primary');
  private readonly cancel = button('Cancel demo', 'btn');
  private run = 0;
  private index = -1;
  private fixture: MissionDemo | null = null;
  private busy = false;

  constructor(private readonly root: HTMLElement, private readonly host: DemoHost) {
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Guided demo');
    this.text.setAttribute('role', 'status');
    this.text.setAttribute('aria-live', 'polite');
    const head = make('div', 'demo-head');
    head.append(this.label, this.title);
    const actions = make('div', 'demo-actions');
    actions.append(this.next, this.cancel);
    root.append(head, this.text, actions);
    root.hidden = true;
    this.next.addEventListener('click', () => void this.advance());
    this.cancel.addEventListener('click', () => this.stop());
  }

  get active(): boolean {
    return !this.root.hidden;
  }

  /** Cancel or close the demo. The app keeps whatever state the finished steps set; nothing else happens. */
  stop(): void {
    this.run += 1;
    this.index = -1;
    this.busy = false;
    this.root.hidden = true;
    delete this.root.dataset['step'];
  }

  async start(): Promise<void> {
    const run = ++this.run;
    this.index = -1;
    this.fixture = null;
    this.root.hidden = false;
    this.root.dataset['step'] = 'loading';
    this.show('Guided demo', 'Loading the prepared example…', null);
    try {
      const data = this.host.data();
      if (!data) throw new Error('No ephemeris data is loaded, so the guided demo cannot run.');
      const fixture = validateMissionDemo(await this.host.loadFixture());
      if (run !== this.run) return;
      if (fixture.datasetId !== data.id) throw new Error(`The prepared demo was made for dataset ${fixture.datasetId}, but ${data.id} is loaded.`);
      this.fixture = fixture;
    } catch (error) {
      if (run !== this.run) return;
      this.fail(errorText(error));
      return;
    }
    await this.advance();
  }

  private show(title: string, text: string, nextLabel: string | null, step?: DemoStep): void {
    this.label.textContent = step ? `Guided demo · step ${DEMO_STEPS.indexOf(step) + 1} of ${DEMO_STEPS.length}` : 'Guided demo';
    this.title.textContent = title;
    this.text.textContent = text;
    this.text.dataset['tone'] = 'info';
    this.next.hidden = nextLabel === null;
    if (nextLabel !== null) this.next.textContent = nextLabel;
    this.cancel.textContent = 'Cancel demo';
  }

  private fail(message: string): void {
    this.root.dataset['step'] = 'error';
    this.label.textContent = 'Guided demo stopped';
    this.title.textContent = 'The demo cannot continue';
    this.text.textContent = message;
    this.text.dataset['tone'] = 'error';
    this.next.hidden = true;
    this.cancel.textContent = 'Close';
  }

  private change(fixture: MissionDemo): WhatIfChange {
    return fixture.change.kind === 'site' ? { kind: 'site', site: fixture.change.site, siteName: `Site B (${fixture.change.siteName})` } : fixture.change;
  }

  private async advance(): Promise<void> {
    const fixture = this.fixture;
    if (!fixture || this.busy) return;
    if (this.index >= DEMO_STEPS.length - 1) return this.stop();
    const run = this.run;
    this.busy = true;
    this.next.disabled = true;
    try {
      const step = DEMO_STEPS[this.index + 1]!;
      const text = await this.perform(step, fixture, run);
      if (run !== this.run) return;
      this.index += 1;
      this.root.dataset['step'] = step;
      this.show(DEMO_STEP_TITLE[step], text, step === 'surface' ? 'Finish' : 'Next ▸', step);
    } catch (error) {
      if (run === this.run) this.fail(errorText(error));
    } finally {
      if (run === this.run) {
        this.busy = false;
        this.next.disabled = false;
      }
    }
  }

  /** Do one step and return its explanation. Throws an English message when live results disagree with the fixture. */
  private async perform(step: DemoStep, fixture: MissionDemo, run: number): Promise<string> {
    const { host } = this;
    const data = host.data();
    if (!data) throw new Error('The ephemeris data is no longer loaded.');
    const b = fixture.baseline;
    const need = `${MISSION_CONDITION_LABEL[b.condition]} for ${formatRequired(b.requiredSeconds)}`;
    if (step === 'select') {
      const startEt = host.parseUtc(b.startUtc, 'Demo start');
      const range = { startEt: host.parseUtc(b.rangeStartUtc, 'Demo range start'), endEt: host.parseUtc(b.rangeEndUtc, 'Demo range end') };
      const whole = range.startEt === data.coverage.startEt && range.endEt === data.coverage.endEt;
      host.setSite('a', b.site, b.siteName, b.observerHeightM);
      if (fixture.change.kind === 'site') host.setSite('b', fixture.change.site, fixture.change.siteName, b.observerHeightM);
      if (!whole) host.setPeriod(range);
      host.panel.setForm({ siteId: 'a', condition: b.condition, requiredSeconds: b.requiredSeconds, startUtc: b.startUtc, range: whole ? 'all' : 'period', model: 'reference-sphere' });
      host.showFromOrbit('a', startEt);
      return `Site A is now ${b.siteName}. The mission needs: ${need}, starting ${host.format.when(startEt)}, observer ${b.observerHeightM} m above the reference sphere. The form on the right is filled in; nothing has been calculated yet.`;
    }
    if (step === 'failure') {
      const result = await host.panel.find();
      if (run !== this.run) return '';
      if (!result) throw new Error('The search for the demo start did not produce a result (see the mission panel).');
      const mismatch = demoMismatch('Baseline', result.current, fixture.expected.baseline);
      if (mismatch) throw new Error(mismatch);
      const verdict = describeCurrent(result.current, result.request, host.format);
      return `${verdict.headline}. ${verdict.detail} This is the exact start you asked for, evaluated as written — it was not moved.`;
    }
    const baseline = host.panel.currentRequest;
    if (!baseline) throw new Error('The baseline result is missing; restart the demo.');
    const change = this.change(fixture);
    if (step === 'change') {
      return `Now one explicit change: ${describeChange(change, baseline, host.format)}. The need, the duration, the search range, the model${change.kind === 'height' ? '' : ', the height'}${change.kind === 'site' ? '' : ', the site'} stay exactly the same, and the baseline stays frozen. Press Next to compare.`;
    }
    if (step === 'result') {
      const comparison = host.panel.runWhatIf(change);
      if (!comparison) throw new Error('The What-if comparison did not produce a result (see the mission panel).');
      const plan = host.panel.whatIfPlan;
      if (!plan) throw new Error('The What-if comparison is missing.');
      const mismatch = demoMismatch('Baseline', comparison.baseline, fixture.expected.baseline) ?? demoMismatch('Changed case', comparison.alternative, fixture.expected.alternative);
      if (mismatch) throw new Error(mismatch);
      const text = describeWhatIf(comparison, baseline, plan.request, change, host.format);
      return `${text.headline} ${text.alternative} ${text.delta} Both are fixed starts; the changed case was not searched for.`;
    }
    const plan = host.panel.whatIfPlan;
    if (!plan) throw new Error('The What-if comparison is missing; restart the demo.');
    host.experience(plan);
    return 'You now stand at the site at the changed start, on the smooth reference sphere. Use the playback bar at the bottom: Play runs time forward, shows its speed, slows down near the end and pauses when the window ends, saying what ended. You can look around, pause or change speed at any time.';
  }
}
