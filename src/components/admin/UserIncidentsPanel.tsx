/**
 * Ramz One — User Incidents Panel.
 *
 * Surfaces real, named user impact: "Tendai M. — 09:42 — payment failed
 * (insufficient wallet balance) — Suggested fix: …".
 *
 * Pulls from three sources:
 *   1. rides.payment_failed = true (auto-charge failures at trip end)
 *   2. fraud_flags (recent, unresolved)
 *   3. emergency_alerts (SOS triggered)
 *
 * Each row shows who, when, what broke, and a one-line suggested fix so
 * we can prevent recurrence in future.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { AlertTriangle, RefreshCw, Loader2, User, Clock, Lightbulb, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

interface Incident {
  id: string;
  source: 'payment' | 'fraud' | 'sos';
  severity: 'critical' | 'high' | 'medium' | 'low';
  userName: string;
  userPhone?: string;
  occurredAt: string;
  title: string;
  detail: string;
  suggestion: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-700 border-red-500/30',
  high: 'bg-orange-500/10 text-orange-700 border-orange-500/30',
  medium: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
  low: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
};

function suggestForFraud(flagType: string): string {
  switch (flagType) {
    case 'gps_spoofing':
      return 'Tighten GPS validation in src/lib/fraudDetection.ts; ignore deltas <2s apart and require >5km for spoof flag.';
    case 'rapid_requests':
      return 'Lower per-user ride request rate limit and surface a "slow down" toast in requestRide.ts.';
    case 'excessive_cancellations':
      return 'Add a 5-min cooldown after 3 consecutive cancellations and notify rider in UI.';
    case 'payment_failed':
      return 'Pre-authorise wallet at ride creation (request_wallet_ride RPC) so we never accept a ride we can\'t bill.';
    case 'admin_manual_flag':
      return 'Review admin notes and decide whether to suspend or clear the user.';
    default:
      return 'Add a Code Scan rule and document the trigger in security memory so future agents know how to act.';
  }
}

export default function UserIncidentsPanel() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Payment failures (rides flagged payment_failed in last 24h)
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data: failedRides } = await supabase
        .from('rides')
        .select('id, user_id, fare, payment_failure_reason, updated_at, pickup_address, dropoff_address')
        .eq('payment_failed', true)
        .gte('updated_at', since)
        .order('updated_at', { ascending: false })
        .limit(30);

      // 2. Fraud flags (unresolved last 24h)
      const { data: flags } = await supabase
        .from('fraud_flags')
        .select('id, user_id, flag_type, severity, details, created_at')
        .eq('resolved', false)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(30);

      // 3. Emergency SOS (last 24h)
      const { data: sos } = await supabase
        .from('emergency_alerts')
        .select('id, user_id, ride_id, latitude, longitude, created_at, resolved')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20);

      // Resolve user names in one batch
      const userIds = Array.from(new Set([
        ...(failedRides ?? []).map(r => r.user_id),
        ...(flags ?? []).map(f => f.user_id),
        ...(sos ?? []).map(s => s.user_id),
      ].filter(Boolean) as string[]));

      const profilesMap = new Map<string, { full_name: string | null; phone: string | null }>();
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name, phone')
          .in('user_id', userIds);
        (profiles ?? []).forEach(p => profilesMap.set(p.user_id, {
          full_name: p.full_name, phone: p.phone,
        }));
      }

      const named = (uid: string) => profilesMap.get(uid)?.full_name || 'Unknown user';
      const phoneOf = (uid: string) => profilesMap.get(uid)?.phone || undefined;

      const rows: Incident[] = [];

      (failedRides ?? []).forEach(r => rows.push({
        id: `pay-${r.id}`,
        source: 'payment',
        severity: 'high',
        userName: named(r.user_id),
        userPhone: phoneOf(r.user_id),
        occurredAt: r.updated_at,
        title: `Payment failed — $${Number(r.fare ?? 0).toFixed(2)}`,
        detail: `${r.payment_failure_reason || 'Auto-charge failed'} • ${r.pickup_address || ''} → ${r.dropoff_address || ''}`,
        suggestion: suggestForFraud('payment_failed'),
      }));

      (flags ?? []).forEach(f => rows.push({
        id: `fraud-${f.id}`,
        source: 'fraud',
        severity: (f.severity as Incident['severity']) ?? 'medium',
        userName: named(f.user_id),
        userPhone: phoneOf(f.user_id),
        occurredAt: f.created_at,
        title: `Fraud flag: ${f.flag_type.replace(/_/g, ' ')}`,
        detail: typeof f.details === 'object' && f.details
          ? Object.entries(f.details).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' • ')
          : 'No details',
        suggestion: suggestForFraud(f.flag_type),
      }));

      (sos ?? []).forEach(s => rows.push({
        id: `sos-${s.id}`,
        source: 'sos',
        severity: s.resolved ? 'medium' : 'critical',
        userName: named(s.user_id),
        userPhone: phoneOf(s.user_id),
        occurredAt: s.created_at,
        title: `SOS: ${s.alert_type || 'emergency'}`,
        detail: s.message || 'No message provided',
        suggestion: 'Confirm response time <5 min, audit dispatcher notes, and verify emergency contacts on file.',
      }));

      rows.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
      setIncidents(rows);
    } catch (e) {
      console.error('Incidents load failed', e);
      toast.error('Could not load user incidents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const copyPrompt = (inc: Incident) => {
    const txt = [
      `Prevent recurrence — ${inc.title}`,
      ``,
      `Affected user: ${inc.userName}${inc.userPhone ? ` (${inc.userPhone})` : ''}`,
      `When: ${format(new Date(inc.occurredAt), 'PPpp')}`,
      `What happened: ${inc.detail}`,
      ``,
      `Suggested fix: ${inc.suggestion}`,
    ].join('\n');
    navigator.clipboard.writeText(txt);
    setCopiedId(inc.id);
    toast.success('Lovable prompt copied');
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <Card className="border-2">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            <h3 className="font-semibold text-lg">User Incidents (24h)</h3>
            <Badge variant="outline" className="text-xs">{incidents.length}</Badge>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {!loading && incidents.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            ✨ No user-facing incidents in the last 24 hours.
          </div>
        )}

        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {incidents.map(inc => (
            <div key={inc.id} className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className={`text-xs capitalize ${SEVERITY_COLORS[inc.severity]}`}>
                    {inc.severity}
                  </Badge>
                  <span className="font-medium text-sm truncate">{inc.title}</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {format(new Date(inc.occurredAt), 'MMM d, HH:mm')}
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                <span className="font-medium text-foreground">{inc.userName}</span>
                {inc.userPhone && <span>· {inc.userPhone}</span>}
              </div>

              <p className="text-xs text-muted-foreground">{inc.detail}</p>

              <div className="flex items-start gap-2 rounded-md bg-emerald-500/5 border border-emerald-500/20 p-2">
                <Lightbulb className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-emerald-800 flex-1">{inc.suggestion}</p>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => copyPrompt(inc)}>
                  {copiedId === inc.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
