import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send, Search, User as UserIcon, Hash, Phone } from "lucide-react";
import { toast } from "sonner";
import { transferFunds, lookupUserByPhone, lookupUserByPickmeAccount } from "@/lib/walletPayments";
import { useWalletPin } from "@/hooks/useWalletPin";
import WalletPinModal from "./WalletPinModal";
import { cn } from "@/lib/utils";

interface TransferMoneyModalProps {
  isOpen: boolean;
  onClose: () => void;
  balance: number;
  onSuccess?: () => void;
}

type LookupMode = "account" | "phone";

export default function TransferMoneyModal({ isOpen, onClose, balance, onSuccess }: TransferMoneyModalProps) {
  const [mode, setMode] = useState<LookupMode>("account");
  const [query, setQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [recipient, setRecipient] = useState<{ user_id: string; full_name: string | null; pickme_account?: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  const { hasPin, verifyPin, setPin } = useWalletPin();

  const numAmount = Number(amount) || 0;

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      let r: { user_id: string; full_name: string | null; pickme_account?: string } | null = null;
      if (mode === "account") {
        r = await lookupUserByPickmeAccount(query.trim());
      } else {
        const phoneRes = await lookupUserByPhone(query.trim());
        if (phoneRes) r = { user_id: phoneRes.user_id, full_name: phoneRes.full_name };
      }
      if (r) {
        setRecipient(r);
        toast.success(`Found: ${r.full_name || "User"}`);
      } else {
        setRecipient(null);
        toast.error(mode === "account" ? "No CruiXe account matches" : "No user with that phone");
      }
    } finally {
      setSearching(false);
    }
  };

  const reset = () => {
    setQuery(""); setAmount(""); setNote(""); setRecipient(null);
  };

  const doTransfer = async () => {
    setLoading(true);
    try {
      const res = await transferFunds(recipient!.user_id, numAmount, note.trim() || undefined);
      if (res?.ok) {
        toast.success(`Sent $${numAmount.toFixed(2)} to ${recipient!.full_name || "user"}`);
        onSuccess?.();
        reset();
        onClose();
      } else {
        toast.error(res?.reason || "Transfer failed");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!recipient) return toast.error("Select a recipient first");
    if (numAmount <= 0) return toast.error("Enter an amount");
    if (numAmount > balance) return toast.error("Insufficient balance");
    if (numAmount > 500) return toast.error("Maximum $500 per transfer");
    setPinOpen(true);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Send to CruiXe Wallet</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-muted/40 rounded-2xl p-3 text-center">
              <div className="text-xs text-muted-foreground">Your balance</div>
              <div className="text-2xl font-black">${balance.toFixed(2)}</div>
            </div>

            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-1 bg-muted rounded-xl p-1">
              <button
                onClick={() => { setMode("account"); setRecipient(null); setQuery(""); }}
                className={cn(
                  "flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors",
                  mode === "account" ? "bg-background shadow-sm" : "text-muted-foreground"
                )}
              >
                <Hash className="h-3.5 w-3.5" /> CruiXe Account
              </button>
              <button
                onClick={() => { setMode("phone"); setRecipient(null); setQuery(""); }}
                className={cn(
                  "flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors",
                  mode === "phone" ? "bg-background shadow-sm" : "text-muted-foreground"
                )}
              >
                <Phone className="h-3.5 w-3.5" /> Phone
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground">
                {mode === "account" ? "CruiXe Account number" : "Recipient phone"}
              </label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={query}
                  onChange={(e) => {
                    const v = mode === "account" ? e.target.value.toUpperCase() : e.target.value;
                    setQuery(v); setRecipient(null);
                  }}
                  placeholder={mode === "account" ? "PMR123456R" : "0771234567"}
                  className="h-11 font-mono"
                  maxLength={mode === "account" ? 11 : 15}
                />
                <Button onClick={search} disabled={searching || !query.trim()} variant="outline" className="h-11">
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              {recipient && (
                <div className="mt-2 p-2.5 rounded-2xl bg-primary/10 flex items-center gap-2">
                  <UserIcon className="h-4 w-4 text-primary" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{recipient.full_name || "User"}</div>
                    {recipient.pickme_account && (
                      <div className="text-[10px] font-mono text-muted-foreground">{recipient.pickme_account}</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground">Amount (USD)</label>
              <Input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="mt-1 h-11 text-lg font-semibold"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground">Note (optional)</label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={80}
                placeholder="What for?"
                className="mt-1 h-11"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleSend}
                disabled={loading || !recipient || numAmount <= 0}
              >
                <Send className="h-4 w-4 mr-2" />
                Send
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <WalletPinModal
        isOpen={pinOpen}
        onClose={() => setPinOpen(false)}
        onVerified={() => { setPinOpen(false); doTransfer(); }}
        mode={hasPin ? "verify" : "setup"}
        onVerifyPin={verifyPin}
        onSetPin={setPin}
      />
    </>
  );
}
