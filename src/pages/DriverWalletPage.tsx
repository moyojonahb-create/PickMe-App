import { useEffect, useState, useCallback } from "react";
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
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Driver Wallet (USD)</h1>
      </div>

      <div className="p-4 space-y-4 max-w-md mx-auto pb-28">
        {msg && <div className="text-destructive font-bold text-sm">{msg}</div>}

        {/* Bank-card style wallet */}
        <WalletCard
          fullName={full_name || 'Driver'}
          balance={balance}
          pickmeAccount={pickme_account}
        />

        {/* Driver actions: Deposit, Transfer, Withdraw */}
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={() => navigate("/drivers/deposit")} className="h-12 flex-col gap-0.5 py-1">
            <Plus className="h-4 w-4" />
            <span className="text-[11px] font-bold">Deposit</span>
          </Button>
          <Button onClick={() => setShowTransfer(true)} disabled={balance <= 0} variant="secondary" className="h-12 flex-col gap-0.5 py-1">
            <Send className="h-4 w-4" />
            <span className="text-[11px] font-bold">Transfer</span>
          </Button>
          <Button onClick={() => setShowWithdraw(true)} disabled={balance < 5} variant="outline" className="h-12 flex-col gap-0.5 py-1">
            <ArrowUpRight className="h-4 w-4" />
            <span className="text-[11px] font-bold">Withdraw</span>
          </Button>
        </div>

        {/* Stats Strip */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-card border rounded-xl p-3 text-center">
            <TrendingUp className="h-4 w-4 mx-auto text-green-500 mb-1" />
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Earned</div>
            <div className="text-sm font-black">${totalEarned.toFixed(2)}</div>
          </div>
          <div className="bg-card border rounded-xl p-3 text-center">
            <Receipt className="h-4 w-4 mx-auto text-primary mb-1" />
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Trips</div>
            <div className="text-sm font-black">{totalRides}</div>
          </div>
          <div className="bg-card border rounded-xl p-3 text-center">
            <Percent className="h-4 w-4 mx-auto text-amber-500 mb-1" />
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Fees</div>
            <div className="text-sm font-black">${totalCommission.toFixed(2)}</div>
          </div>
        </div>

        <WithdrawalModal isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} balance={balance} onSuccess={load} />
        <TransferMoneyModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} balance={balance} onSuccess={load} />

        {/* Tabs */}
        <div className="flex gap-1 bg-muted/50 rounded-xl p-1">
          <button
            onClick={() => setTab('earnings')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${tab === 'earnings' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
          >
            Earnings ({earnings.length})
          </button>
          <button
            onClick={() => setTab('deposits')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${tab === 'deposits' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
          >
            Deposits ({deposits.length})
          </button>
          <button
            onClick={() => setTab('withdrawals')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${tab === 'withdrawals' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
          >
            Withdrawals ({withdrawals.length})
          </button>
        </div>

        {/* Earnings History */}
        {tab === 'earnings' && (
          <div className="space-y-2">
            {earnings.length === 0 && !loading && (
              <div className="bg-card border rounded-xl p-6 text-center text-sm text-muted-foreground">
                No completed rides yet. Earnings appear here automatically.
              </div>
            )}
            {earnings.map((e) => (
              <div key={e.id} className="bg-card rounded-xl p-3 border">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm">+${Number(e.driver_earnings).toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(e.created_at), 'dd MMM yyyy, HH:mm')}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-muted-foreground">Fare ${Number(e.fare_amount).toFixed(2)}</div>
                    <div className="text-[10px] text-amber-600">−${Number(e.platform_fee).toFixed(2)} (15%)</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Deposit History */}
        {tab === 'deposits' && (
          <div className="space-y-2">
            {deposits.length === 0 && !loading && (
              <div className="bg-card border rounded-xl p-6 text-center text-sm text-muted-foreground">
                No deposits yet.
              </div>
            )}
            {deposits.map((d) => (
              <div key={d.id} className="bg-card rounded-xl p-3 border flex items-center justify-between">
                <div>
                  <div className="font-bold text-sm">${Number(d.amount_usd).toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(d.created_at), 'dd MMM yyyy, HH:mm')}
                  </div>
                  <div className="text-xs text-muted-foreground">{d.ecocash_reference}</div>
                </div>
                <span className={`text-xs font-bold capitalize ${statusColor(d.status)}`}>{d.status}</span>
              </div>
            ))}
          </div>
        )}

        {/* Withdrawal History */}
        {tab === 'withdrawals' && (
          <div className="space-y-2">
            {withdrawals.length === 0 && !loading && (
              <div className="bg-card border rounded-xl p-6 text-center text-sm text-muted-foreground">
                No withdrawals yet. Tap “Withdraw” to request one.
              </div>
            )}
            {withdrawals.map((w) => (
              <div key={w.id} className="bg-card rounded-xl p-3 border">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm">−${Number(w.amount_usd).toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {w.method} • {w.destination}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {format(new Date(w.created_at), 'dd MMM yyyy, HH:mm')}
                    </div>
                    {w.admin_note && (
                      <div className="text-[11px] text-muted-foreground mt-1 italic">“{w.admin_note}”</div>
                    )}
                  </div>
                  <span className={`text-xs font-bold capitalize ${statusColor(w.status)}`}>{w.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {loading && <div className="text-center text-muted-foreground text-sm py-4">Loading…</div>}
      </div>
    </div>
  );
}
