import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { walletCreateDriverDeposit } from "@/lib/backendClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const ECASH_NUMBER = "+263 778 553 169";

export default function DriverDepositPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [amount, setAmount] = useState("5");
  const [phone, setPhone] = useState("");
  const [ref, setRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!user) { toast.error("Please sign in"); return; }
    setBusy(true);
    try {
      const amt = Number(amount);
      if (!isFinite(amt) || amt <= 0) throw new Error("Enter a valid USD amount.");
      if (!phone.trim()) throw new Error("Enter EcoCash phone used.");
      if (!ref.trim()) throw new Error("Enter EcoCash reference.");
      if (!file) throw new Error("Please upload proof of payment.");

      // Upload proof
      const safeName = file.name.split(" ").join("_");
      const path = `${user.id}/${Date.now()}_${safeName}`;
      const up = await supabase.storage.from("deposit-proofs").upload(path, file, { upsert: false });
      if (up.error) throw up.error;

      // Create request via Go (Phase B: wallet writes are backend-owned)
      const res = await walletCreateDriverDeposit({
        amount_usd: amt,
        ecocash_phone: phone.trim(),
        ecocash_reference: ref.trim(),
        proof_path: path,
      });
      if (!res?.ok) throw new Error(res?.reason || "Failed to submit deposit");

      toast.success("Deposit request submitted! Admin will verify and credit your wallet.");
      setRef("");
      setFile(null);
      navigate("/drivers/wallet");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to submit deposit request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Deposit via EcoCash (USD)</h1>
      </div>

      <div className="p-4 space-y-4 max-w-md mx-auto">
        {/* Instructions */}
        <div className="bg-muted/50 rounded-xl p-4 border">
          <div className="font-bold text-sm mb-2">Instructions</div>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Pay USD EcoCash to: <span className="font-bold text-foreground">{ECASH_NUMBER}</span></li>
            <li>Use reference: <span className="font-bold text-foreground">Your Name + Phone</span></li>
            <li>Take a screenshot/photo of the confirmation</li>
            <li>Upload proof below and submit</li>
          </ol>
        </div>

        {/* Form */}
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Amount (USD)</label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="1" />
          </div>
          <div>
            <label className="text-sm font-medium">EcoCash phone used</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+263..." />
          </div>
          <div>
            <label className="text-sm font-medium">EcoCash reference</label>
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transaction reference" />
          </div>
          <div>
            <label className="text-sm font-medium">Proof of payment</label>
            <div className="mt-1">
              <label className="flex items-center gap-2 px-4 py-3 border-2 border-dashed rounded-xl cursor-pointer hover:bg-muted/30 transition-colors">
                <Upload className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {file ? file.name : "Upload screenshot/photo"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          </div>

          <Button onClick={submit} disabled={busy} className="w-full" size="lg">
            {busy ? "Submitting..." : "Submit deposit request"}
          </Button>
        </div>
      </div>
    </div>
  );
}
