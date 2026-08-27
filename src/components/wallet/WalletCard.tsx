import { Wallet, Copy, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface WalletCardProps {
  fullName: string;
  balance: number;
  pickmeAccount: string | null;
  hidden?: boolean;
}

/**
 * Bank-card style wallet display: red gradient with yellow accents.
 * Shows the user's PickMe account number (PMR######R) and balance.
 */
export default function WalletCard({ fullName, balance, pickmeAccount, hidden }: WalletCardProps) {
  const [copied, setCopied] = useState(false);

  const copyAccount = async () => {
    if (!pickmeAccount) return;
    try {
      await navigator.clipboard.writeText(pickmeAccount);
      setCopied(true);
      toast.success("Account number copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };

  const displayName = (fullName || "User").split(" ").slice(0, 2).join(" ");

  return (
    <div
      className="relative overflow-hidden rounded-3xl p-5 text-white shadow-2xl"
      style={{
        background: "linear-gradient(135deg, #7F0B02 0%, #B81104 55%, #7F0B02 100%)",
      }}
    >
      {/* Decorative yellow circles */}
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-yellow-400/20 blur-2xl" />
      <div className="absolute -bottom-12 -left-8 w-32 h-32 rounded-full bg-yellow-400/15 blur-xl" />

      <div className="relative z-10 space-y-5">
        {/* Top row: greeting + chip */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-yellow-300/90 font-semibold">
              Welcome
            </p>
            <p className="text-base font-bold truncate max-w-[180px]">{displayName}</p>
          </div>
          <div className="flex items-center gap-1 bg-accent text-accent-foreground px-2.5 py-1 rounded-full font-black text-[11px] shadow">
            <Wallet className="h-3.5 w-3.5" />
            CruiXe
          </div>
        </div>

        {/* Yellow chip / logo */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-8 rounded-md bg-gradient-to-br from-yellow-300 to-yellow-500 shadow-inner flex items-center justify-center">
            <div className="w-7 h-5 rounded-sm border border-yellow-700/40" />
          </div>
          <p className="text-[11px] uppercase tracking-wider text-yellow-200/90 font-semibold">
            CruiXe Wallet Balance
          </p>
        </div>

        {/* Balance */}
        <div>
          <p className="text-3xl font-black tracking-tight">
            {hidden ? (
              <span className="tracking-[0.5em]">••••••</span>
            ) : (
              `$${balance.toFixed(2)}`
            )}
          </p>
        </div>

        {/* Account number */}
        <button
          onClick={copyAccount}
          disabled={!pickmeAccount}
          className="w-full text-left group"
        >
          <p className="text-[10px] uppercase tracking-widest text-yellow-300/90 font-semibold mb-1">
            Your Wallet Account Number
          </p>
          <div className="flex items-center justify-between gap-2 bg-white/10 backdrop-blur rounded-xl px-3 py-2 border border-yellow-300/30">
            <span className="font-mono font-black text-lg tracking-[0.15em] text-yellow-300">
              {pickmeAccount || "PMR••••••R"}
            </span>
            {copied ? (
              <Check className="h-4 w-4 text-yellow-300" />
            ) : (
              <Copy className="h-4 w-4 text-yellow-300/80 group-hover:text-yellow-300" />
            )}
          </div>
        </button>
      </div>
    </div>
  );
}
