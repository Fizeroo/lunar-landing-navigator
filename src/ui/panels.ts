import type { EphemerisData } from '../contracts.ts';
import type { TerrainPatch } from '../science/terrain.ts';
import { CATALOGUE_GROUPS, GAZETTEER_URL, entriesInGroup, type CatalogueEntry } from './catalogue.ts';
import { button, link, make } from './dom.ts';
import { formatLatLon } from './format.ts';

/** Catalogue dialog: grouped named sites with a source link each and "Set as A / B". */
export function renderCatalogue(host: HTMLElement, onChoose: (target: 'a' | 'b', entry: CatalogueEntry) => void): void {
  const intro = make('p', 'panel-intro');
  intro.append(
    'Every coordinate is the current feature-centre value on that feature’s own page in the ',
    link('IAU/USGS Gazetteer of Planetary Nomenclature', GAZETTEER_URL),
    ' (checked 2026-11-14). These are illustrative reference points placed on a smooth sphere — not designated or surveyed landing positions.',
  );
  host.replaceChildren(intro);
  for (const group of CATALOGUE_GROUPS) {
    const section = make('section', 'catalogue-group');
    section.append(make('h3', undefined, group.title));
    const description = make('p', 'panel-note');
    description.append(`${group.description} Context: `, link(group.contextLabel, group.contextUrl), '.');
    section.append(description);
    const list = make('div', 'catalogue-list');
    for (const entry of entriesInGroup(group.id)) {
      const row = make('div', 'catalogue-row');
      const text = make('div', 'catalogue-text');
      text.append(make('strong', undefined, entry.name), make('span', 'catalogue-note', `${entry.note} · ${entry.kind}`));
      const coords = make('span', 'catalogue-coords', formatLatLon(entry.latDeg, entry.lonDeg));
      const source = link('source', entry.sourceUrl);
      source.title = `Gazetteer page for ${entry.name}`;
      const toA = button('Set as A', 'btn tiny site-a', `Use ${entry.name} as Site A`);
      toA.addEventListener('click', () => onChoose('a', entry));
      const toB = button('Set as B', 'btn tiny site-b', `Use ${entry.name} as Site B`);
      toB.addEventListener('click', () => onChoose('b', entry));
      row.append(text, coords, source, toA, toB);
      list.append(row);
    }
    section.append(list);
    host.append(section);
  }
}

function definitionList(pairs: Array<[string, string | Node]>): HTMLElement {
  const dl = make('dl', 'facts');
  for (const [term, value] of pairs) {
    dl.append(make('dt', undefined, term));
    const dd = make('dd');
    dd.append(value);
    dl.append(dd);
  }
  return dl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value) : '—');

export interface DataPanelInput {
  data: EphemerisData | null;
  dataUrl: string;
  dataError: string | null;
  terrain: TerrainPatch | null;
  terrainError: string | null;
}

