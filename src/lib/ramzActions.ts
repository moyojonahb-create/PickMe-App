/**
 * Ramz One — One-click fix action registry.
 *
 * Maps a HealthCheck `id` to an executable remediation. Each action returns
 * a short success message; throwing an Error surfaces as a toast.
 *
 * Actions never call destructive SQL directly — they use existing RPCs
 * (expire_old_rides, cleanup_old_messages, auto_resolve_noise_fraud_flags)
 * or admin-RLS-gated table writes. Riskier actions set
 * `requiresConfirmation: true` so the UI double-prompts the admin.
 */
import { supabase } from '@/lib/supabaseClient';
import { subDays, subHours } from 'date-fns';

export interface RamzAction {
  /** Button label shown to admin */
  label: string;
  /** Optional second-step confirmation copy */
  confirm?: string;
  /** Returns a toast-friendly success message */
  run: () => Promise<string>;
  /** Optional route for "View" actions (no DB write). */
  navigateTo?: string;
}

export const RAMZ_ACTIONS: Record<string, RamzAction> = {
  'stale-rides': {
    label: 'Expire stale rides',
    confirm: 'Expire every pending ride older than 30 minutes?',
    run: async () => {
      const { error } = await supabase.rpc('expire_old_rides' as never);
      if (error) throw error;
      return 'Stale rides expired.';
    },
  },

  'fraud-flags': {
    label: 'Auto-resolve noise flags',
    run: async () => {
      const { error } = await supabase.rpc('auto_resolve_noise_fraud_flags' as never);
      if (error) throw error;
      return 'Sensor-jitter fraud flags resolved.';
    },
  },

  'message-cleanup': {
    label: 'Clean old messages',
    confirm: 'Delete chat messages older than 7 days?',
    run: async () => {
      const { error } = await supabase.rpc('cleanup_old_messages' as never);
      if (error) throw error;
      return 'Old messages cleaned up.';
    },
  },

  'stale-driver-locations': {
    label: 'Force offline ghost drivers',
    confirm: 'Mark every "online" driver with no GPS in 5+ min as offline?',
    run: async () => {
      const cutoff = subHours(new Date(), 5 / 60).toISOString();
      const { data: online } = await supabase
        .from('drivers')
        .select('id, user_id')
        .eq('status', 'approved')
        .eq('is_online', true);
      if (!online?.length) return 'No online drivers to check.';

      const { data: locs } = await supabase
        .from('live_locations')
        .select('user_id, updated_at')
        .in('user_id', online.map(d => d.user_id));

      const stale = online.filter(d => {
        const loc = locs?.find(l => l.user_id === d.user_id);
        return !loc || new Date(loc.updated_at) < new Date(cutoff);
      });
      if (!stale.length) return 'No ghost drivers found.';

      const { error } = await supabase
        .from('drivers')
        .update({ is_online: false } as never)
        .in('id', stale.map(d => d.id));
      if (error) throw error;
      return `${stale.length} ghost driver${stale.length > 1 ? 's' : ''} forced offline.`;
    },
  },

  'stuck-accepted-rides': {
    label: 'Force-cancel stuck rides',
    confirm: 'Cancel every ride stuck in "accepted" for 1+ hour? Drivers and riders will be notified.',
    run: async () => {
      const cutoff = subHours(new Date(), 1).toISOString();
      const { data: stuck } = await supabase
        .from('rides')
        .select('id, user_id')
        .eq('status', 'accepted')
        .lt('updated_at', cutoff);
      if (!stuck?.length) return 'No stuck rides to cancel.';

      const ids = stuck.map(r => r.id);
      const { error } = await supabase
        .from('rides')
        .update({ status: 'cancelled' } as never)
        .in('id', ids);
      if (error) throw error;

      // Notify riders
      const notifs = stuck.map(r => ({
        user_id: r.user_id,
        title: 'Ride cancelled',
        body: 'Your driver did not start the trip. We have cancelled the ride and you will not be charged.',
        notification_type: 'ride_update',
      }));
      await supabase.from('notifications').insert(notifs);

      return `${ids.length} stuck ride${ids.length > 1 ? 's' : ''} cancelled.`;
    },
  },

  'low-balance-drivers': {
    label: 'Send top-up reminder',
    run: async () => {
      const { data: lowDrivers } = await supabase
        .from('driver_wallets')
        .select('driver_id')
        .lt('balance_usd', 0.5);
      if (!lowDrivers?.length) return 'No low-balance drivers.';

      const notifs = lowDrivers.map(d => ({
        user_id: d.driver_id,
        title: 'Top up your wallet',
        body: 'Your wallet balance is below $0.50. Top up via EcoCash to keep accepting rides.',
        notification_type: 'wallet_low',
      }));
      const { error } = await supabase.from('notifications').insert(notifs);
      if (error) throw error;
      return `Reminder sent to ${notifs.length} driver${notifs.length > 1 ? 's' : ''}.`;
    },
  },

  'fatigue-overrun': {
    label: 'Force fatigue break',
    confirm: 'Force every driver online >12h to take a mandatory break?',
    run: async () => {
      const cutoff = subHours(new Date(), 12).toISOString();
      const { data: long } = await supabase
        .from('driver_sessions')
        .select('driver_id')
        .is('went_offline_at', null)
        .lt('went_online_at', cutoff);
      if (!long?.length) return 'No drivers exceeding 12h.';

      const ids = Array.from(new Set(long.map(s => s.driver_id)));
      const { error } = await supabase
        .from('drivers')
        .update({ is_online: false } as never)
        .in('id', ids);
      if (error) throw error;

      await supabase.from('driver_sessions')
        .update({
          went_offline_at: new Date().toISOString(),
          forced_break_until: new Date(Date.now() + 6 * 3600_000).toISOString(),
        } as never)
        .is('went_offline_at', null)
        .lt('went_online_at', cutoff);

      return `${ids.length} fatigued driver${ids.length > 1 ? 's' : ''} sent on a 6h break.`;
    },
  },

  'stale-live-locations': {
    label: 'Purge stale GPS rows',
    confirm: 'Delete live_locations rows older than 1 hour? Drivers repopulate on next ping.',
    run: async () => {
      const cutoff = subHours(new Date(), 1).toISOString();
      const { error, count } = await supabase
        .from('live_locations')
        .delete({ count: 'exact' })
        .lt('updated_at', cutoff);
      if (error) throw error;
      return `${count ?? 0} stale GPS row${count === 1 ? '' : 's'} purged.`;
    },
  },

  // Navigation-only fixes (no destructive write)
  'unresolved-sos': { label: 'Open SOS queue', navigateTo: '/admin', run: async () => '' },
  'old-disputes': { label: 'Open disputes', navigateTo: '/admin/disputes', run: async () => '' },
  'pending-drivers': { label: 'Review drivers', navigateTo: '/admin/drivers', run: async () => '' },
  'pending-deposits': { label: 'Review deposits', navigateTo: '/admin/deposits', run: async () => '' },
  'rider-pending-deposits': { label: 'Review rider deposits', navigateTo: '/admin/rider-deposits', run: async () => '' },
  'pending-documents': { label: 'Review documents', navigateTo: '/admin/drivers', run: async () => '' },
  'map-route-failures': { label: 'Open Maps diagnostics', navigateTo: '/admin/system-health', run: async () => '' },
};

