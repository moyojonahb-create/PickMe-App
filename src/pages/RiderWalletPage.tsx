import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, RefreshCw, Clock, CheckCircle, XCircle, Settings,
  ArrowDownLeft, ArrowUpRight, Send, History, Copy, Check,
  ShieldCheck, Lock, BadgeCheck, Eye, EyeOff, Smartphone, CreditCard,
} from 'lucide-react';
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
import { format, formatDistanceToNow } from 'date-fns';
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

const PAYMENT_PROVIDERS: { key: string; label: string; sub: string; bg: string; fg: string }[] = [
  { key: 'ecocash',    label: 'EcoCash',    sub: 'Mobile money',   bg: 'from-red-500 to-rose-600',        fg: 'text-white' },
  { key: 'onemoney',   label: 'OneMoney',   sub: 'Mobile money',   bg: 'from-amber-400 to-orange-500',    fg: 'text-white' },
  { key: 'innbucks',   label: 'InnBucks',   sub: 'Digital wallet', bg: 'from-emerald-500 to-emerald-600', fg: 'text-white' },
  { key: 'visa',       label: 'Visa',       sub: 'Card · soon',    bg: 'from-blue-700 to-blue-900',       fg: 'text-white' },
  { key: 'mastercard', label: 'Mastercard', sub: 'Card · soon',    bg: 'from-orange-500 to-red-600',      fg: 'text-white' },
  { key: 'paypal',     label: 'PayPal',     sub: 'Global · soon',  bg: 'from-sky-500 to-blue-700',        fg: 'text-white' },
];