/** "Data & accuracy": what is computed, from which files, and what is not modelled. */
export function renderDataPanel(host: HTMLElement, input: DataPanelInput): void {
  const { data, terrain } = input;
  host.replaceChildren();

  const ephemeris = make('section');
  ephemeris.append(make('h3', undefined, 'Ephemeris dataset'));
  if (!data) {
    ephemeris.append(make('p', 'panel-error', input.dataError ? `Not loaded: ${input.dataError}` : 'Not loaded yet.'));
  } else {
    const p = data.provenance;
    ephemeris.append(definitionList([
      ['Dataset', data.id],
      ['File', input.dataUrl],
      ['Coverage', `${data.coverage.startUtc} to ${data.coverage.endUtc} (UTC)`],
      ['Samples', `${data.samples.length} positions of the Sun and Earth, every ${text(p['stepSeconds'])} s of ephemeris time`],
      ['Frame', `${data.model.frame} — Moon-centred, Moon-fixed mean-Earth/polar-axis frame`],
      ['Positions', `Geometric (aberration correction ${data.model.abcorr}): no light-time or stellar aberration`],
      ['Generator', `${text(p['generator'])} ${text(p['generatorVersion'])}, SpiceyPy ${text(p['spiceypyVersion'])}, ${text(p['cspiceVersion'])}`],
      ['Generated', text(p['generatedUtc'])],
    ]));
    const kernels = p['kernels'];
    if (Array.isArray(kernels)) {
      const table = make('table', 'kernel-table');
      const head = make('tr');
      for (const title of ['NAIF kernel', 'SHA-256 (first 16)', 'Source']) head.append(make('th', undefined, title));
      table.append(head);
      for (const kernel of kernels) {
        if (!isRecord(kernel)) continue;
        const row = make('tr');
        const source = make('td');
        source.append(typeof kernel['url'] === 'string' ? link('naif.jpl.nasa.gov', kernel['url']) : '—');
        row.append(make('td', undefined, text(kernel['filename'])), make('td', 'mono', text(kernel['sha256']).slice(0, 16)), source);
        table.append(row);
      }
      ephemeris.append(table);
    }
  }
  host.append(ephemeris);

  const model = make('section');
  model.append(make('h3', undefined, 'What the numbers mean'));
  const list = make('ul', 'panel-list');
  for (const line of [
    'Reference-sphere model (all comparisons, timelines, events and scenarios): the observer stands on a smooth sphere of radius 1737.4 km, optionally raised by an observer height of 0–10 000 m. A body counts as “above the horizon” when its centre is above the local tangent plane (altitude > 0°).',
    'With a height above 0 m the visible limb of the smooth sphere lies below that tangent plane (the “dip”). A body can therefore be below the reference horizon and still above the smooth-sphere limb; the surface view shows both and labels them separately.',
    'Between 10-minute samples the positions are interpolated linearly, and rise/set times are solved exactly for that interpolated model. They are shown rounded to the minute and should be read as approximate.',
    '“Next changes” are searched in all available data, not only the selected comparison period. “Not found within available data” does not mean “never”. The start or end of the data is never reported as a rise or set.',
    'Azimuth is measured from north through east. At an exact pole, the zenith or the nadir it does not exist and is shown as undefined.',
    'Not modelled: terrain shadows over time, eclipses, refraction, light-time, the Sun’s and Earth’s visible fraction, power generation, communication links. Nothing here ranks landing safety.',
    'Space view: directions and lighting are real, distances and sizes are not to scale, and Earth’s rotation is not modelled. Surface view: Sun and Earth are drawn in their computed directions at their true angular size; the Sun’s glow is enlarged for visibility.',
  ]) list.append(make('li', undefined, line));
  model.append(list);
  host.append(model);

  const terrainSection = make('section');
  terrainSection.append(make('h3', undefined, 'Local terrain patch (surface view only)'));
  if (!terrain) {
    terrainSection.append(make('p', 'panel-note', input.terrainError ? `Not loaded: ${input.terrainError}. The surface view uses the smooth reference sphere.` : 'Not loaded. The surface view uses the smooth reference sphere.'));
  } else {
    const s = terrain.source;
    const product = make('span');
    product.append(`${s.product} — `, link('product page', s.productPage));
    terrainSection.append(definitionList([
      ['Patch', terrain.id],
      ['Source', product],
      ['Grid', `${terrain.grid.rows} × ${terrain.grid.cols} cells at ${terrain.grid.pixelSizeM} m (${terrain.grid.validCellCount} valid, ${terrain.grid.noDataCellCount} no-data); heights in ${s.heightUnits} relative to the 1737.4 km sphere`],
      ['Test point', `${formatLatLon(terrain.observer.site.latDeg, terrain.observer.site.lonDeg)}; ground ${terrain.observer.groundHeightM.toFixed(1)} m relative to the sphere`],
      ['Frames', `DEM frame ${s.sourceFrame}; app frame ${terrain.frame}. ${s.frameAlignment}`],
      ['Citation', s.citation],
      ['Licence', s.license],
    ]));
    const limits = make('ul', 'panel-list');
    for (const line of [
      'The patch is small. Terrain outside it is unknown, not flat: the view draws nothing there and marks the edge of coverage.',
      'Terrain visibility has three answers. “Blocked” means terrain inside the patch (or the smooth sphere) is in the way. “Coverage insufficient” means nothing inside the patch blocks the body, but relief beyond the patch cannot be ruled out. “Clear” is reported only when that can be excluded.',
      'Terrain is used only for the instantaneous surface view. Comparisons, timelines, events and scenarios stay on the reference-sphere model.',
    ]) limits.append(make('li', undefined, line));
    terrainSection.append(limits);
  }
  host.append(terrainSection);

  const sources = make('section');
  sources.append(make('h3', undefined, 'Sources'));
  const sourceList = make('ul', 'panel-list');
  const item = (...children: Array<Node | string>): void => {
    const li = make('li');
    li.append(...children);
    sourceList.append(li);
  };
  item(link('NASA/JPL NAIF generic SPICE kernels', 'https://naif.jpl.nasa.gov/naif/data.html'), ' — Sun and Earth positions (DE440s), lunar orientation and frames, leap seconds.');
  item(link('NASA Scientific Visualization Studio: CGI Moon Kit', 'https://svs.gsfc.nasa.gov/4720'), ' — colour texture of the Moon (LRO LROC/LOLA). Appearance only; not used for any calculation.');
  item(link('IAU/USGS Gazetteer of Planetary Nomenclature', GAZETTEER_URL), ' — names and feature-centre coordinates in the site catalogue.');
  if (terrain) item(link(terrain.source.product, terrain.source.productPage), ' — LOLA elevation model for the local terrain patch.');
  item('Scenarios are stored only in this browser’s localStorage. Nothing is sent to a server; the app makes no network requests after loading its own files.');
  sources.append(sourceList);
  host.append(sources);
}
