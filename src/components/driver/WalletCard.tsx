import { Wallet } from 'lucide-react';

interface WalletCardProps {
  balance: number;
  loading?: boolean;
  onTopUp: () => void;
}

export default function WalletCard({ balance, loading, onTopUp }: WalletCardProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-11 h-11 rounded-2xl shrink-0 flex items-center justify-center" style={{ background: '#FFDD00' }}>
          <Wallet className="w-5 h-5" style={{ color: '#111111' }} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground">Wallet Balance</p>
          <p className="text-xl font-black text-foreground tabular-nums">
            {loading ? '…' : `$${balance.toFixed(2)}`}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onTopUp}
        className="shrink-0 px-4 h-9 rounded-full bg-primary text-primary-foreground text-[13px] font-bold active:scale-95 transition-transform"
      >
        Top up
      </button>
    </div>
  );
}
