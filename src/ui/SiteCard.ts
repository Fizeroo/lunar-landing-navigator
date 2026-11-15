import type { BodyObservation, Observation } from '../contracts.ts';
import type { UpcomingEvents } from '../science/events.ts';
import { button, make } from './dom.ts';
import { compassPoint, formatCountdown, formatLatLon, formatSignedDeg } from './format.ts';
import { SkyDiagram } from './SkyDiagram.ts';

export type SiteId = 'a' | 'b';

export interface SiteCardHandlers {
  onPick: () => void;
  onCatalogue: () => void;
  onExplore: () => void;
  onSet: (latDeg: number, lonDeg: number, heightM: number) => void;
  onJump: (et: number) => void;
}

export interface SiteCardLocation {
  name: string;
  latDeg: number;
  lonDeg: number;
  heightM: number;
  /** One-line provenance for the point, with an optional source link. */
  sourceText: string;
  sourceUrl: string | null;
  /** Horizon dip of the smooth sphere at this height, degrees (from the science module). */
  dipDeg: number;
}

interface EventRow {
  label: HTMLElement;
  when: HTMLElement;
  countdown: HTMLElement;
  go: HTMLButtonElement;
  et: number | null;
}

const EVENT_LABELS = { sunrise: 'Sunrise', sunset: 'Sunset', earthrise: 'Earthrise', earthset: 'Earthset' } as const;
type EventKind = keyof typeof EVENT_LABELS;
const EVENT_KINDS: readonly EventKind[] = ['sunrise', 'sunset', 'earthrise', 'earthset'];

/** One site: current conditions, next changes, and folded location / sky details. */
export class SiteCard {
  readonly root: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly coords: HTMLElement;
  private readonly pick: HTMLButtonElement;
  private readonly model: HTMLElement;
  private readonly source: HTMLElement;
  private readonly error: HTMLElement;
  private readonly lat: HTMLInputElement;
  private readonly lon: HTMLInputElement;
  private readonly height: HTMLInputElement;
  private readonly sky: SkyDiagram;
  private readonly bodies: Record<'sun' | 'earth', { alt: HTMLElement; az: HTMLElement; state: HTMLElement }>;
  private readonly events: Record<EventKind, EventRow>;
  private readonly joint: EventRow;
  private readonly eventsNote: HTMLElement;
  private readonly siteName: string;

