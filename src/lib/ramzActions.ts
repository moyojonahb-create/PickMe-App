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
import { adminSendLowBalanceReminders } from '@/lib/walletApi';
import {
  adminAutoResolveNoiseFraudFlags,
  adminCancelStuckRides,
  adminCleanupOldMessages,
  adminExpireOldRides,
  adminForceFatigueBreak,
  adminForceOfflineGhostDrivers,
  adminPurgeStaleLiveLocations,
} from '@/lib/businessApi';

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
      await adminExpireOldRides();
      return 'Stale rides expired.';
    },
  },

  'fraud-flags': {
    label: 'Auto-resolve noise flags',
    run: async () => {
      await adminAutoResolveNoiseFraudFlags();
      return 'Sensor-jitter fraud flags resolved.';
    },
  },

  'message-cleanup': {
    label: 'Clean old messages',
    confirm: 'Delete chat messages older than 7 days?',
    run: async () => {
      await adminCleanupOldMessages();
      return 'Old messages cleaned up.';
    },
  },

  'stale-driver-locations': {
    label: 'Force offline ghost drivers',
    confirm: 'Mark every "online" driver with no GPS in 5+ min as offline?',
    run: async () => {
      const cutoff = subHours(new Date(), 5 / 60).toISOString();
      const result = await adminForceOfflineGhostDrivers(cutoff);
      const updated = Number(result.updated ?? 0);
      return updated > 0
        ? `${updated} ghost driver${updated > 1 ? 's' : ''} forced offline.`
        : 'No ghost drivers found.';
    },
  },

  'stuck-accepted-rides': {
    label: 'Force-cancel stuck rides',
    confirm: 'Cancel every ride stuck in "accepted" for 1+ hour? Drivers and riders will be notified.',
    run: async () => {
      const cutoff = subHours(new Date(), 1).toISOString();
      const result = await adminCancelStuckRides(cutoff);
      const updated = Number(result.updated ?? 0);
      return updated > 0
        ? `${updated} stuck ride${updated > 1 ? 's' : ''} cancelled.`
        : 'No stuck rides to cancel.';
    },
  },

  'low-balance-drivers': {
    label: 'Send top-up reminder',
    run: async () => {
      const result = await adminSendLowBalanceReminders();
      if (!result.ok) throw new Error(result.reason || 'Failed to send reminders.');
      const count = Number(result.count ?? result.sent ?? 0);
      return count > 0
        ? `Reminder sent to ${count} driver${count > 1 ? 's' : ''}.`
        : 'No low-balance drivers.';
    },
  },

  'fatigue-overrun': {
    label: 'Force fatigue break',
    confirm: 'Force every driver online >12h to take a mandatory break?',
    run: async () => {
      const cutoff = subHours(new Date(), 12).toISOString();
      const result = await adminForceFatigueBreak(cutoff);
      const updated = Number(result.updated ?? 0);
      return updated > 0
        ? `${updated} fatigued driver${updated > 1 ? 's' : ''} sent on a 6h break.`
        : 'No drivers exceeding 12h.';
    },
  },

  'stale-live-locations': {
    label: 'Purge stale GPS rows',
    confirm: 'Delete live_locations rows older than 1 hour? Drivers repopulate on next ping.',
    run: async () => {
      const cutoff = subHours(new Date(), 1).toISOString();
      const result = await adminPurgeStaleLiveLocations(cutoff);
      const deleted = Number(result.deleted ?? 0);
      return `${deleted} stale GPS row${deleted === 1 ? '' : 's'} purged.`;
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
