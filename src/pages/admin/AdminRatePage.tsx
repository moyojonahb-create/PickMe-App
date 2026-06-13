import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import AdminGuard from "@/components/admin/AdminGuard";
import { adminSetFxRate } from "@/lib/walletApi";

function AdminRatePageInner() {
  const navigate = useNavigate();
  const [zarPerUsd, setZarPerUsd] = useState("16");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const rate = Number(zarPerUsd);
      if (!isFinite(rate) || rate <= 0) throw new Error("Enter a valid number e.g. 16");

      const data = await adminSetFxRate(rate);
      if (!data.ok) throw new Error(data.reason || "Failed to save rate");

      toast.success(`Saved: $1 = ${rate} ZAR`);
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Update Daily Rate</h1>
      </div>

      <div className="p-4 space-y-4 max-w-md mx-auto">
        <div>
          <label className="text-sm font-medium">$1 = X ZAR</label>
          <Input
            value={zarPerUsd}
            onChange={(e) => setZarPerUsd(e.target.value)}
            type="number"
            min="1"
            className="mt-1"
          />
        </div>
        <Button onClick={save} disabled={busy} className="w-full" size="lg">
          {busy ? "Saving..." : "Save Rate"}
        </Button>
      </div>
    </div>
  );
}

export default function AdminRatePage() {
  return (
    <AdminGuard>
      <AdminRatePageInner />
    </AdminGuard>
  );
}
