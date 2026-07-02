/**
 * Ramz One — Live Load Pulse + Capacity Forecast.
 *
 * Surfaces the metrics that actually break PickMe at scale:
 *  - Concurrent active rides (proxy for realtime channel pressure)
 *  - Ride requests / minute (last 10m)
 *  - New user signups / hour
 *  - Errors logged in the last hour
 *  - live_locations row count (the table that grows fastest)
 *  - Capacity forecast: estimated headroom before the current Cloud
 *    instance starts to feel slow at ~100 concurrent users.
 *
 * Pure client component — uses existing Supabase tables, no new edge fn.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Activity, Users, AlertTriangle, MapPin, RefreshCw, Gauge, TrendingUp, Loader2,
} from 'lucide-react';
import { subHours, subMinutes } from 'date-fns';
import { toast } from 'sonner';
import { adminPurgeStaleLiveLocations } from '@/lib/businessApi';

interface Pulse {
  activeRides: number;
  pendingRides: number;
  ridesPerMin: number;
  newUsersHour: number;
  errorsHour: number;
  liveLocationsTotal: number;
  staleLiveLocations: number;
  fraudFlagsHour: number;
}

const TARGET_CONCURRENT_USERS = 100;

export default function LoadPulsePanel() {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(false);
  const [purging, setPurging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const tenMinAgo = subMinutes(now, 10).toISOString();
      const oneHourAgo = subHours(now, 1).toISOString();

      const [active, pending, recent, users, errors, locsTotal, locsStale, fraud] = await Promise.all([
        supabase.from('rides').select('id', { count: 'exact', head: true })
          .in('status', ['accepted', 'in_progress', 'arrived']).limit(1),
        supabase.from('rides').select('id', { count: 'exact', head: true })
          .eq('status', 'pending').limit(1),
        supabase.from('rides').select('id', { count: 'exact', head: true })
          .gte('created_at', tenMinAgo).limit(1),
        supabase.from('profiles').select('user_id', { count: 'exact', head: true })
          .gte('created_at', oneHourAgo).limit(1),
        supabase.from('system_error_logs').select('id', { count: 'exact', head: true })
          .gte('created_at', oneHourAgo).limit(1),
        supabase.from('live_locations').select('user_id', { count: 'exact', head: true }).limit(1),
        supabase.from('live_locations').select('user_id', { count: 'exact', head: true })
          .lt('updated_at', oneHourAgo).limit(1),
        supabase.from('fraud_flags').select('id', { count: 'exact', head: true })
          .eq('resolved', false).gte('created_at', oneHourAgo).limit(1),
      ]);

      setPulse({
        activeRides: active.count ?? 0,
        pendingRides: pending.count ?? 0,
        ridesPerMin: Math.round(((recent.count ?? 0) / 10) * 10) / 10,
        newUsersHour: users.count ?? 0,
        errorsHour: errors.count ?? 0,
        liveLocationsTotal: locsTotal.count ?? 0,
        staleLiveLocations: locsStale.count ?? 0,
        fraudFlagsHour: fraud.count ?? 0,
      });
    } catch (e) {
      console.error('LoadPulse failed', e);
      toast.error('Could not load pulse metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const purgeStale = useCallback(async () => {
    if (!confirm('Delete live_locations rows older than 1 hour? Drivers will repopulate on next ping.')) return;
    setPurging(true);
    try {
      const cutoff = subHours(new Date(), 1).toISOString();
      await adminPurgeStaleLiveLocations(cutoff);
      toast.success('Stale live_locations purged.');
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Purge failed — check admin RLS on live_locations.');
    } finally {
      setPurging(false);
    }
  }, [load]);

  // Capacity forecast: each active ride ≈ 4 realtime channel listeners
  // (rider + driver + admin map + dispatch). Small Cloud instances
  // comfortably hold ~400 concurrent channels, then latency rises.
  const concurrent = pulse ? pulse.activeRides + pulse.pendingRides : 0;
  const headroomPct = Math.max(0, Math.round(100 - (concurrent / TARGET_CONCURRENT_USERS) * 100));
  const status: 'healthy' | 'warn' | 'critical' =
    headroomPct > 50 ? 'healthy' : headroomPct > 20 ? 'warn' : 'critical';

  const statusColor = {
    healthy: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
    warn: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
    critical: 'bg-red-500/10 text-red-700 border-red-500/30',
  }[status];

  return (
    <Card className="border-2">
      <CardContent className="p-5 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-lg">Live Load Pulse</h3>
            <Badge variant="outline" className="text-xs">refreshes 30s</Badge>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {pulse && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Metric icon={Activity} label="Active rides" value={pulse.activeRides} hint="accepted/in-progress/arrived" />
              <Metric icon={Gauge} label="Pending" value={pulse.pendingRides} hint="awaiting driver" />
              <Metric icon={TrendingUp} label="Rides/min" value={pulse.ridesPerMin} hint="last 10 min avg" />
              <Metric icon={Users} label="New users / hr" value={pulse.newUsersHour} />
              <Metric icon={AlertTriangle} label="Errors / hr" value={pulse.errorsHour}
                tone={pulse.errorsHour > 20 ? 'bad' : pulse.errorsHour > 5 ? 'warn' : 'ok'} />
              <Metric icon={AlertTriangle} label="Open fraud flags / hr" value={pulse.fraudFlagsHour}
                tone={pulse.fraudFlagsHour > 10 ? 'bad' : 'ok'} />
              <Metric icon={MapPin} label="live_locations total" value={pulse.liveLocationsTotal} />
              <Metric icon={MapPin} label="Stale (>1h)" value={pulse.staleLiveLocations}
                tone={pulse.staleLiveLocations > 500 ? 'bad' : pulse.staleLiveLocations > 100 ? 'warn' : 'ok'} />
            </div>

            <div className={`rounded-xl border-2 p-4 space-y-3 ${statusColor}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide font-semibold opacity-80">
                    Capacity forecast
                  </div>
                  <div className="text-2xl font-bold mt-1">
                    {concurrent} / {TARGET_CONCURRENT_USERS} concurrent
                  </div>
                  <div className="text-sm mt-0.5">
                    {headroomPct}% headroom before the {TARGET_CONCURRENT_USERS}-user target
                  </div>
                </div>
                <Badge variant="outline" className="capitalize">{status}</Badge>
              </div>

              <div className="h-2 rounded-full bg-background/60 overflow-hidden">
                <div
                  className="h-full bg-current opacity-60 transition-all"
                  style={{ width: `${100 - headroomPct}%` }}
                />
              </div>

              {status !== 'healthy' && (
                <div className="text-sm space-y-1.5">
                  <p className="font-medium">Recommended actions:</p>
                  <ul className="list-disc list-inside space-y-0.5 opacity-90">
                    {pulse.staleLiveLocations > 100 && (
                      <li>Purge {pulse.staleLiveLocations} stale live_locations rows below.</li>
                    )}
                    {pulse.errorsHour > 20 && <li>Investigate the error spike in the incidents feed.</li>}
                    {status === 'critical' && (
                      <li>
                        Upgrade Lovable Cloud instance: <span className="font-medium">Cloud → Advanced settings → Upgrade instance</span>.
                      </li>
                    )}
                    <li>Verify Realtime channels are torn down on unmount (see Code Scan).</li>
                  </ul>
                </div>
              )}
            </div>

            {pulse.staleLiveLocations > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={purgeStale}
                disabled={purging}
                className="w-full"
              >
                {purging ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MapPin className="h-4 w-4 mr-2" />}
                Purge {pulse.staleLiveLocations} stale live_locations rows
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  icon: Icon, label, value, hint, tone = 'ok',
}: {
  icon: typeof Activity; label: string; value: number; hint?: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const toneCls = tone === 'bad'
    ? 'text-red-600'
    : tone === 'warn' ? 'text-amber-600' : 'text-foreground';
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${toneCls}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
