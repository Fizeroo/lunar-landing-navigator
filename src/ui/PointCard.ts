import { button, make } from './dom.ts';
import { compassPoint, formatLatLon, formatSignedDeg } from './format.ts';

export interface PointBody {
  altDeg: number;
  azDeg: number | null;
  /** Short state from the science result, e.g. "above horizon", "blocked by terrain". */
  state: string;
  tone: 'pos' | 'neg' | 'unknown';
}

export interface PointCardInput {
  badge: 'A' | 'B';
  name: string;
  latDeg: number;
  lonDeg: number;
  /** Null while there is no valid observation (no data, or a failed calculation). */
  sun: PointBody | null;
  earth: PointBody | null;
  /** One short line: which model the two states above come from. */
  model: string;
  /** Shown instead of the body rows when nothing can be calculated. */
  problem: string | null;
  view: 'orbit' | 'surface' | 'space';
  /** True while the surface position differs from the selected point (the user walked away). */
  moved: boolean;
}

export interface PointCardHandlers {
  onExplore(): void;
  onOrbit(): void;
}

/**
 * The compact card for the one selected point: where it is, where the Sun and Earth are now,
 * which model says so, and the single action that moves between Orbit and Surface.
 * It only displays values it is given; it never calculates.
 */
export class PointCard {
  private readonly badge = make('span', 'site-badge');
  private readonly name = make('strong', 'point-name');
  private readonly coords = make('span', 'point-coords');
  private readonly rows: Record<'sun' | 'earth', { value: HTMLElement; state: HTMLElement }>;
  private readonly bodies = make('div', 'point-bodies');
  private readonly problem = make('p', 'point-problem');
  private readonly model = make('p', 'point-model');
  private readonly action = button('Explore here ▸', 'btn primary point-action');
  private view: PointCardInput['view'] = 'orbit';

  constructor(private readonly root: HTMLElement, handlers: PointCardHandlers) {
    const head = make('div', 'point-head');
    const title = make('div', 'point-title');
    title.append(this.name, this.coords);
    head.append(this.badge, title);
    this.rows = {} as PointCard['rows'];
    for (const body of ['sun', 'earth'] as const) {
      const label = make('span', `point-body ${body}`);
      label.append(make('i', `dot dot-${body}`), document.createTextNode(body === 'sun' ? 'Sun' : 'Earth'));
      const value = make('span', 'point-value', '—');
      const state = make('span', 'readout-state', '—');
      this.bodies.append(label, value, state);
      this.rows[body] = { value, state };
    }
    this.problem.setAttribute('role', 'alert');
    this.action.addEventListener('click', () => (this.view === 'orbit' ? handlers.onExplore() : handlers.onOrbit()));
    root.append(head, this.bodies, this.problem, this.model, this.action);
  }

  render(input: PointCardInput): void {
    this.view = input.view;
    this.root.dataset['site'] = input.badge.toLowerCase();
    this.badge.textContent = input.badge;
    this.name.textContent = input.moved ? `${input.name} — walked away` : input.name;
    this.name.title = this.name.textContent;
    this.coords.textContent = formatLatLon(input.latDeg, input.lonDeg);
    this.problem.textContent = input.problem ?? '';
    this.bodies.hidden = input.problem !== null;
    for (const body of ['sun', 'earth'] as const) {
      const row = this.rows[body];
      const value = input[body];
      row.value.textContent = value ? `${formatSignedDeg(value.altDeg, 1)}${value.azDeg === null ? '' : ` · ${compassPoint(value.azDeg)}`}` : '—';
      row.value.title = value
        ? `Body centre: altitude ${formatSignedDeg(value.altDeg, 2)}, azimuth ${value.azDeg === null ? 'undefined here' : `${value.azDeg.toFixed(1)}° (north = 0°, east = 90°)`}`
        : '';
      row.state.textContent = value ? value.state : '—';
      if (value) row.state.dataset['tone'] = value.tone;
      else delete row.state.dataset['tone'];
    }
    this.model.textContent = input.model;
    this.action.textContent = input.view === 'orbit' ? 'Explore here ▸' : '◂ Back to orbit';
    this.action.title = input.view === 'orbit' ? 'Fly down and stand at this point' : 'Return to the Moon seen from orbit';
  }
}
