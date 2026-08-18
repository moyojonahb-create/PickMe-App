import { CreditCard, Lock, FileText, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaymentSectionProps {
  proofStatus: string | null;
  onPaymentMethods: () => void;
  onDeposit: () => void;
  onPaymentProof: () => void;
}

const STATUS_STYLE: Record<string, string> = {
  approved: 'bg-emerald-500/10 text-emerald-600',
  verified: 'bg-emerald-500/10 text-emerald-600',
  pending: 'bg-amber-500/10 text-amber-600',
  rejected: 'bg-destructive/10 text-destructive',
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const label = status === 'approved' ? 'Verified' : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={cn('shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold', STATUS_STYLE[status] ?? 'bg-muted text-muted-foreground')}>
      {label}
    </span>
  );
}

export default function PaymentSection({ proofStatus, onPaymentMethods, onDeposit, onPaymentProof }: PaymentSectionProps) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <p className="px-4 pt-3.5 pb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        Account &amp; Payments
      </p>

      <button type="button" onClick={onPaymentMethods} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-muted/40 transition-colors border-t border-border/60">
        <CreditCard className="w-4.5 h-4.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground">Payment Methods</p>
          <p className="text-[11px] text-muted-foreground">Manage your bank accounts &amp; cards</p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      <button type="button" onClick={onDeposit} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-muted/40 transition-colors border-t border-border/60">
        <Lock className="w-4.5 h-4.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground">Deposit / Load Funds</p>
          <p className="text-[11px] text-muted-foreground">Add money to your wallet</p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      <button type="button" onClick={onPaymentProof} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-muted/40 transition-colors border-t border-border/60">
        <FileText className="w-4.5 h-4.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground">Payment Proof</p>
          <p className="text-[11px] text-muted-foreground">Upload proof when loading your account</p>
        </div>
        <StatusBadge status={proofStatus} />
      </button>
    </div>
  );
}
