import type { FixRecord, RunMeta } from './fixLog';

/**
 * Turns a raw fix log into the numbers the runbook's pass/fail table asks for.
 *
 * The thresholds live here as constants so the verdict is computed the same way
 * every time, on every device — not eyeballed from a chart after the fact. They
 * match RUNBOOK.md and are fixed before any data exists.
 */

export const TARGET_INTERVAL_MS = 15_000;
export const PASS_RATE = 0.95;
export const INVESTIGATE_RATE = 0.85;
export const PASS_MAX_GAP_MS = 90_000;
export const INVESTIGATE_MAX_GAP_MS = 300_000;
export const PASS_DRAIN_PER_HOUR = 10;
export const INVESTIGATE_DRAIN_PER_HOUR = 15;
export const PASS_DEGRADATION = 0.25;
export const INVESTIGATE_DEGRADATION = 0.5;

export type Verdict = 'pass' | 'investigate' | 'fail' | 'n/a';

export interface Analysis {
  fixCount: number;
  durationMs: number;
  expectedFixes: number;
  deliveryRate: number;
  maxGapMs: number;
  /** Every gap beyond the pass threshold, so a single hole is visible not averaged away. */
  notableGaps: Array<{ startedAt: number; gapMs: number }>;
  firstWindowRate: number;
  lastWindowRate: number;
  /** >0 means it got worse over the run. */
  degradation: number;
  batteryDrainPerHour: number | null;
  /** Fixes that landed while the app was not in the foreground — the S2 evidence. */
  backgroundFixCount: number;
  verdicts: {
    deliveryRate: Verdict;
    maxGap: Verdict;
    degradation: Verdict;
    battery: Verdict;
  };
  overall: Verdict;
}

function rate(fixes: FixRecord[], fromMs: number, toMs: number): number {
  const windowMs = toMs - fromMs;
  if (windowMs <= 0) return 0;
  const inWindow = fixes.filter((f) => f.t >= fromMs && f.t < toMs).length;
  const expected = windowMs / TARGET_INTERVAL_MS;
  return expected > 0 ? inWindow / expected : 0;
}

function worst(...verdicts: Verdict[]): Verdict {
  if (verdicts.includes('fail')) return 'fail';
  if (verdicts.includes('investigate')) return 'investigate';
  if (verdicts.every((v) => v === 'n/a')) return 'n/a';
  return 'pass';
}

export function analyze(fixes: FixRecord[], meta: RunMeta | null): Analysis {
  const sorted = [...fixes].sort((a, b) => a.t - b.t);
  const startedAt = meta?.startedAt ?? sorted[0]?.t ?? Date.now();
  const endedAt = sorted[sorted.length - 1]?.t ?? startedAt;
  const durationMs = Math.max(0, endedAt - startedAt);

  const expectedFixes = durationMs / TARGET_INTERVAL_MS;
  const deliveryRate = expectedFixes > 0 ? sorted.length / expectedFixes : 0;

  // Gaps are measured from run start, not from the first fix: a run that takes
  // four minutes to produce its first fix has a four-minute hole at the front,
  // and starting the clock at fix #1 would hide exactly that.
  const gaps: Array<{ startedAt: number; gapMs: number }> = [];
  let previous = startedAt;
  let maxGapMs = 0;
  for (const fix of sorted) {
    const gap = fix.t - previous;
    if (gap > maxGapMs) maxGapMs = gap;
    if (gap > PASS_MAX_GAP_MS) gaps.push({ startedAt: previous, gapMs: gap });
    previous = fix.t;
  }

  const windowMs = 10 * 60 * 1000;
  const longEnough = durationMs >= windowMs * 2;
  const firstWindowRate = longEnough ? rate(sorted, startedAt, startedAt + windowMs) : 0;
  const lastWindowRate = longEnough ? rate(sorted, endedAt - windowMs, endedAt) : 0;
  const degradation =
    longEnough && firstWindowRate > 0 ? (firstWindowRate - lastWindowRate) / firstWindowRate : 0;

  const endBattery = sorted.filter((f) => f.battery != null).pop()?.battery ?? null;
  const startBattery = meta?.startBattery ?? null;
  const hours = durationMs / 3_600_000;
  const batteryDrainPerHour =
    startBattery != null && endBattery != null && hours > 0.05
      ? ((startBattery - endBattery) * 100) / hours
      : null;

  const backgroundFixCount = sorted.filter((f) => f.appState !== 'active').length;

  const deliveryVerdict: Verdict =
    deliveryRate >= PASS_RATE ? 'pass' : deliveryRate >= INVESTIGATE_RATE ? 'investigate' : 'fail';
  const gapVerdict: Verdict =
    maxGapMs <= PASS_MAX_GAP_MS ? 'pass' : maxGapMs <= INVESTIGATE_MAX_GAP_MS ? 'investigate' : 'fail';
  const degradationVerdict: Verdict = !longEnough
    ? 'n/a'
    : degradation < PASS_DEGRADATION
      ? 'pass'
      : degradation < INVESTIGATE_DEGRADATION
        ? 'investigate'
        : 'fail';
  const batteryVerdict: Verdict =
    batteryDrainPerHour == null
      ? 'n/a'
      : batteryDrainPerHour <= PASS_DRAIN_PER_HOUR
        ? 'pass'
        : batteryDrainPerHour <= INVESTIGATE_DRAIN_PER_HOUR
          ? 'investigate'
          : 'fail';

  return {
    fixCount: sorted.length,
    durationMs,
    expectedFixes,
    deliveryRate,
    maxGapMs,
    notableGaps: gaps,
    firstWindowRate,
    lastWindowRate,
    degradation,
    batteryDrainPerHour,
    backgroundFixCount,
    verdicts: {
      deliveryRate: deliveryVerdict,
      maxGap: gapVerdict,
      degradation: degradationVerdict,
      battery: batteryVerdict,
    },
    overall: worst(deliveryVerdict, gapVerdict, degradationVerdict, batteryVerdict),
  };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
