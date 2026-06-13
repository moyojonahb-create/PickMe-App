import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle, Eye, RefreshCw, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import AdminGuard from "@/components/admin/AdminGuard";
import { adminApproveDeposit, adminListDeposits, adminRejectDeposit } from "@/lib/walletApi";

interface RiderDepositRow {
  id: string;
  user_id: string;
  amount_usd: number;
  payment_method: string;
  phone_number: string;
  reference: string;
  proof_path: string | null;
  created_at: string;
  status: string;
}

function AdminRiderDepositsInner() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RiderDepositRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminListDeposits("rider", "pending", 50);
      setRows(data.map((row) => ({
        id: row.id,
        user_id: row.user_id ?? "",
        amount_usd: row.amount_usd,
        payment_method: row.payment_method ?? "deposit",
        phone_number: row.phone_number ?? row.ecocash_phone ?? "",
        reference: row.reference ?? row.ecocash_reference ?? "",
        proof_path: row.proof_path,
        created_at: row.created_at,
        status: row.status,
      })));
    } catch (e) {
      toast.error((e as Error).message);
      setRows([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const viewProof = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("rider-deposit-proofs")
      .createSignedUrl(path, 600);
    if (error) { toast.error("Could not load proof"); return; }
    window.open(data.signedUrl, "_blank");
  };

  const approve = async (id: string) => {
    const data = await adminApproveDeposit(id, "Approved", "rider");
    if (!data.ok) { toast.error(data.reason || "Approval failed"); return; }
    toast.success("Rider deposit approved & wallet credited!");
    await load();
  };

  const reject = async (id: string) => {
    const data = await adminRejectDeposit(id, "Rejected by admin", "rider");
    if (!data.ok) { toast.error(data.reason || "Deposit rejection failed"); return; }
    toast.success("Deposit rejected");
    await load();
  };

  const methodLabel = (m: string) => {
    const map: Record<string, string> = {
      ecocash: 'EcoCash', onemoney: 'OneMoney', telecash: 'Telecash',
      innbucks: 'InnBucks', zimswitch: 'ZimSwitch', mukuru: 'Mukuru',
      bank_transfer: 'Bank Transfer',
    };
    return map[m] || m;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Rider Deposits</h1>
        <Button variant="ghost" size="icon" onClick={load} className="ml-auto" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="p-4 space-y-3 max-w-lg mx-auto">
        {rows.length === 0 && !loading && (
          <div className="text-center py-12 text-muted-foreground">No pending rider deposits.</div>
        )}

        {rows.map((r) => (
          <div key={r.id} className="bg-card rounded-xl p-4 border space-y-2">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-lg font-black">${Number(r.amount_usd).toFixed(2)}</div>
                <span className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full font-medium">
                  {methodLabel(r.payment_method)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground text-right">
                {format(new Date(r.created_at), 'dd MMM yyyy, HH:mm')}
              </div>
            </div>
            <div className="text-sm text-muted-foreground">Phone: {r.phone_number}</div>
            <div className="text-sm text-muted-foreground">Ref: {r.reference}</div>
            <div className="flex gap-2 pt-1 flex-wrap">
              {r.proof_path && (
                <Button variant="outline" size="sm" onClick={() => viewProof(r.proof_path!)}>
                  <Eye className="h-4 w-4 mr-1" /> Proof
                </Button>
              )}
              <Button size="sm" onClick={() => approve(r.id)}>
                <CheckCircle className="h-4 w-4 mr-1" /> Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={() => reject(r.id)}>
                <XCircle className="h-4 w-4 mr-1" /> Reject
              </Button>
            </div>
          </div>
        ))}

        {loading && <div className="text-center text-muted-foreground text-sm py-4">Loading…</div>}
      </div>
    </div>
  );
}

export default function AdminRiderDepositsPage() {
  return (
    <AdminGuard>
      <AdminRiderDepositsInner />
    </AdminGuard>
  );
}