  constructor(id: SiteId, private readonly handlers: SiteCardHandlers) {
    this.siteName = id === 'a' ? 'Site A' : 'Site B';
    const name = this.siteName;
    this.root = make('article', `site-card site-${id}`);
    this.root.setAttribute('aria-label', name);

    const head = make('header', 'site-head');
    const title = make('div', 'site-title');
    this.heading = make('h2', undefined, name);
    this.coords = make('p', 'site-coords', '—');
    title.append(this.heading, this.coords);
    this.pick = button('Pick on globe', 'btn pick', `Make ${name} the site placed by clicking the globe`);
    this.pick.addEventListener('click', () => handlers.onPick());
    head.append(make('span', 'site-badge', id.toUpperCase()), title, this.pick);

    const actions = make('div', 'site-actions');
    const catalogue = button('Catalogue…', 'btn small', `Choose a named site for ${name}`);
    catalogue.addEventListener('click', () => handlers.onCatalogue());
    const explore = button('Explore surface ▸', 'btn small', `Stand at ${name} and look around`);
    explore.addEventListener('click', () => handlers.onExplore());
    actions.append(catalogue, explore);

    // Current conditions.
    const now = make('section', 'site-block');
    now.append(make('h3', undefined, 'Now'));
    const readout = make('div', 'readout');
    this.bodies = {} as SiteCard['bodies'];
    for (const body of ['sun', 'earth'] as const) {
      const label = make('span', `readout-body ${body}`);
      label.append(make('i', `dot dot-${body}`), document.createTextNode(body === 'sun' ? 'Sun' : 'Earth'));
      const alt = make('span', 'readout-value', '—');
      const az = make('span', 'readout-value', '—');
      const state = make('span', 'readout-state', '—');
      alt.title = 'Altitude of the body centre above the reference horizon (tangent plane)';
      az.title = 'Azimuth: north = 0°, east = 90°';
      readout.append(label, alt, az, state);
      this.bodies[body] = { alt, az, state };
    }
    this.model = make('p', 'site-model');
    now.append(readout, this.model);

    // Next changes.
    const next = make('section', 'site-block');
    next.append(make('h3', undefined, 'Next changes'));
    const list = make('div', 'events');
    const makeRow = (text: string): EventRow => {
      const label = make('span', 'event-label', text);
      const when = make('span', 'event-when', '—');
      const countdown = make('span', 'event-countdown', '');
      const go = button('Go', 'btn tiny', `Jump to: ${text}`);
      const row: EventRow = { label, when, countdown, go, et: null };
      go.addEventListener('click', () => {
        if (row.et !== null) handlers.onJump(row.et);
      });
      list.append(label, when, countdown, go);
      return row;
    };
    this.events = {} as SiteCard['events'];
    for (const kind of EVENT_KINDS) this.events[kind] = makeRow(EVENT_LABELS[kind]);
    this.joint = makeRow('Sun + Earth');
    this.eventsNote = make('p', 'events-note');
    next.append(list, this.eventsNote);

    // Location (folded).
    const location = make('details', 'fold site-fold');
    const locationSummary = make('summary');
    locationSummary.append(make('span', 'fold-title', 'Location & height'));
    const form = make('form', 'site-form');
    form.noValidate = true;
    const field = (labelText: string, title: string, min: number, max: number): HTMLInputElement => {
      const wrap = make('label');
      wrap.append(make('span', undefined, labelText));
      const input = make('input');
      input.type = 'number';
      input.step = 'any';
      input.min = String(min);
      input.max = String(max);
      input.required = true;
      input.title = title;
      input.setAttribute('aria-label', `${name} ${title}`);
      wrap.append(input);
      form.append(wrap);
      return input;
    };
    this.lat = field('Lat °', 'planetocentric latitude, −90 to 90 (south negative)', -90, 90);
    this.lon = field('Lon °E', 'east-positive longitude, −180 to 360', -180, 360);
    this.height = field('Height m', 'observer height above the reference sphere, 0 to 10000 m', 0, 10000);
    const set = make('button', 'btn', 'Set');
    set.type = 'submit';
    form.append(set);
    this.source = make('p', 'site-source');
    this.error = make('p', 'field-error');
    this.error.setAttribute('role', 'alert');
    location.append(locationSummary, form, this.source);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const latValue = Number(this.lat.value);
      const lonValue = Number(this.lon.value);
      const heightValue = Number(this.height.value);
      if (this.lat.value.trim() === '' || !Number.isFinite(latValue) || latValue < -90 || latValue > 90) return this.showError('Latitude must be a number from −90 to 90.');
      if (this.lon.value.trim() === '' || !Number.isFinite(lonValue) || lonValue < -180 || lonValue > 360) return this.showError('Longitude must be a number from −180 to 360 (east-positive).');
      if (this.height.value.trim() === '' || !Number.isFinite(heightValue) || heightValue < 0 || heightValue > 10000) return this.showError('Height must be a number from 0 to 10000 m.');
      handlers.onSet(latValue, lonValue, heightValue);
    });

    // Local sky (folded).
    const skyFold = make('details', 'fold site-fold');
    const skySummary = make('summary');
    skySummary.append(make('span', 'fold-title', 'Local sky diagram'));
    const skyHost = make('div', 'sky-host');
    this.sky = new SkyDiagram(skyHost, name);
    skyFold.append(skySummary, skyHost);

    this.root.append(head, actions, now, next, this.error, location, skyFold);
  }

  showError(message: string): void {
    this.error.textContent = message;
  }

  setActive(active: boolean): void {
    this.root.classList.toggle('active', active);
    this.pick.setAttribute('aria-pressed', String(active));
    this.pick.textContent = active ? 'Picking on globe' : 'Pick on globe';
  }

  renderLocation(location: SiteCardLocation): void {
    this.heading.textContent = `${this.siteName} · ${location.name}`;
    this.coords.textContent = formatLatLon(location.latDeg, location.lonDeg);
    this.lat.value = String(Number(location.latDeg.toFixed(4)));
    this.lon.value = String(Number(location.lonDeg.toFixed(4)));
    this.height.value = String(Number(location.heightM.toFixed(1)));
    this.error.textContent = '';
    this.source.replaceChildren(location.sourceText);
    if (location.sourceUrl) {
      const a = make('a', undefined, 'source');
      a.href = location.sourceUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      this.source.append(' (', a, ')');
    }
    this.model.textContent = location.heightM > 0
      ? `Reference-sphere model, observer ${Math.round(location.heightM)} m up. At this height the smooth-sphere limb is ${location.dipDeg.toFixed(2)}° below the reference horizon used here.`
      : 'Reference-sphere model, observer at 0 m.';
  }

  renderObservation(observation: Observation | null): void {
    this.sky.update(observation);
    this.renderBody(this.bodies.sun, observation?.sun ?? null);
    this.renderBody(this.bodies.earth, observation?.earth ?? null);
  }

  /** `formatWhen` turns an ET into "YYYY-MM-DD HH:MM UTC"; `searchedText` names the searched data range. */
  renderEvents(events: UpcomingEvents | null, et: number | null, formatWhen: (et: number) => string, searchedText: string): void {
    for (const kind of EVENT_KINDS) {
      const row = this.events[kind];
      const event = events?.[kind] ?? null;
      row.et = event?.et ?? null;
      row.when.textContent = event ? formatWhen(event.et) : events ? 'Not found within available data' : '—';
      row.when.classList.toggle('wide', !event);
      row.countdown.hidden = !event;
      row.countdown.textContent = event && et !== null ? formatCountdown(event.et - et) : '';
      row.go.disabled = !event;
    }
    const joint = events?.joint ?? null;
    this.joint.when.classList.add('wide');
    this.joint.countdown.hidden = true;
    if (!joint) {
      this.joint.et = null;
      this.joint.when.textContent = events ? 'No window found within available data' : '—';
      this.joint.countdown.textContent = '';
      this.joint.go.disabled = true;
    } else if (joint.ongoing) {
      this.joint.et = joint.endEt;
      this.joint.label.textContent = 'Sun + Earth';
      this.joint.when.textContent = joint.endClipped ? `both up; data ends ${formatWhen(joint.endEt)}` : `both up until ${formatWhen(joint.endEt)}`;
      this.joint.when.title = et !== null && !joint.endClipped ? `Both above the reference horizon ${formatCountdown(joint.endEt - et).replace(/^in /, 'for another ')}` : 'The data ends before this window does; its real end is not known';
      this.joint.go.disabled = joint.endClipped;
      this.joint.go.title = 'Jump to the end of this window';
    } else {
      this.joint.et = joint.startEt;
      this.joint.when.textContent = `next from ${formatWhen(joint.startEt)}`;
      this.joint.when.title = et !== null ? `Next Sun + Earth window starts ${formatCountdown(joint.startEt - et)}` : '';
      this.joint.go.disabled = false;
      this.joint.go.title = 'Jump to the start of the next Sun + Earth window';
    }
    this.eventsNote.textContent = events ? searchedText : '';
  }

  private renderBody(row: { alt: HTMLElement; az: HTMLElement; state: HTMLElement }, body: BodyObservation | null): void {
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
}
