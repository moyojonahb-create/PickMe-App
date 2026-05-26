/**
 * Live operational signals for /admin/system-health.
 *
 * Every helper is self-contained, resilient (returns nulls on error rather
 * than throwing), and uses explicit column lists per project rules.
 */
import { supabase } from '@/integrations/supabase/client';

export type SignalSeverity = 'ok' | 'warn' | 'critical';

export interface SignalMetric {
  label: string;
  value: number | string;
  severity: SignalSeverity;
  hint?: string;
}

export interface SignalCard {
  id: string;
  title: string;
  severity: SignalSeverity;
  headline: SignalMetric;
  metrics: SignalMetric[];
  /** Optional samples of offending rows the admin can drill into. */
  samples?: Array<Record<string, unknown>>;
  error?: string;
}

const nowMs = () => Date.now();
const minutesAgoISO = (m: number) => new Date(nowMs() - m * 60_000).toISOString();
const hoursAgoISO = (h: number) => new Date(nowMs() - h * 3_600_000).toISOString();

/**
 * Run a head-count query and never throw. Returns null on error.
 * The builder argument is `any` because each table has a different generic type
 * and we want a single helper for all of them.
 */
async function runCount(builder: any): Promise<number | null> {
  try {
    const { count, error } = await builder;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

const head = (table: string) =>
  (supabase.from(table as any) as any).select('id', { count: 'exact', head: true });

const sevFromCount = (n: number | null, warn: number, crit: number): SignalSeverity => {
  if (n == null) return 'warn';
  if (n >= crit) return 'critical';
  if (n >= warn) return 'warn';
  return 'ok';
};

const worstSeverity = (sevs: SignalSeverity[]): SignalSeverity => {
  if (sevs.includes('critical')) return 'critical';
  if (sevs.includes('warn')) return 'warn';
  return 'ok';
};

// ============================================================
// 1. Ride pipeline
// ============================================================
export async function getRidePipelineSignal(): Promise<SignalCard> {
  const fifteenAgo = minutesAgoISO(15);
  const fiveAgo = minutesAgoISO(5);
  const oneHourAgo = hoursAgoISO(1);

  const [pending, stuckAccepted, stuckInProgress, completedLastHour] = await Promise.all([
    safeCount('rides', (q) => q.eq('status', 'pending')),
    safeCount('rides', (q) => q.eq('status', 'accepted').lt('updated_at', fifteenAgo)),
    safeCount('rides', (q) => q.eq('status', 'in_progress').lt('updated_at', fiveAgo)),
    safeCount('rides', (q) => q.eq('status', 'completed').gt('updated_at', oneHourAgo)),
  ]);

  const metrics: SignalMetric[] = [
    { label: 'Pending', value: pending ?? '—', severity: sevFromCount(pending, 10, 30) },
    { label: 'Stale accepted (>15m)', value: stuckAccepted ?? '—', severity: sevFromCount(stuckAccepted, 1, 5) },
    { label: 'No GPS while in trip', value: stuckInProgress ?? '—', severity: sevFromCount(stuckInProgress, 1, 3) },
    { label: 'Completed last 1h', value: completedLastHour ?? '—', severity: 'ok' },
  ];

  return {
    id: 'ride-pipeline',
    title: 'Ride Pipeline',
    severity: worstSeverity(metrics.map((m) => m.severity)),
    headline: { label: 'Active rides', value: (pending ?? 0) + (stuckAccepted ?? 0) + (stuckInProgress ?? 0), severity: 'ok' },
    metrics,
  };
}

// ============================================================
// 2. Wallet integrity
// ============================================================
export async function getWalletIntegritySignal(): Promise<SignalCard> {
  const oneDay = hoursAgoISO(24);

  const [locked, paymentFailed, depositsPending, riderDepositsPending] = await Promise.all([
    safeCount('wallets', (q) => q.eq('is_locked', true)),
    safeCount('rides', (q) => q.eq('payment_failed', true).gt('created_at', oneDay)),
    safeCount('deposit_requests', (q) => q.eq('status', 'pending')),
    safeCount('rider_deposit_requests', (q) => q.eq('status', 'pending')),
  ]);

  const metrics: SignalMetric[] = [
    { label: 'Locked wallets', value: locked ?? '—', severity: sevFromCount(locked, 1, 5) },
    { label: 'Payment failed (24h)', value: paymentFailed ?? '—', severity: sevFromCount(paymentFailed, 1, 5) },
    { label: 'Driver deposits pending', value: depositsPending ?? '—', severity: sevFromCount(depositsPending, 5, 15) },
    { label: 'Rider deposits pending', value: riderDepositsPending ?? '—', severity: sevFromCount(riderDepositsPending, 5, 15) },
  ];

  return {
    id: 'wallet',
    title: 'Wallet Integrity',
    severity: worstSeverity(metrics.map((m) => m.severity)),
    headline: { label: 'Needs review', value: (locked ?? 0) + (paymentFailed ?? 0), severity: 'ok' },
    metrics,
  };
}

// ============================================================
// 3. Driver fleet
// ============================================================
export async function getDriverFleetSignal(): Promise<SignalCard> {
  const [online, approved, pendingApproval] = await Promise.all([
    safeCount('drivers', (q) => q.eq('is_online', true).eq('status', 'approved')),
    safeCount('drivers', (q) => q.eq('status', 'approved')),
    safeCount('drivers', (q) => q.eq('status', 'pending')),
  ]);

  // On-trip = approved drivers with an active ride.
  const onTrip = await safeCount('rides', (q) =>
    q.in('status', ['accepted', 'in_progress', 'arrived']),
  );

  const metrics: SignalMetric[] = [
    { label: 'Online drivers', value: online ?? '—', severity: 'ok' },
    { label: 'On a trip', value: onTrip ?? '—', severity: 'ok' },
    { label: 'Total approved', value: approved ?? '—', severity: 'ok' },
    {
      label: 'Awaiting approval',
      value: pendingApproval ?? '—',
      severity: sevFromCount(pendingApproval, 5, 20),
    },
  ];

  return {
    id: 'fleet',
    title: 'Driver Fleet',
    severity: worstSeverity(metrics.map((m) => m.severity)),
    headline: { label: 'Online now', value: online ?? '—', severity: (online ?? 0) > 0 ? 'ok' : 'warn' },
    metrics,
  };
}

// ============================================================
// 4. Realtime / GPS health
// ============================================================
export async function getRealtimeSignal(): Promise<SignalCard> {
  const sixtySecondsAgo = new Date(nowMs() - 60_000).toISOString();
  const fiveMinAgo = minutesAgoISO(5);

  const [freshPings, stalePings] = await Promise.all([
    safeCount('live_locations', (q) => q.gt('updated_at', sixtySecondsAgo)),
    safeCount('live_locations', (q) => q.lt('updated_at', fiveMinAgo)),
  ]);

  // Drivers in active trips without a recent ping.
  const inTripNoPing = await safeCount('rides', (q) =>
    q.in('status', ['accepted', 'in_progress']).lt('updated_at', fiveMinAgo),
  );

  const metrics: SignalMetric[] = [
    { label: 'GPS pings <60s', value: freshPings ?? '—', severity: 'ok' },
    { label: 'Stale pings (>5m)', value: stalePings ?? '—', severity: sevFromCount(stalePings, 5, 20) },
    {
      label: 'In-trip drivers w/o recent ping',
      value: inTripNoPing ?? '—',
      severity: sevFromCount(inTripNoPing, 1, 3),
    },
  ];

  return {
    id: 'realtime',
    title: 'Realtime / GPS',
    severity: worstSeverity(metrics.map((m) => m.severity)),
    headline: { label: 'Fresh GPS', value: freshPings ?? '—', severity: (freshPings ?? 0) > 0 ? 'ok' : 'warn' },
    metrics,
  };
}

// ============================================================
// 5. Auth & security
// ============================================================
export async function getSecuritySignal(): Promise<SignalCard> {
  const oneDay = hoursAgoISO(24);

  const [unresolvedFlags, criticalFlags, sosLast24h] = await Promise.all([
    safeCount('fraud_flags', (q) => q.eq('resolved', false)),
    safeCount('fraud_flags', (q) => q.eq('resolved', false).eq('severity', 'critical')),
    safeCount('fraud_flags', (q) =>
      q.eq('flag_type', 'sos_alert').gt('created_at', oneDay),
    ),
  ]);

  const metrics: SignalMetric[] = [
    { label: 'Open fraud flags', value: unresolvedFlags ?? '—', severity: sevFromCount(unresolvedFlags, 5, 15) },
    { label: 'Critical flags', value: criticalFlags ?? '—', severity: sevFromCount(criticalFlags, 1, 3) },
    { label: 'SOS alerts (24h)', value: sosLast24h ?? '—', severity: sevFromCount(sosLast24h, 1, 3) },
  ];

  return {
    id: 'security',
    title: 'Auth & Security',
    severity: worstSeverity(metrics.map((m) => m.severity)),
    headline: { label: 'Open issues', value: unresolvedFlags ?? '—', severity: sevFromCount(unresolvedFlags, 5, 15) },
    metrics,
  };
}

// ============================================================
// 6. Disputes & support
// ============================================================
export async function getSupportSignal(): Promise<SignalCard> {
  const oneDay = hoursAgoISO(24);

  const [openDisputes, recentDisputes, oldDisputes] = await Promise.all([
    safeCount('disputes', (q) => q.in('status', ['open', 'in_review'])),
    safeCount('disputes', (q) => q.gt('created_at', oneDay)),
    safeCount('disputes', (q) =>
      q.in('status', ['open', 'in_review']).lt('created_at', hoursAgoISO(48)),
    ),
  ]);

  const metrics: SignalMetric[] = [
    { label: 'Open disputes', value: openDisputes ?? '—', severity: sevFromCount(openDisputes, 3, 10) },
    { label: 'Filed (24h)', value: recentDisputes ?? '—', severity: 'ok' },
    { label: 'Stale (>48h)', value: oldDisputes ?? '—', severity: sevFromCount(oldDisputes, 1, 5) },
  ];

  return {
    id: 'support',
    title: 'Disputes & Support',
    severity: worstSeverity(metrics.map((m) => m.severity)),
    headline: { label: 'Open tickets', value: openDisputes ?? '—', severity: sevFromCount(openDisputes, 3, 10) },
    metrics,
  };
}

// ============================================================
// Aggregate
// ============================================================
export async function loadAllSignals(): Promise<SignalCard[]> {
  return Promise.all([
    getRidePipelineSignal(),
    getWalletIntegritySignal(),
    getDriverFleetSignal(),
    getRealtimeSignal(),
    getSecuritySignal(),
    getSupportSignal(),
  ]);
}

/** Health score 0–100: 100 minus weighted severity sum. */
export function computeHealthScore(cards: SignalCard[]): number {
  let penalty = 0;
  for (const c of cards) {
    if (c.severity === 'critical') penalty += 20;
    else if (c.severity === 'warn') penalty += 8;
  }
  return Math.max(0, 100 - penalty);
}
