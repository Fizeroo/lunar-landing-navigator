import type { BodyObservation, Observation } from '../contracts.ts';
import { ALTITUDE_GRID_DEG, altitudeToUnit, azimuthToUnit } from './skyProjection.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 320;
const H = 152;
const X0 = 34;
const X1 = 312;
const Y_TOP = 8;
const Y_BOTTOM = 136;
const Y_HORIZON = (Y_TOP + Y_BOTTOM) / 2;

function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

const xOfAz = (azDeg: number): number => X0 + azimuthToUnit(azDeg) * (X1 - X0);
const yOfAlt = (altDeg: number): number => Y_HORIZON - altitudeToUnit(altDeg) * (Y_HORIZON - Y_TOP);

interface BodyMark {
  group: SVGGElement;
  disc: SVGCircleElement;
  label: SVGTextElement;
  band: SVGLineElement;
  bandLabel: SVGTextElement;
}

/**
 * Explicitly schematic azimuth/altitude panorama of the local sky at one site.
 * It only draws values returned by the science module's observeAt().
 */
export class SkyDiagram {
  private readonly root: SVGSVGElement;
  private readonly sun: BodyMark;
  private readonly earth: BodyMark;
  private readonly empty: SVGTextElement;

  constructor(host: HTMLElement, siteLabel: string) {
    this.root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'sky' });
    this.root.setAttribute('aria-label', `Schematic local sky for ${siteLabel}`);

    const defs = svg('defs', {});
    const pattern = svg('pattern', { id: `ground-${siteLabel.replace(/\s+/g, '')}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pattern.append(svg('rect', { width: 6, height: 6, class: 'sky-ground-fill' }), svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'sky-ground-hatch' }));
    defs.append(pattern);
    this.root.append(defs);

    // Sky above the horizon, hatched ground below it.
    this.root.append(
      svg('rect', { x: X0, y: Y_TOP, width: X1 - X0, height: Y_HORIZON - Y_TOP, class: 'sky-above' }),
      svg('rect', { x: X0, y: Y_HORIZON, width: X1 - X0, height: Y_BOTTOM - Y_HORIZON, fill: `url(#${pattern.id})` }),
    );

    for (const alt of ALTITUDE_GRID_DEG) {
      const y = yOfAlt(alt);
      if (alt !== 0) this.root.append(svg('line', { x1: X0, y1: y, x2: X1, y2: y, class: 'sky-grid' }));
      if (alt === 0) continue;
      const label = `${alt > 0 ? '+' : '−'}${Math.abs(alt)}°`;
      const dy = alt === 90 ? 7 : alt === -90 ? -1 : 3;
      this.root.append(svg('text', { x: X0 - 4, y: y + dy, class: 'sky-axis', 'text-anchor': 'end' }, label));
    }

    const cardinals: Array<[number, string]> = [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'], [360, 'N']];
    for (const [az, name] of cardinals) {
      const x = X0 + (az / 360) * (X1 - X0);
      this.root.append(
        svg('line', { x1: x, y1: Y_TOP, x2: x, y2: Y_BOTTOM, class: 'sky-grid' }),
        svg('text', { x, y: Y_BOTTOM + 12, class: 'sky-cardinal', 'text-anchor': az === 0 ? 'start' : az === 360 ? 'end' : 'middle' }, name),
      );
    }

    this.root.append(
      svg('line', { x1: X0, y1: Y_HORIZON, x2: X1, y2: Y_HORIZON, class: 'sky-horizon' }),
      svg('text', { x: X1 - 4, y: Y_TOP + 10, class: 'sky-note', 'text-anchor': 'end' }, 'above horizon'),
      svg('text', { x: X1 - 4, y: Y_BOTTOM - 5, class: 'sky-note', 'text-anchor': 'end' }, 'below horizon'),
      svg('text', { x: X0 + 4, y: Y_HORIZON - 3, class: 'sky-horizon-label' }, 'horizon 0°'),
    );

    this.earth = this.makeBody('earth', 'Earth');
    this.sun = this.makeBody('sun', 'Sun');
    this.empty = svg('text', { x: (X0 + X1) / 2, y: Y_HORIZON - 18, class: 'sky-empty', 'text-anchor': 'middle' }, 'No data');
    this.root.append(this.empty);
    const caption = document.createElement('p');
    caption.className = 'sky-caption';
    caption.textContent = 'Schematic sky · √-scaled altitude · symbols not to scale';
    host.replaceChildren(this.root, caption);
  }

  /** Draw one observation, or clear the bodies when there is no valid value. */
  update(observation: Observation | null): void {
    this.empty.style.display = observation ? 'none' : '';
    this.place(this.sun, observation?.sun ?? null, 'Sun');
    this.place(this.earth, observation?.earth ?? null, 'Earth');
  }

  private makeBody(kind: 'sun' | 'earth', name: string): BodyMark {
    const group = svg('g', { class: `sky-body sky-${kind}` });
    const band = svg('line', { x1: X0, x2: X1, class: 'sky-band' });
    const bandLabel = svg('text', { x: X0 + 4, class: 'sky-band-label' }, `${name}: azimuth undefined`);
    const disc = svg('circle', { r: 6.5, class: 'sky-disc' });
    const label = svg('text', { class: 'sky-body-label' }, name);
    group.append(band, bandLabel, disc, label);
    group.style.display = 'none';
    this.root.append(group);
    return { group, disc, label, band, bandLabel };
  }

  private place(mark: BodyMark, body: BodyObservation | null, name: string): void {
    if (!body) {
      mark.group.style.display = 'none';
      return;
    }
    mark.group.style.display = '';
    mark.group.classList.toggle('below', !body.centerAboveReferenceHorizon);
    const y = yOfAlt(body.altDeg);
    const azKnown = body.azDeg !== null;
    mark.disc.style.display = azKnown ? '' : 'none';
    mark.label.style.display = azKnown ? '' : 'none';
    mark.band.style.display = azKnown ? 'none' : '';
    mark.bandLabel.style.display = azKnown ? 'none' : '';
    if (body.azDeg !== null) {
      const x = xOfAz(body.azDeg);
      mark.disc.setAttribute('cx', x.toFixed(2));
      mark.disc.setAttribute('cy', y.toFixed(2));
      const right = x < X1 - 44;
      mark.label.setAttribute('x', (right ? x + 10 : x - 10).toFixed(2));
      mark.label.setAttribute('y', (y + 3.5).toFixed(2));
      mark.label.setAttribute('text-anchor', right ? 'start' : 'end');
    } else {
      // Exact pole / zenith / nadir: azimuth does not exist, so no position is invented.
      mark.band.setAttribute('y1', y.toFixed(2));
      mark.band.setAttribute('y2', y.toFixed(2));
      mark.bandLabel.setAttribute('y', (y - 3).toFixed(2));
      mark.bandLabel.textContent = `${name}: azimuth undefined here — altitude only`;
    }
  }
}
