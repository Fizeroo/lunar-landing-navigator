import type { TimeInterval } from '../contracts.ts';

export interface TimelineRow {
  /** Text shown in the label column, e.g. "A · Sun". */
  label: string;
  /** Accessible description, e.g. "Site A: Sun above reference horizon". */
  description: string;
  /** CSS class suffix for colouring: site-a | site-b and sun | earth | both. */
  site: 'a' | 'b';
  condition: 'sun' | 'earth' | 'both';
  intervals: readonly TimeInterval[];
  /** Summary shown at the right of the row, e.g. "62.1%". */
  summary: string;
}

export interface TimelineTick {
  et: number;
  label: string;
  major: boolean;
}

export interface TimelineData {
  period: TimeInterval;
  rows: readonly TimelineRow[];
  ticks: readonly TimelineTick[];
  /** Tooltip text for one bar (UTC rounded to minutes, approximate duration). */
  describe: (row: TimelineRow, interval: TimeInterval) => string;
}

function div(className: string, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Six shared-axis interval rows with one current-time cursor.
 * Bars are drawn only from the intervals it is given; it computes nothing.
 */
export class Timeline {
  private readonly labels = div('tl-labels');
  private readonly tracks = div('tl-tracks');
  private readonly summaries = div('tl-summaries');
  private readonly cursor = div('tl-cursor');
  private readonly tooltip = div('tl-tooltip');
  private readonly message = div('tl-message');
  private period: TimeInterval | null = null;
  private dragging = false;

  constructor(private readonly host: HTMLElement, private readonly onSeek: (et: number) => void) {
    host.classList.add('tl');
    host.append(this.labels, this.tracks, this.summaries, this.tooltip, this.message);
    this.tooltip.hidden = true;
    this.cursor.setAttribute('aria-hidden', 'true');

    this.tracks.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !this.period) return;
      this.dragging = true;
      this.tracks.setPointerCapture(event.pointerId);
      this.seek(event.clientX);
    });
    this.tracks.addEventListener('pointermove', (event) => {
      if (this.dragging) this.seek(event.clientX);
      this.showTooltip(event);
    });
    const end = (event: PointerEvent): void => {
      this.dragging = false;
      if (this.tracks.hasPointerCapture(event.pointerId)) this.tracks.releasePointerCapture(event.pointerId);
    };
    this.tracks.addEventListener('pointerup', end);
    this.tracks.addEventListener('pointercancel', end);
    this.tracks.addEventListener('pointerleave', () => {
      this.tooltip.hidden = true;
    });
  }

  /** Remove all bars and show a message (loading, error, or nothing to show). */
  clear(message: string): void {
    this.period = null;
    this.labels.replaceChildren();
    this.tracks.replaceChildren();
    this.summaries.replaceChildren();
    this.message.textContent = message;
    this.message.hidden = false;
    this.tooltip.hidden = true;
  }

  setData(data: TimelineData): void {
    this.period = data.period;
    this.message.hidden = true;
    const span = data.period.endEt - data.period.startEt;
    const percent = (et: number): number => ((et - data.period.startEt) / span) * 100;

    const labelNodes: HTMLElement[] = [];
    const trackNodes: HTMLElement[] = [];
    const summaryNodes: HTMLElement[] = [];
    for (const row of data.rows) {
      const label = div(`tl-label site-${row.site}`);
      const dot = document.createElement('i');
      dot.className = `tl-dot cond-${row.condition}`;
      label.append(dot, document.createTextNode(row.label));
      labelNodes.push(label);

      const track = div(`tl-track site-${row.site} cond-${row.condition}`);
      track.setAttribute('role', 'img');
      track.setAttribute('aria-label', `${row.description}: ${row.intervals.length} interval${row.intervals.length === 1 ? '' : 's'}, ${row.summary} of the period`);
      for (const interval of row.intervals) {
        const bar = div('tl-bar');
        const left = Math.max(0, percent(interval.startEt));
        const right = Math.min(100, percent(interval.endEt));
        bar.style.left = `${left}%`;
        bar.style.width = `${Math.max(0, right - left)}%`;
        bar.dataset['tip'] = data.describe(row, interval);
        track.append(bar);
      }
      trackNodes.push(track);
      summaryNodes.push(div(`tl-summary site-${row.site}`, row.summary));
    }

    const axis = div('tl-axis');
    for (const tick of data.ticks) {
      const mark = div(tick.major ? 'tl-tick major' : 'tl-tick');
      mark.style.left = `${percent(tick.et)}%`;
      if (tick.label) mark.append(div('tl-tick-label', tick.label));
      axis.append(mark);
    }

    this.labels.replaceChildren(...labelNodes, div('tl-label tl-axis-label', 'UTC'));
    this.tracks.replaceChildren(...trackNodes, axis, this.cursor);
    this.summaries.replaceChildren(...summaryNodes, div('tl-summary'));
  }

  /** Move the shared current-time marker; hidden when outside the period. */
  setCursor(et: number | null): void {
    if (!this.period || et === null || et < this.period.startEt || et > this.period.endEt) {
      this.cursor.hidden = true;
      return;
    }
    this.cursor.hidden = false;
    this.cursor.style.left = `${((et - this.period.startEt) / (this.period.endEt - this.period.startEt)) * 100}%`;
  }

  private seek(clientX: number): void {
    if (!this.period) return;
    const rect = this.tracks.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    this.onSeek(this.period.startEt + fraction * (this.period.endEt - this.period.startEt));
  }

  private showTooltip(event: PointerEvent): void {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const tip = target?.dataset['tip'];
    if (!tip) {
      this.tooltip.hidden = true;
      return;
    }
    this.tooltip.textContent = tip;
    this.tooltip.hidden = false;
    const hostRect = this.host.getBoundingClientRect();
    const width = this.tooltip.offsetWidth;
    const x = Math.min(hostRect.width - width - 4, Math.max(4, event.clientX - hostRect.left - width / 2));
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${event.clientY - hostRect.top - this.tooltip.offsetHeight - 12}px`;
  }
}
