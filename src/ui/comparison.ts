import type { Condition, SiteAnalysis } from '../contracts.ts';
import { formatDuration, formatPercent } from './format.ts';

export const CONDITIONS = ['sun', 'earth', 'both'] as const satisfies readonly Condition[];

export const CONDITION_LABEL: Record<Condition, string> = {
  sun: 'Sun up',
  earth: 'Earth up',
  both: 'Sun + Earth up',
};

export const CONDITION_DESCRIPTION: Record<Condition, string> = {
  sun: 'Sun centre above the reference horizon',
  earth: 'Earth centre above the reference horizon',
  both: 'Sun and Earth centres above the reference horizon together',
};

const SUBJECT: Record<Condition, string> = {
  sun: 'Sun above horizon',
  earth: 'Earth above horizon',
  both: 'Sun and Earth above horizon together',
};

/** Differences below this many percentage points are reported as "about the same". */
export const SAME_THRESHOLD_POINTS = 0.5;

export interface ConditionVerdict {
  condition: Condition;
  /** 'A' or 'B' when one site has the larger fraction, 'same' otherwise. */
  leader: 'A' | 'B' | 'same';
  differencePoints: number;
  differenceSeconds: number;
  sentence: string;
}

/**
 * Plain-English comparison derived ONLY from the two SiteAnalysis summaries
 * (the same numbers the bars and cards show). Geometry only — no ranking of
 * landing safety, power or communications.
 */
export function compareCondition(condition: Condition, a: SiteAnalysis, b: SiteAnalysis): ConditionVerdict {
  const sa = a[condition];
  const sb = b[condition];
  const differencePoints = (sa.fraction - sb.fraction) * 100;
  const differenceSeconds = sa.totalSeconds - sb.totalSeconds;
  const subject = SUBJECT[condition];
  let leader: ConditionVerdict['leader'] = 'same';
  let sentence: string;
  if (sa.totalSeconds === 0 && sb.totalSeconds === 0) {
    sentence = `${subject}: never during this period at either site.`;
  } else if (Math.abs(differencePoints) < SAME_THRESHOLD_POINTS) {
    sentence = `${subject}: about the same share of the period at both sites (A ${formatPercent(sa.fraction)}, B ${formatPercent(sb.fraction)}).`;
  } else {
    leader = differencePoints > 0 ? 'A' : 'B';
    const other = leader === 'A' ? 'B' : 'A';
    const lead = leader === 'A' ? sa : sb;
    const trail = leader === 'A' ? sb : sa;
    sentence =
      `${subject}: Site ${leader} ${formatPercent(lead.fraction)} of the period, Site ${other} ${formatPercent(trail.fraction)} — ` +
      `Site ${leader} is ${Math.abs(differencePoints).toFixed(1)} points higher (${formatDuration(Math.abs(differenceSeconds))} more).`;
  }
  return { condition, leader, differencePoints, differenceSeconds, sentence };
}

export function buildConclusion(a: SiteAnalysis, b: SiteAnalysis): ConditionVerdict[] {
  return CONDITIONS.map((condition) => compareCondition(condition, a, b));
}
