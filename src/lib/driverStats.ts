import { supabase } from '@/lib/supabaseClient';

// Matches the real rate the backend applies at settlement — see
// backend/V2_ACTIVE_CASH_SETTLEMENT_IMPLEMENTATION_REPORT.md and
// TripCollectSheet.tsx's own fallback. The Go backend's wallet-summary
// endpoints (public.wallet_accounts / settlement_records) don't have real
// tables behind them yet — see the pre-launch audit fixes — so this reads
// completed rides directly, the one thing that IS real, rather than a
// number from an endpoint that always fails.
const COMMISSION_RATE = 0.15;

export interface DriverWeekStats {
  /** Estimated net take (fares minus the standard commission) for
   * completed rides in the last 7 days. Estimated, not the settled figure —
   * labelled as such wherever it's shown. */
  weekEarnings: number;
  /** Completed / (completed + cancelled), over the driver's whole history.
   * Null when there's no history yet to compute a rate from. */
  completionRate: number | null;
  /** Whole months since the driver's account was created. */
  monthsOnPickMe: number;
}

export async function fetchDriverWeekStats(driverRowId: string, driverCreatedAt?: string | null): Promise<DriverWeekStats> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [weekRes, historyRes] = await Promise.all([
    supabase
      .from('rides')
      .select('fare')
      .eq('driver_id', driverRowId)
      .eq('status', 'completed')
      .gte('updated_at', weekAgo),
    supabase
      .from('rides')
      .select('status')
      .eq('driver_id', driverRowId)
      .in('status', ['completed', 'cancelled']),
  ]);

  const weekFares = (weekRes.data ?? []).reduce((sum, r) => sum + Number(r.fare ?? 0), 0);
  const weekEarnings = Math.round(weekFares * (1 - COMMISSION_RATE) * 100) / 100;

  const history = historyRes.data ?? [];
  const completed = history.filter((r) => r.status === 'completed').length;
  const completionRate = history.length > 0 ? Math.round((completed / history.length) * 100) : null;

  let monthsOnPickMe = 0;
  if (driverCreatedAt) {
    const created = new Date(driverCreatedAt);
    const now = new Date();
    monthsOnPickMe = Math.max(0, (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth()));
  }

  return { weekEarnings, completionRate, monthsOnPickMe };
}

export interface RiderTrustSignals {
  /** Real count of this rider's completed rides. */
  tripsWithPickMe: number;
  /** Average of driver_id-submitted ride_passenger_ratings for this rider,
   * or null when nobody has rated them yet (shown as "New rider" rather
   * than a fabricated number). */
  averageRating: number | null;
}

/** riderUserId is rides.user_id — the rider's auth user id. */
export async function fetchRiderTrustSignals(riderUserId: string): Promise<RiderTrustSignals> {
  const [tripsRes, ratingsRes] = await Promise.all([
    supabase.from('rides').select('id', { count: 'exact', head: true }).eq('user_id', riderUserId).eq('status', 'completed'),
    // Joined through rides (rather than filtering the embed on the rides
    // query directly, which PostgREST doesn't support) to get every rating
    // a driver has left for this rider across their ride history.
    supabase.from('ride_passenger_ratings').select('rating, rides!inner(user_id)').eq('rides.user_id', riderUserId),
  ]);

  const tripsWithPickMe = tripsRes.count ?? 0;
  const ratings = (ratingsRes.data ?? []).map((r) => Number(r.rating));
  const averageRating = ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;

  return { tripsWithPickMe, averageRating };
}
