import type { Observation } from '../contracts.ts';
import type { TerrainProfile } from '../science/terrain.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 340;
const H = 82;
const X0 = 30;
const X1 = 334;
const Y0 = 6;
const Y1 = 70;
/** Linear altitude window of the strip, degrees. Values outside are clamped to the edge. */
const ALT_MIN = -10;
const ALT_MAX = 20;

function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

const xOf = (azDeg: number): number => X0 + (((azDeg % 360) + 360) % 360) / 360 * (X1 - X0);
const yOf = (altDeg: number): number => Y1 - ((Math.min(ALT_MAX, Math.max(ALT_MIN, altDeg)) - ALT_MIN) / (ALT_MAX - ALT_MIN)) * (Y1 - Y0);

/**
 * Terrain skyline strip for the surface view: the highest terrain elevation angle
 * the science module found in each azimuth bin of the DEM patch, plus the Sun and
 * Earth at their terrain-point azimuth/altitude. It draws only supplied values.
 */
export class TerrainProfileView {
  private readonly root: SVGSVGElement;
  private readonly skyline = svg('path', { class: 'tp-skyline' });
  private readonly sun = svg('circle', { r: 4.5, class: 'tp-sun' });
  private readonly earth = svg('circle', { r: 4.5, class: 'tp-earth' });
  private readonly sunLabel = svg('text', { class: 'tp-body-label tp-sun-label' }, 'Sun');
  private readonly earthLabel = svg('text', { class: 'tp-body-label tp-earth-label' }, 'Earth');

  constructor(host: HTMLElement) {
    this.root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'terrain-profile' });
    this.root.setAttribute('aria-label', 'Terrain skyline from the DEM patch: elevation angle against azimuth, with the Sun and Earth');
    this.root.append(svg('rect', { x: X0, y: Y0, width: X1 - X0, height: Y1 - Y0, class: 'tp-back' }));
    for (const alt of [-10, 0, 10, 20]) {
      this.root.append(
        svg('line', { x1: X0, y1: yOf(alt), x2: X1, y2: yOf(alt), class: alt === 0 ? 'tp-zero' : 'tp-grid' }),
        svg('text', { x: X0 - 3, y: yOf(alt) + 3, class: 'tp-axis', 'text-anchor': 'end' }, `${alt > 0 ? '+' : alt < 0 ? '−' : ''}${Math.abs(alt)}°`),
      );
    }
    for (const [az, name] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'], [360, 'N']] as const) {
      const x = X0 + (az / 360) * (X1 - X0);
      this.root.append(
        svg('line', { x1: x, y1: Y0, x2: x, y2: Y1, class: 'tp-grid' }),
        svg('text', { x, y: Y1 + 10, class: 'tp-cardinal', 'text-anchor': az === 0 ? 'start' : az === 360 ? 'end' : 'middle' }, name),
      );
    }
    this.root.append(this.skyline, this.earth, this.sun, this.earthLabel, this.sunLabel);
    const caption = document.createElement('p');
    caption.className = 'tp-caption';
    caption.textContent = 'Terrain skyline inside the DEM patch only (−10° to +20°). Beyond the patch: unknown.';
    host.replaceChildren(this.root, caption);
  }

  update(profile: TerrainProfile | null, observation: Observation | null): void {
    let path = '';
    let open = false;
    for (const sample of profile?.samples ?? []) {
      if (sample.horizonAltDeg === null) {
        open = false;
        continue;
      }
      path += `${open ? 'L' : 'M'}${xOf(sample.azDeg).toFixed(1)} ${yOf(sample.horizonAltDeg).toFixed(1)} `;
      open = true;
    }
    this.skyline.setAttribute('d', path.trim());
    for (const [node, label, body] of [[this.sun, this.sunLabel, observation?.sun], [this.earth, this.earthLabel, observation?.earth]] as const) {
      if (!body || body.azDeg === null) {
        node.style.display = 'none';
        label.style.display = 'none';
        continue;
      }
      node.style.display = '';
      label.style.display = '';
      const x = xOf(body.azDeg);
      const y = yOf(body.altDeg);
      node.setAttribute('cx', x.toFixed(1));
      node.setAttribute('cy', y.toFixed(1));
      // Name each marker; flip the label near the right edge and the top so it stays inside the strip.
      label.setAttribute('x', (x > X1 - 40 ? x - 7 : x + 7).toFixed(1));
      label.setAttribute('y', (y < Y0 + 12 ? y + 12 : y - 6).toFixed(1));
      label.setAttribute('text-anchor', x > X1 - 40 ? 'end' : 'start');
    }
  }
}
