import type { CandidateRegion, CandidateResult } from '../science/candidates';
import { assessCandidateResult, type CandidateAssessment } from '../science/candidate-assessment';
import { button, make } from './dom';
import { formatDuration, formatLatLon } from './format';

/** Compact bounds of the searched polygon, e.g. "lat 89.035° S to 88.965° S, lon 5° W to 5° E". */
function regionBounds(region: CandidateRegion): string {
  const lats = region.polygon.map((p) => p[0]);
  const lons = region.polygon.map((p) => p[1]);
  const trim = (value: number): string => String(Number(Math.abs(value).toFixed(3)));
  const lat = (value: number): string => `${trim(value)}° ${value < 0 ? 'S' : 'N'}`;
  const lon = (value: number): string => `${trim(value)}° ${value < 0 ? 'W' : 'E'}`;
  return `lat ${lat(Math.min(...lats))} to ${lat(Math.max(...lats))}, lon ${lon(Math.min(...lons))} to ${lon(Math.max(...lons))}`;
}

/** Row heading for each terrain assessment. Unknown terrain is never worded or styled as a pass. */
const STATE_LABEL: Record<CandidateAssessment['state'], string> = {
  'terrain-unknown': 'Reference option · terrain unknown',
  'confirmed-failure': 'Blocked by measured terrain',
  'confirmed-within-model': 'Confirmed on measured terrain, this instant',
  'conditional-reference': 'Reference option · duration unknown',
};

export type CandidateTone = 'option' | 'unknown' | 'blocked';
/** Badge tone for a shortlisted point, shared by the list and the markers on the Moon. */
export function candidateTone(result: CandidateResult): CandidateTone {
  const state = assessCandidateResult(result).state;
  return state === 'confirmed-failure' ? 'blocked' : state === 'confirmed-within-model' ? 'option' : 'unknown';
}

/**
 * The compact result of one search. It shows the shortlist it is given, in that order, numbered as the
 * markers are numbered; the wording of each row comes from the science module's assessment.
 */
export class CandidatesPanel {
  private results: ReadonlyArray<CandidateResult> = [];
  private shortlist: ReadonlyArray<CandidateResult> = [];
  private selected: string | null = null;
  private when = '';
  private region = '';

  constructor(private readonly host: HTMLElement, private readonly onSelect: (candidate: CandidateResult) => void, private readonly onClose: () => void) {}

  progress(region: CandidateRegion, when: string, completed = 0, total = 25): void {
    this.host.hidden = false;
    this.results = [];
    this.shortlist = [];
    this.host.replaceChildren(make('strong', '', 'Evaluating points'), make('p', 'candidate-meta', `${region.label} · ${when}`), make('p', '', `${completed} / ${total} points…`));
    this.host.setAttribute('aria-busy', 'true');
  }

  error(message: string): void {
    this.host.hidden = false;
    this.host.setAttribute('aria-busy', 'false');
    const close = button('Close', 'btn small');
    close.addEventListener('click', this.onClose);
    this.host.replaceChildren(make('strong', '', 'Search unavailable'), make('p', 'candidate-meta', message), close);
  }

  clear(): void {
    this.host.hidden = true;
    this.host.replaceChildren();
    this.results = [];
    this.shortlist = [];
  }

  /** Hide while standing on the surface and bring the same, still valid list back afterwards. */
  setVisible(visible: boolean): void {
    this.host.hidden = !visible || this.host.childElementCount === 0;
  }

  /** `results` is everything evaluated; `shortlist` is what is shown, in the order the markers use. */
  show(results: ReadonlyArray<CandidateResult>, shortlist: ReadonlyArray<CandidateResult>, region: CandidateRegion, when: string): void {
    this.results = results;
    this.shortlist = shortlist;
    this.region = `${region.label}: ${regionBounds(region)}`;
    this.when = when;
    this.selected = null;
    this.render();
  }

  select(id: string): void {
    this.selected = id;
    this.render();
  }

  private render(): void {
    this.host.hidden = false;
    this.host.setAttribute('aria-busy', 'false');
    const head = make('div', 'candidate-heading');
    const close = button('×', 'btn icon', 'Close the results; the selected point stays marked');
    close.addEventListener('click', this.onClose);
    head.append(make('strong', '', 'Lighting & Earth visibility options'), close);
    this.host.replaceChildren(head, make('p', 'candidate-meta', `${this.results.length} points evaluated · ${this.when}`));
    if (!this.shortlist.length) {
      this.host.append(make('p', '', 'No supported points in this area. Check the available terrain coverage.'));
      return;
    }
    const assessments = this.shortlist.map((result) => assessCandidateResult(result));
    const confirmed = assessments.filter((a) => a.state === 'confirmed-within-model').length;
    const blocked = assessments.filter((a) => a.state === 'confirmed-failure').length;
    const summary = make('p', 'candidate-summary',
      confirmed > 0 ? `${confirmed} of these ${confirmed === 1 ? 'is' : 'are'} confirmed on the measured terrain at this instant.`
        : blocked === assessments.length ? 'Every point shown has the Sun or Earth blocked by measured terrain.'
          : 'No point is confirmed on the measured terrain. These are provisional reference-sphere options.');
    summary.dataset['tone'] = confirmed > 0 ? 'confirmed' : blocked === assessments.length ? 'blocked' : 'unknown';
    this.host.append(summary);
    this.shortlist.forEach((result, index) => {
      const assessment = assessments[index]!;
      const pick = button('', 'candidate-choice');
      pick.dataset['candidateId'] = result.id;
      pick.dataset['state'] = assessment.state;
      pick.setAttribute('aria-pressed', String(this.selected === result.id));
      const title = make('strong', '');
      title.append(make('span', 'candidate-number', String(index + 1)), document.createTextNode(STATE_LABEL[assessment.state]));
      const coords = make('span', 'candidate-meta', formatLatLon(result.site.latDeg, result.site.lonDeg));
      const sun = result.reference.sun.centerAboveReferenceHorizon;
      const earth = result.reference.earth.centerAboveReferenceHorizon;
      const remaining = result.lighting.current.availableSeconds;
      const reference = make('span', '', `Reference sphere: Sun ${sun ? 'up' : 'down'} · Earth ${earth ? 'up' : 'down'}${sun && earth ? ` · both stay up ${formatDuration(remaining)}` : ''}`);
      const reason = make('span', 'candidate-terrain', assessment.reason);
      pick.append(title, coords, reference, reason);
      pick.addEventListener('click', () => { this.select(result.id); this.onSelect(result); });
      this.host.append(pick);
    });
    const details = make('details', 'candidate-details');
    details.append(make('summary', '', 'Criteria & coverage'));
    details.append(make('p', 'candidate-meta', `Only this area was searched: ${this.region}, on a 5 × 5 grid kept at least 160 m inside the terrain data. Not the whole 8 km terrain patch, and not the Moon.`));
    details.append(make('p', 'candidate-meta', 'Order: points with a body blocked by measured terrain go last; otherwise the reference-sphere order is kept (both centres up, Sun, Earth, remaining joint time, Sun altitude). This is a shortlist for display, not a score and not a landing-safety recommendation. Unknown terrain is not clear terrain.'));
    this.shortlist.forEach((result, index) => {
      details.append(make('p', 'candidate-meta', `${index + 1}: Sun ${result.reference.sun.altDeg.toFixed(2)}° on the reference sphere; slope ${result.slopeDeg.toFixed(1)}° at ${result.slopeScaleM} m grid scale. ${result.rankingReason} Grid estimates do not resolve rocks or certify traversability.`));
    });
    this.host.append(details);
  }
}