export function getRamzAction(findingId: string): RamzAction | undefined {
  return RAMZ_ACTIONS[findingId];
}

/** Lightweight helper for the new "OTP failure rate" check. */
export async function countRecentOtpFailures(): Promise<number> {
  const since = subDays(new Date(), 1).toISOString();
  const { count } = await supabase
    .from('phone_verifications')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
    .eq('verified', false)
    .gte('attempts', 3);
  return count ?? 0;
}

/** New scan: drivers exceeding the 12h fatigue limit. */
export async function countFatiguedDrivers(): Promise<number> {
  const cutoff = subHours(new Date(), 12).toISOString();
  const { count } = await supabase
    .from('driver_sessions')
    .select('driver_id', { count: 'exact', head: true })
    .is('went_offline_at', null)
    .lt('went_online_at', cutoff);
  return count ?? 0;
}

/** New scan: average admin response time on resolved SOS in last 7 days (minutes). */
export async function avgSosResponseMinutes(): Promise<number | null> {
  const since = subDays(new Date(), 7).toISOString();
  const { data } = await supabase
    .from('emergency_alerts')
    .select('created_at, resolved_at')
    .eq('resolved', true)
    .gte('created_at', since)
    .not('resolved_at', 'is', null)
    .limit(200);
  if (!data?.length) return null;
  const total = data.reduce((sum, a: { created_at: string; resolved_at: string | null }) => {
    if (!a.resolved_at) return sum;
    return sum + (new Date(a.resolved_at).getTime() - new Date(a.created_at).getTime()) / 60_000;
  }, 0);
  return Math.round(total / data.length);
}
