import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, RefreshCw, Clock, CheckCircle, XCircle, Settings, Smartphone, ArrowDownLeft, ArrowUpRight, Gift, Send } from 'lucide-react';
import BottomNavBar from '@/components/BottomNavBar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { useWalletPin } from '@/hooks/useWalletPin';
import { usePickmeAccount } from '@/hooks/usePickmeAccount';
import { supabase } from '@/integrations/supabase/client';
import { listWalletDeposits } from '@/lib/walletApi';
import DepositModal from '@/components/wallet/DepositModal';
import WalletPinModal from '@/components/wallet/WalletPinModal';
import WalletSettings from '@/components/wallet/WalletSettings';
import TransactionsSheet from '@/components/wallet/TransactionsSheet';
import TransferMoneyModal from '@/components/wallet/TransferMoneyModal';
import WithdrawalModal from '@/components/wallet/WithdrawalModal';
import WalletCard from '@/components/wallet/WalletCard';
import { format } from 'date-fns';
import { toast } from 'sonner';


interface RiderDeposit {
  id: string;
  amount_usd: number;
  payment_method: string;
  reference: string;
  status: string;
  created_at: string;
}

const METHOD_LABELS: Record<string, string> = {
  ecocash: 'EcoCash', onemoney: 'OneMoney', telecash: 'Telecash',
  innbucks: 'InnBucks', zimswitch: 'ZimSwitch', mukuru: 'Mukuru',
  bank_transfer: 'Bank Transfer',
};

