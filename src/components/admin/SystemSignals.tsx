/**
 * SystemSignals — live 6-card operational dashboard for /admin/system-health.
 *
 * Polls every 30s. Each card surfaces a real PickMe operational metric pulled
 * directly from the live database (rides, wallets, drivers, GPS, security,
 * support). Severity dot + Health Score give the admin a single glance.
 */
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  RefreshCw, Activity, Wallet, Users, Radio, Shield, MessageSquareWarning,
  CheckCircle2, AlertTriangle, AlertCircle, Loader2,
} from 'lucide-react';
import { loadAllSignals, computeHealthScore, type SignalCard, type SignalSeverity } from '@/lib/systemSignals';
import { format } from 'date-fns';

const CARD_ICONS: Record<string, typeof Activity> = {
  'ride-pipeline': Activity,
  wallet: Wallet,
  fleet: Users,
  realtime: Radio,
  security: Shield,
  support: MessageSquareWarning,
};

const SEV_DOT: Record<SignalSeverity, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  critical: 'bg-red-500',
};

const SEV_RING: Record<SignalSeverity, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/5',
  warn: 'border-amber-500/30 bg-amber-500/5',
  critical: 'border-red-500/30 bg-red-500/5',
};

const SCORE_COLOR = (score: number) =>
  score >= 90 ? 'text-emerald-600' : score >= 70 ? 'text-amber-600' : 'text-red-600';

const SCORE_BG = (score: number) =>
  score >= 90 ? 'bg-emerald-500/10 border-emerald-500/30' :
  score >= 70 ? 'bg-amber-500/10 border-amber-500/30' :
  'bg-red-500/10 border-red-500/30';

export default function SystemSignals() {
  const [cards, setCards] = useState<SignalCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastLoad, setLastLoad] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadAllSignals();
      setCards(data);
      setLastLoad(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const score = cards ? computeHealthScore(cards) : null;
  const criticalCards = cards?.filter((c) => c.severity === 'critical').length ?? 0;
  const warnCards = cards?.filter((c) => c.severity === 'warn').length ?? 0;

  return (
    <Card className="border-2">
      <CardContent className="p-6 space-y-6">
        {/* Header + Health Score */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-black text-foreground flex items-center gap-2">
              Live Platform Signals
              <Badge variant="outline" className="text-[10px] font-mono">
                {lastLoad ? format(lastLoad, 'HH:mm:ss') : '—'}
              </Badge>
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {criticalCards > 0
                ? `${criticalCards} critical signal${criticalCards > 1 ? 's' : ''} require attention`
                : warnCards > 0
                  ? `${warnCards} signal${warnCards > 1 ? 's' : ''} above warning threshold`
                  : 'All operational signals within normal range'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {score !== null && (
              <div className={`px-5 py-3 rounded-2xl border-2 ${SCORE_BG(score)}`}>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                  Health Score
                </p>
                <p className={`text-3xl font-black ${SCORE_COLOR(score)} tabular-nums`}>{score}</p>
              </div>
            )}
            <Button onClick={() => void load()} disabled={loading} size="sm" variant="outline" className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </Button>
          </div>
        </div>

        {/* Card grid */}
        {!cards && loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-44 rounded-xl border bg-muted/30 animate-pulse" />
            ))}
          </div>
        )}

        {cards && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((card) => {
              const Icon = CARD_ICONS[card.id] ?? Activity;
              const SevIcon = card.severity === 'critical' ? AlertTriangle
                : card.severity === 'warn' ? AlertCircle
                : CheckCircle2;
              return (
                <Card key={card.id} className={`border-2 transition-all hover:shadow-md ${SEV_RING[card.severity]}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-xl bg-background border flex items-center justify-center">
                          <Icon className="w-4 h-4 text-foreground" />
                        </div>
                        <div>
                          <p className="font-bold text-sm text-foreground">{card.title}</p>
                          <p className="text-[11px] text-muted-foreground">{card.headline.label}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${SEV_DOT[card.severity]} animate-pulse`} />
                        <SevIcon className={`w-4 h-4 ${
                          card.severity === 'critical' ? 'text-red-600'
                          : card.severity === 'warn' ? 'text-amber-600'
                          : 'text-emerald-600'
                        }`} />
                      </div>
                    </div>

                    <div className="text-3xl font-black tabular-nums text-foreground">
                      {card.headline.value}
                    </div>

                    <div className="space-y-1.5 pt-1 border-t">
                      {card.metrics.map((m) => (
                        <div key={m.label} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground truncate pr-2">{m.label}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`w-1.5 h-1.5 rounded-full ${SEV_DOT[m.severity]}`} />
                            <span className="font-bold tabular-nums text-foreground">{m.value}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