export default function RiderWalletPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { balance, transactions, refresh: refreshWallet, loading: walletLoading } = useWallet();
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
  const [hideBalance, setHideBalance] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const [pinVerified, setPinVerified] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);

  useEffect(() => {
    if (!pinLoading && !pinVerified) setShowPinModal(true);
  }, [pinLoading, pinVerified]);

  const handleVerifyPin = async (enteredPin: string): Promise<boolean> => {
    try { return await verifyPin(enteredPin); }
    catch (err) { if (err instanceof Error) toast.error(err.message); return false; }
  };

  const handleSetPin = async (newPin: string): Promise<boolean> => {
    const ok = await setPin(newPin);
    if (ok) { setPinVerified(true); refreshPin(); }
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

  const handleRefresh = () => {
    refreshWallet();
    loadDeposits();
    setLastUpdated(new Date());
  };

  const pendingBalance = deposits
    .filter((d) => d.status === 'pending')
    .reduce((sum, d) => sum + Number(d.amount_usd || 0), 0);

  const copyAccount = async () => {
    if (!pickme_account) return;
    try {
      await navigator.clipboard.writeText(pickme_account);
      setCopied(true);
      toast.success('Account number copied');
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error('Could not copy'); }
  };

  const statusIcon = (s: string) => {
    if (s === 'approved') return <CheckCircle className="h-4 w-4 text-emerald-500" />;
    if (s === 'rejected') return <XCircle className="h-4 w-4 text-destructive" />;
    return <Clock className="h-4 w-4 text-amber-500" />;
  };

  useEffect(() => { if (!user) navigate('/auth'); }, [user, navigate]);

  if (pinLoading || !pinVerified) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-4">
        <WalletPinModal
          isOpen={showPinModal}
          onClose={() => { if (!pinVerified) navigate(-1); }}
          onVerified={() => { setPinVerified(true); setShowPinModal(false); }}
          mode={hasPin ? 'verify' : 'setup'}
          onVerifyPin={handleVerifyPin}
          onSetPin={handleSetPin}
        />
        <div className="opacity-30 max-w-sm w-full">
          <WalletCard fullName={full_name || 'User'} balance={0} pickmeAccount={pickme_account} hidden />
        </div>
      </div>
    );
  }

  const displayName = (full_name || 'User').split(' ').slice(0, 2).join(' ');

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/85 backdrop-blur-lg border-b border-slate-200/70">
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}
        >
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="rounded-full">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-[17px] font-bold tracking-tight text-foreground">My Wallet</h1>
            <p className="text-[11px] text-muted-foreground -mt-0.5">Manage your CruiXe balance</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setShowSettings((v) => !v)} className="rounded-full">
            <Settings className="h-4 w-4 text-foreground" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={walletLoading} className="rounded-full">
            <RefreshCw className={`h-4 w-4 text-foreground ${walletLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-5 max-w-lg mx-auto pb-28">
        {/* ===== Glass Balance Card ===== */}
        <section
          className="relative overflow-hidden rounded-[28px] p-5 text-white"
          style={{
            background: 'var(--gradient-primary)',
            boxShadow:
              '0 20px 40px -16px hsl(var(--primary)/0.45), 0 8px 16px -8px hsl(var(--primary)/0.35)',
          }}
        >
          {/* Glass orbs */}
          <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full bg-white/15 blur-3xl" />
          <div className="absolute -bottom-20 -left-10 w-52 h-52 rounded-full bg-accent/20 blur-3xl" />
          <div className="absolute top-0 left-0 right-0 h-px bg-white/30" />

          <div className="relative z-10">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/90 font-semibold">
                  Welcome back
                </p>
                <p className="text-[15px] font-bold mt-0.5 truncate max-w-[180px]">{displayName}</p>
              </div>
              <div className="flex items-center gap-1.5 bg-white/15 backdrop-blur-md border border-white/25 px-2.5 py-1 rounded-full">
                <ShieldCheck className="h-3 w-3" />
                <span className="text-[10px] font-bold tracking-wide">PROTECTED</span>
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center gap-2">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/90 font-semibold">
                  Available Balance
                </p>
                <button
                  onClick={() => setHideBalance((v) => !v)}
                  className="text-white/80 hover:text-white"
                  aria-label="Toggle balance visibility"
                >
                  {hideBalance ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="text-[40px] leading-none font-black tracking-tight mt-2">
                {hideBalance ? <span className="tracking-[0.3em]">••••••</span> : `$${balance.toFixed(2)}`}
              </p>
              <p className="text-[11px] text-white/80 mt-2">
                Last updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
              </p>
            </div>

            {/* Sub-stats */}
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <div className="rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-white/90 font-semibold">Pending</p>
                <p className="text-[15px] font-extrabold mt-0.5">
                  {hideBalance ? '••••' : `$${pendingBalance.toFixed(2)}`}
                </p>
              </div>
              <button
                onClick={copyAccount}
                disabled={!pickme_account}
                className="rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 px-3 py-2.5 text-left active:scale-[0.98] transition-transform"
              >
                <p className="text-[10px] uppercase tracking-wider text-white/90 font-semibold flex items-center gap-1">
                  Account
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </p>
                <p className="text-[13px] font-mono font-extrabold tracking-[0.1em] mt-0.5 truncate">
                  {pickme_account || 'PMR••••••R'}
                </p>
              </button>
            </div>
          </div>
        </section>

        {/* ===== Quick Action Grid ===== */}
        <section className="grid grid-cols-4 gap-2.5">
          {[
            { label: 'Deposit',  icon: Plus,          onClick: () => setShowDeposit(true),  tint: 'bg-blue-50 text-blue-700',   ring: 'ring-blue-100' },
            { label: 'Withdraw', icon: ArrowUpRight,  onClick: () => setShowWithdraw(true), tint: 'bg-violet-50 text-violet-700', ring: 'ring-violet-100', disabled: balance < 5 },
            { label: 'Transfer', icon: Send,          onClick: () => setShowTransfer(true), tint: 'bg-emerald-50 text-emerald-700', ring: 'ring-emerald-100', disabled: balance <= 0 },
            { label: 'History',  icon: History,       onClick: () => setShowTransactions(true), tint: 'bg-amber-50 text-amber-700', ring: 'ring-amber-100' },
          ].map(({ label, icon: Icon, onClick, tint, ring, disabled }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={disabled}
              className="group flex flex-col items-center gap-1.5 rounded-2xl bg-white p-3 shadow-sm border border-slate-100 active:scale-[0.97] transition-all disabled:opacity-50 disabled:active:scale-100"
              style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px -4px rgba(15,23,42,0.06)' }}
            >
              <span className={`h-10 w-10 rounded-2xl ${tint} ring-4 ${ring} flex items-center justify-center`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[11px] font-semibold text-foreground">{label}</span>
            </button>
          ))}
        </section>

        {/* ===== Payment Providers ===== */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[13px] font-bold text-foreground">Payment Methods</h2>
            <span className="text-[11px] text-muted-foreground">Top up & cash out</span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {PAYMENT_PROVIDERS.map((p) => (
              <button
                key={p.key}
                onClick={() => setShowDeposit(true)}
                className="relative overflow-hidden rounded-2xl p-3 text-left active:scale-[0.97] transition-transform"
                style={{ boxShadow: '0 6px 16px -8px rgba(15,23,42,0.18)' }}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${p.bg}`} />
                <div className="absolute -top-6 -right-6 w-16 h-16 rounded-full bg-white/15 blur-xl" />
                <div className={`relative ${p.fg}`}>
                  <div className="h-7 w-7 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center">
                    {p.key === 'visa' || p.key === 'mastercard' || p.key === 'paypal'
                      ? <CreditCard className="h-3.5 w-3.5" />
                      : <Smartphone className="h-3.5 w-3.5" />}
                  </div>
                  <p className="text-[12px] font-extrabold mt-2 leading-none">{p.label}</p>
                  <p className="text-[9px] opacity-85 mt-1 leading-none">{p.sub}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        {showSettings && (
          <WalletSettings hasPin={hasPin} onSetPin={handleSetPin} onVerifyPin={handleVerifyPin} />
        )}

        {/* ===== Recent Transactions ===== */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[13px] font-bold text-foreground">Recent Transactions</h2>
            <button
              onClick={() => setShowTransactions(true)}
              className="text-[11px] font-semibold text-primary"
            >
              View all
            </button>
          </div>

          <div className="rounded-2xl bg-white border border-slate-100 overflow-hidden"
               style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px -4px rgba(15,23,42,0.05)' }}>
            {transactions.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="h-12 w-12 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center">
                  <History className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-[13px] font-semibold text-foreground mt-3">No transactions yet</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Top up your wallet to get started</p>
              </div>
            ) : (
              transactions.slice(0, 5).map((tx, i) => {
                const isPositive = Number(tx.amount) > 0;
                return (
                  <div
                    key={tx.id}
                    className={`flex items-center gap-3 px-3.5 py-3 ${i !== 0 ? 'border-t border-slate-100' : ''}`}
                  >
                    <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${
                      isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                    }`}>
                      {isPositive ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground truncate capitalize">
                        {tx.description || tx.transaction_type.replace('_', ' ')}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {format(new Date(tx.created_at), 'dd MMM, HH:mm')} · <span className="text-emerald-600 font-medium">Completed</span>
                      </p>
                    </div>
                    <span className={`text-[14px] font-extrabold ${isPositive ? 'text-emerald-600' : 'text-foreground'}`}>
                      {isPositive ? '+' : '-'}${Math.abs(Number(tx.amount)).toFixed(2)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ===== Deposit History ===== */}
        {(deposits.length > 0 || loadingDeposits) && (
          <section>
            <h2 className="text-[13px] font-bold text-foreground mb-2.5">Deposit Requests</h2>
            <div className="space-y-2">
              {deposits.map((d) => (
                <div
                  key={d.id}
                  className="bg-white rounded-2xl p-3 border border-slate-100 flex items-center gap-3"
                  style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03)' }}
                >
                  {statusIcon(d.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[13px] text-foreground">${Number(d.amount_usd).toFixed(2)}</span>
                      <span className="text-[10px] bg-slate-100 text-foreground px-1.5 py-0.5 rounded-full font-semibold">
                        {METHOD_LABELS[d.payment_method] || d.payment_method}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      Ref: {d.reference} · {format(new Date(d.created_at), 'dd MMM, HH:mm')}
                    </div>
                  </div>
                  <span className={`text-[11px] font-bold capitalize ${
                    d.status === 'approved' ? 'text-emerald-600'
                      : d.status === 'rejected' ? 'text-destructive'
                      : 'text-amber-600'
                  }`}>
                    {d.status}
                  </span>
                </div>
              ))}
              {loadingDeposits && <div className="text-center text-muted-foreground text-[12px] py-3">Loading…</div>}
            </div>
          </section>
        )}

        {/* ===== Trust Section ===== */}
        <section className="rounded-2xl bg-white border border-slate-100 p-4"
                 style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px -4px rgba(15,23,42,0.05)' }}>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold mb-3">Your money is safe</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: ShieldCheck, label: 'Wallet Protected', tint: 'bg-blue-50 text-blue-700' },
              { icon: Lock,        label: 'Encrypted',        tint: 'bg-violet-50 text-violet-700' },
              { icon: BadgeCheck,  label: 'Verified Payments',tint: 'bg-emerald-50 text-emerald-700' },
            ].map(({ icon: Icon, label, tint }) => (
              <div key={label} className="flex flex-col items-center text-center gap-1.5">
                <span className={`h-9 w-9 rounded-xl ${tint} flex items-center justify-center`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-[10.5px] font-semibold text-foreground leading-tight">{label}</span>
              </div>
            ))}
          </div>
          {referralEarnings > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] text-foreground">Referral earnings</span>
              <span className="text-[12px] font-bold text-emerald-600">+${referralEarnings.toFixed(2)}</span>
            </div>
          )}
        </section>

        <p className="text-center text-[10px] text-muted-foreground pt-2">
          CruiXe Wallet · Secured by 256-bit encryption
        </p>
      </div>

      <DepositModal
        isOpen={showDeposit}
        onClose={() => { setShowDeposit(false); handleRefresh(); }}
        currentBalance={balance}
      />

      <TransactionsSheet
        isOpen={showTransactions}
        onClose={() => setShowTransactions(false)}
        transactions={transactions.map((t) => ({
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