export default function RiderWalletPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { balance, transactions, deposit, refresh: refreshWallet, loading: walletLoading } = useWallet();
  const { hasPin, loading: pinLoading, setPin, verifyPin, refresh: refreshPin } = useWalletPin();
  const { full_name, pickme_account } = usePickmeAccount();
  const [showDeposit, setShowDeposit] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [deposits, setDeposits] = useState<RiderDeposit[]>([]);
  const [loadingDeposits, setLoadingDeposits] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [referralEarnings, setReferralEarnings] = useState(0);

  // PIN gate state — wallet ALWAYS requires a PIN
  const [pinVerified, setPinVerified] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);

  // Force PIN setup if missing, otherwise require verification
  useEffect(() => {
    if (!pinLoading && !pinVerified) setShowPinModal(true);
  }, [pinLoading, pinVerified]);


  const handleVerifyPin = async (enteredPin: string): Promise<boolean> => {
    try {
      return await verifyPin(enteredPin);
    } catch (err) {
      if (err instanceof Error) {
        toast.error(err.message);
      }
      return false;
    }
  };

  const handleSetPin = async (newPin: string): Promise<boolean> => {
    const ok = await setPin(newPin);
    if (ok) {
      setPinVerified(true);
      refreshPin();
    }
    return ok;
  };

  const loadDeposits = useCallback(async () => {
    if (!user) return;
    setLoadingDeposits(true);
    try {
      const data = await listWalletDeposits({ type: 'rider', limit: 20 });
      setDeposits(data.map((d) => ({
        id: d.id,
        amount_usd: d.amount_usd,
        payment_method: d.payment_method ?? 'deposit',
        reference: d.reference ?? d.ecocash_reference ?? '',
        status: d.status,
        created_at: d.created_at,
      })));
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load deposits');
      setDeposits([]);
    }
    setLoadingDeposits(false);
  }, [user]);

  // Load referral earnings
  useEffect(() => {
    if (!user || !pinVerified) return;
    (async () => {
      const { count } = await supabase
        .from('referrals')
        .select('*', { count: 'exact', head: true })
        .eq('referrer_id', user.id)
        .eq('status', 'completed');
      setReferralEarnings((count || 0) * 2);
    })();
  }, [user, pinVerified]);

  useEffect(() => { if (pinVerified) loadDeposits(); }, [loadDeposits, pinVerified]);

  const handleRefresh = () => { refreshWallet(); loadDeposits(); };

  const statusIcon = (s: string) => {
    if (s === 'approved') return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (s === 'rejected') return <XCircle className="h-4 w-4 text-destructive" />;
    return <Clock className="h-4 w-4 text-amber-500" />;
  };

  useEffect(() => { if (!user) navigate('/auth'); }, [user, navigate]);

  // PIN gate: BLOCK access until PIN is set up (if missing) or verified.
  if (pinLoading || !pinVerified) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4">
        <WalletPinModal
          isOpen={showPinModal}
          onClose={() => {
            // If user dismissed without verifying, navigate back
            if (!pinVerified) navigate(-1);
          }}
          onVerified={() => { setPinVerified(true); setShowPinModal(false); }}
          mode={hasPin ? 'verify' : 'setup'}
          onVerifyPin={handleVerifyPin}
          onSetPin={handleSetPin}
        />
        {/* Skeleton placeholder behind PIN */}
        <div className="opacity-30 max-w-sm w-full">
          <WalletCard fullName={full_name || 'User'} balance={0} pickmeAccount={pickme_account} hidden />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center gap-3 p-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold flex-1">My Wallet</h1>
          <Button variant="ghost" size="icon" onClick={() => setShowSettings(!showSettings)}>
            <Settings className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={walletLoading}>
            <RefreshCw className={`h-4 w-4 ${walletLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-5 max-w-lg mx-auto pb-28">
        {/* Bank-card style wallet */}
        <WalletCard
          fullName={full_name || 'User'}
          balance={balance}
          pickmeAccount={pickme_account}
        />

        {/* Primary actions: Deposit, Send, Withdraw */}
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={() => setShowDeposit(true)} className="h-12 flex-col gap-0.5 py-1">
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

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setShowDeposit(true)}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-primary/15 active:scale-95 transition-all"
          >
            <Smartphone className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-semibold text-primary">EcoCash</span>
            <span className="text-[8px] text-muted-foreground">Top Up</span>
          </button>
          <button
            onClick={() => setShowTransactions(true)}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-accent/15 active:scale-95 transition-all"
          >
            <ArrowDownLeft className="w-5 h-5 text-accent-foreground" />
            <span className="text-[10px] font-semibold text-accent-foreground">Transactions</span>
            <span className="text-[8px] text-muted-foreground">{transactions.length} total</span>
          </button>
          <button
            onClick={() => navigate('/profile')}
            className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-primary/15 active:scale-95 transition-all"
          >
            <Gift className="w-5 h-5 text-primary" />
            <span className="text-[10px] font-semibold text-primary">Referrals</span>
            <span className="text-[8px] text-muted-foreground">${referralEarnings} earned</span>
          </button>
        </div>

        {/* Settings panel (collapsible) */}
        {showSettings && (
          <WalletSettings
            hasPin={hasPin}
            onSetPin={handleSetPin}
            onVerifyPin={handleVerifyPin}
          />
        )}

        {/* Recent Transactions */}
        {transactions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Recent</h2>
              <button onClick={() => setShowTransactions(true)} className="text-xs text-primary font-medium">
                View All
              </button>
            </div>
            <div className="space-y-1.5">
              {transactions.slice(0, 3).map((tx) => {
                const isPositive = Number(tx.amount) > 0;
                return (
                  <div key={tx.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/30">
                    <div className={`p-1.5 rounded-full ${isPositive ? 'bg-primary/10' : 'bg-destructive/10'}`}>
                      {isPositive ? <ArrowDownLeft className="w-3.5 h-3.5 text-primary" /> : <ArrowUpRight className="w-3.5 h-3.5 text-destructive" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{tx.description || tx.transaction_type}</p>
                      <p className="text-[10px] text-muted-foreground">{format(new Date(tx.created_at), 'dd MMM, HH:mm')}</p>
                    </div>
                    <span className={`text-xs font-bold ${isPositive ? 'text-primary' : 'text-destructive'}`}>
                      {isPositive ? '+' : ''}${Math.abs(Number(tx.amount)).toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick info */}
        <div className="bg-accent/30 rounded-xl p-3 text-sm text-muted-foreground">
          💡 Top up via EcoCash, OneMoney, Telecash, InnBucks, ZimSwitch, Mukuru, or Bank Transfer. Balance credited once verified.
        </div>

        {/* Deposit History */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Deposit History</h2>
          
          {deposits.length === 0 && !loadingDeposits && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No deposits yet. Tap "Top Up Wallet" to get started.
            </div>
          )}

          <div className="space-y-2">
            {deposits.map((d) => (
              <div key={d.id} className="bg-card rounded-xl p-3 border flex items-center gap-3">
                {statusIcon(d.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">${Number(d.amount_usd).toFixed(2)}</span>
                    <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded-full">
                      {METHOD_LABELS[d.payment_method] || d.payment_method}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    Ref: {d.reference} · {format(new Date(d.created_at), 'dd MMM, HH:mm')}
                  </div>
                </div>
                <span className={`text-xs font-bold capitalize ${
                  d.status === 'approved' ? 'text-green-500' : d.status === 'rejected' ? 'text-destructive' : 'text-amber-500'
                }`}>
                  {d.status}
                </span>
              </div>
            ))}
          </div>

          {loadingDeposits && <div className="text-center text-muted-foreground text-sm py-4">Loading…</div>}
        </div>
      </div>

      <DepositModal
        isOpen={showDeposit}
        onClose={() => { setShowDeposit(false); handleRefresh(); }}
        onDeposit={deposit}
        currentBalance={balance}
      />

      <TransactionsSheet
        isOpen={showTransactions}
        onClose={() => setShowTransactions(false)}
        transactions={transactions.map(t => ({
          ...t,
          amount: Number(t.amount),
          transaction_type: t.transaction_type as 'deposit' | 'withdrawal' | 'trip_fee' | 'refund',
        }))}
        title="All Transactions"
      />

      <TransferMoneyModal
        isOpen={showTransfer}
        onClose={() => setShowTransfer(false)}
        balance={balance}
        onSuccess={refreshWallet}
      />

      <WithdrawalModal
        isOpen={showWithdraw}
        onClose={() => setShowWithdraw(false)}
        balance={balance}
        onSuccess={refreshWallet}
      />

      <BottomNavBar />
    </div>
  );
}
