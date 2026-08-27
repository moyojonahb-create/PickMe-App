import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Send, TrendingUp, Receipt, Percent, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import WithdrawalModal from "@/components/wallet/WithdrawalModal";
import TransferMoneyModal from "@/components/wallet/TransferMoneyModal";
import WalletCard from "@/components/wallet/WalletCard";
import WalletPinModal from "@/components/wallet/WalletPinModal";
import { useWalletPin } from "@/hooks/useWalletPin";
import { usePickmeAccount } from "@/hooks/usePickmeAccount";
import { toast } from "sonner";
import { getDriverWalletSummary } from "@/lib/walletApi";


interface DepositRecord {
  id: string;
  amount_usd: number;
  status: string;
  created_at: string;
  ecocash_reference: string;
}

interface EarningRecord {
  id: string;
  ride_id: string | null;
  fare_amount: number;
  platform_fee: number;
  driver_earnings: number;
  created_at: string;
}

interface WithdrawalRecord {
  id: string;
  amount_usd: number;
  method: string;
  destination: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  approved_at: string | null;
}

export default function DriverWalletPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [balance, setBalance] = useState(0);
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [earnings, setEarnings] = useState<EarningRecord[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [tab, setTab] = useState<'earnings' | 'deposits' | 'withdrawals'>('earnings');

  // PIN gate — required to view balance/transactions
  const { hasPin, loading: pinLoading, setPin, verifyPin, refresh: refreshPin } = useWalletPin();
  const { full_name, pickme_account } = usePickmeAccount();
  const [pinVerified, setPinVerified] = useState(false);

  const handleVerifyPin = async (p: string) => {
    try { return await verifyPin(p); }
    catch (e) { if (e instanceof Error) toast.error(e.message); return false; }
  };
  const handleSetPin = async (p: string) => {
    const ok = await setPin(p);
    if (ok) { setPinVerified(true); refreshPin(); }
    return ok;
  };


  const load = useCallback(async () => {
    if (!user) return;
    setMsg("");
    setLoading(true);
    try {
      const w = await getDriverWalletSummary();
      setBalance(Number(w.balance ?? 0));
      setDeposits(w.deposits.map((d) => ({
        id: d.id,
        amount_usd: d.amount_usd,
        status: d.status,
        created_at: d.created_at,
        ecocash_reference: d.ecocash_reference ?? d.reference ?? "",
      })));
      setEarnings(w.earnings as EarningRecord[]);
      setWithdrawals(w.withdrawals.map((row) => ({
        id: row.id,
        amount_usd: row.amount_usd,
        method: row.method,
        destination: row.destination,
        status: row.status,
        admin_note: row.admin_note ?? null,
        created_at: row.created_at,
        approved_at: row.approved_at ?? null,
      })));
    } catch (e: unknown) {
      setMsg((e as Error).message || "Failed to load wallet");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const statusColor = (s: string) => {
    if (s === 'approved') return 'text-green-500';
    if (s === 'rejected') return 'text-destructive';
    return 'text-amber-500';
  };

  // Aggregate stats
  const totalEarned = earnings.reduce((s, e) => s + Number(e.driver_earnings), 0);
  const totalCommission = earnings.reduce((s, e) => s + Number(e.platform_fee), 0);
  const totalRides = earnings.length;
  const pendingItems = useMemo(() => deposits.filter((d) => d.status === 'pending').length + withdrawals.filter((w) => w.status === 'pending').length, [deposits, withdrawals]);

  // PIN gate: BLOCK access until PIN is set up or verified
  if (pinLoading || !pinVerified) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4">
        <WalletPinModal
          isOpen={true}
          onClose={() => { if (!pinVerified) navigate(-1); }}
          onVerified={() => setPinVerified(true)}
          mode={hasPin ? 'verify' : 'setup'}
          onVerifyPin={handleVerifyPin}
          onSetPin={handleSetPin}
        />
        <div className="opacity-30 max-w-sm w-full">
          <WalletCard fullName={full_name || 'Driver'} balance={0} pickmeAccount={pickme_account} hidden />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/[0.05] via-background to-background relative">
      {/* Ambient blue glow */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[520px] h-[280px] bg-primary/15 rounded-full blur-[120px]" aria-hidden />

      <div className="sticky top-0 z-10 backdrop-blur-2xl bg-background/70 border-b border-border/40 px-4 py-3 flex items-center gap-3 shadow-[0_1px_0_hsl(var(--border)/0.5)]">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="w-10 h-10 rounded-2xl hover:bg-primary/10 active:scale-90">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-lg font-bold">Driver Wallet</h1>
          <p className="text-xs text-muted-foreground">USD balance, earnings, and transfer activity</p>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-md mx-auto pb-28 relative">
        {msg && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 text-destructive font-bold text-sm p-3 flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-destructive mt-1.5 shrink-0" />
            <span>{msg}</span>
          </div>
        )}

        {/* Bank-card style wallet */}
        <WalletCard
          fullName={full_name || 'Driver'}
          balance={balance}
          pickmeAccount={pickme_account}
        />

        {pendingItems > 0 && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">Pending review</p>
                <p className="text-xs text-muted-foreground">{pendingItems} item{pendingItems === 1 ? '' : 's'} waiting for approval.</p>
              </div>
              <div className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-700">{pendingItems}</div>
            </div>
          </div>
        )}

        {/* Driver actions: Deposit, Transfer, Withdraw */}
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={() => navigate("/driver/deposit")} className="h-12 flex-col gap-0.5 py-1">
            <Plus className="h-4 w-4" />
            <span className="text-[11px] font-bold">Deposit</span>
          </Button>
          <Button onClick={() => setShowTransfer(true)} disabled={balance <= 0} variant="secondary" className="h-14 flex-col gap-1 py-1 rounded-2xl glass-card border border-primary/10">
            <Send className="h-4 w-4" />
            <span className="text-[11px] font-bold">Transfer</span>
          </Button>
          <Button onClick={() => setShowWithdraw(true)} disabled={balance < 5} variant="outline" className="h-14 flex-col gap-1 py-1 rounded-2xl glass-card border-primary/20">
            <ArrowUpRight className="h-4 w-4" />
            <span className="text-[11px] font-bold">Withdraw</span>
          </Button>
        </div>

        {/* Stats Strip — premium glass */}
        <div className="grid grid-cols-3 gap-2">
          <div className="glass-card rounded-2xl p-3 text-center border border-primary/10 transition-transform active:scale-95">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">Earned</div>
            <div className="text-sm font-black tabular-nums mt-0.5">${totalEarned.toFixed(2)}</div>
          </div>
          <div className="glass-card rounded-2xl p-3 text-center border border-primary/10 transition-transform active:scale-95">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-1.5">
              <Receipt className="h-4 w-4 text-primary" />
            </div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">Trips</div>
            <div className="text-sm font-black tabular-nums mt-0.5">{totalRides}</div>
          </div>
          <div className="glass-card rounded-2xl p-3 text-center border border-primary/10 transition-transform active:scale-95">
            <div className="w-8 h-8 rounded-xl bg-destructive/10 flex items-center justify-center mx-auto mb-1.5">
              <Percent className="h-4 w-4 text-destructive" />
            </div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider font-bold">Fees</div>
            <div className="text-sm font-black tabular-nums mt-0.5">${totalCommission.toFixed(2)}</div>
          </div>
        </div>

        <WithdrawalModal isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} balance={balance} onSuccess={load} />
        <TransferMoneyModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} balance={balance} onSuccess={load} />

        {/* Tabs — glass pills */}
        <div className="flex gap-1 glass-card rounded-2xl p-1 border border-primary/10">
          {([
            { key: 'earnings', label: 'Earnings', count: earnings.length },
            { key: 'deposits', label: 'Deposits', count: deposits.length },
            { key: 'withdrawals', label: 'Withdrawals', count: withdrawals.length },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 text-[11px] font-black rounded-xl transition-all active:scale-95 ${
                tab === t.key
                  ? 'text-primary-foreground shadow-[0_4px_14px_-4px_hsl(4_96%_37%/0.25)]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              style={tab === t.key ? { background: 'linear-gradient(135deg, hsl(var(--cruixe-red)) 0%, hsl(var(--cruixe-red-dark)) 100%)' } : undefined}
            >
              {t.label} <span className={`ml-0.5 tabular-nums ${tab === t.key ? 'text-primary-foreground/80' : ''}`}>({t.count})</span>
            </button>
          ))}
        </div>

        {/* Earnings History */}
        {tab === 'earnings' && (
          <div className="space-y-2 animate-fade-in">
            {earnings.length === 0 && !loading && (
              <div className="glass-card border border-primary/10 rounded-2xl p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                </div>
                <p className="font-bold text-sm text-foreground">No earnings yet</p>
                <p className="text-xs text-muted-foreground mt-1">Complete a ride — earnings appear here automatically.</p>
              </div>
            )}
            {earnings.map((e) => (
              <div key={e.id} className="glass-card rounded-2xl p-3.5 border border-primary/10 active:scale-[0.99] transition-transform">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div>
                      <div className="font-black text-sm text-emerald-600 tabular-nums">+${Number(e.driver_earnings).toFixed(2)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {format(new Date(e.created_at), 'dd MMM yyyy, HH:mm')}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-muted-foreground tabular-nums">Fare ${Number(e.fare_amount).toFixed(2)}</div>
                    <div className="text-[10px] text-destructive font-semibold tabular-nums">−${Number(e.platform_fee).toFixed(2)} · 15%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Deposit History */}
        {tab === 'deposits' && (
          <div className="space-y-2 animate-fade-in">
            {deposits.length === 0 && !loading && (
              <div className="glass-card border border-primary/10 rounded-2xl p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <Plus className="h-5 w-5 text-primary" />
                </div>
                <p className="font-bold text-sm text-foreground">No deposits yet</p>
                <p className="text-xs text-muted-foreground mt-1">Top up your wallet to keep driving.</p>
              </div>
            )}
            {deposits.map((d) => (
              <div key={d.id} className="glass-card rounded-2xl p-3.5 border border-primary/10 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Plus className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-black text-sm tabular-nums">${Number(d.amount_usd).toFixed(2)}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {format(new Date(d.created_at), 'dd MMM yyyy, HH:mm')}
                    </div>
                    <div className="text-[10px] text-muted-foreground/80 truncate">{d.ecocash_reference}</div>
                  </div>
                </div>
                <span className={`text-[11px] font-black capitalize px-2.5 py-1 rounded-full ${
                  d.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600' :
                  d.status === 'rejected' ? 'bg-destructive/10 text-destructive' :
                  'bg-amber-500/10 text-amber-600'
                }`}>{d.status}</span>
              </div>
            ))}
          </div>
        )}

        {/* Withdrawal History */}
        {tab === 'withdrawals' && (
          <div className="space-y-2 animate-fade-in">
            {withdrawals.length === 0 && !loading && (
              <div className="glass-card border border-primary/10 rounded-2xl p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-3">
                  <ArrowUpRight className="h-5 w-5 text-destructive" />
                </div>
                <p className="font-bold text-sm text-foreground">No withdrawals yet</p>
                <p className="text-xs text-muted-foreground mt-1">Tap "Withdraw" once your balance reaches $5.</p>
              </div>
            )}
            {withdrawals.map((w) => (
              <div key={w.id} className="glass-card rounded-2xl p-3.5 border border-primary/10">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                      <ArrowUpRight className="h-4 w-4 text-destructive" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-black text-sm tabular-nums">−${Number(w.amount_usd).toFixed(2)}</div>
                      <div className="text-[11px] text-muted-foreground capitalize">
                        {w.method} • {w.destination}
                      </div>
                      <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                        {format(new Date(w.created_at), 'dd MMM yyyy, HH:mm')}
                      </div>
                      {w.admin_note && (
                        <div className="text-[10px] text-muted-foreground mt-1 italic">"{w.admin_note}"</div>
                      )}
                    </div>
                  </div>
                  <span className={`text-[11px] font-black capitalize px-2.5 py-1 rounded-full ${
                    w.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600' :
                    w.status === 'rejected' ? 'bg-destructive/10 text-destructive' :
                    'bg-amber-500/10 text-amber-600'
                  }`}>{w.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse [animation-delay:120ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse [animation-delay:240ms]" />
          </div>
        )}
      </div>
    </div>
  );
}
