import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, RefreshCw, Smartphone, Building2, Banknote } from "lucide-react";
import AdminLayout from "@/components/admin/AdminLayout";
import { toast } from "sonner";
import { format } from "date-fns";
import { adminApproveWithdrawal, adminRejectWithdrawal } from "@/lib/walletPayments";
import { adminListWithdrawals } from "@/lib/walletApi";

interface WithdrawalRow {
  id: string;
  driver_id: string;
  amount_usd: number;
  method: string;
  destination: string;
  account_name: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
}

const ICONS: Record<string, typeof Smartphone> = {
  ecocash: Smartphone,
  innbucks: Banknote,
  bank: Building2,
};

export default function AdminWithdrawalsPage() {
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected">("pending");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminListWithdrawals(filter, 100);
      setRows(data.map((row) => ({
        id: row.id,
        driver_id: row.driver_id ?? row.user_id ?? "",
        amount_usd: row.amount_usd,
        method: row.method,
        destination: row.destination,
        account_name: row.account_name,
        status: row.status,
        admin_note: row.admin_note ?? null,
        created_at: row.created_at,
      })));
    } catch (e) {
      toast.error((e as Error).message);
      setRows([]);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    try {
      const res = await adminApproveWithdrawal(id, "Approved");
      if (res.ok) { toast.success("Withdrawal approved"); load(); }
      else toast.error(res.reason || "Failed");
    } catch (e) { toast.error((e as Error).message); }
  };

  const reject = async (id: string) => {
    const note = window.prompt("Reason for rejection?") || "Rejected";
    try {
      const res = await adminRejectWithdrawal(id, note);
      if (res.ok) { toast.success(`Rejected and refunded $${res.refunded?.toFixed(2)}`); load(); }
      else toast.error(res.reason || "Failed");
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Driver Withdrawals</h1>
          <Button variant="ghost" size="icon" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="flex gap-2">
          {(["pending", "approved", "rejected"] as const).map((s) => (
            <Button
              key={s}
              variant={filter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(s)}
              className="capitalize"
            >
              {s}
            </Button>
          ))}
        </div>

        {rows.length === 0 && !loading && (
          <div className="text-center py-12 text-muted-foreground">No {filter} withdrawals.</div>
        )}

        <div className="space-y-3">
          {rows.map((r) => {
            const Icon = ICONS[r.method] || Banknote;
            return (
              <div key={r.id} className="bg-card rounded-2xl p-4 border space-y-2">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="text-xl font-black">${Number(r.amount_usd).toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground capitalize">{r.method}</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(r.created_at), "dd MMM, HH:mm")}
                  </div>
                </div>

                <div className="text-sm">
                  <div className="font-mono font-semibold">{r.destination}</div>
                  {r.account_name && <div className="text-xs text-muted-foreground">{r.account_name}</div>}
                  <div className="text-[11px] text-muted-foreground mt-1">Driver: {r.driver_id.slice(0, 8)}…</div>
                </div>

                {r.admin_note && (
                  <div className="text-xs bg-muted/50 rounded-lg p-2">{r.admin_note}</div>
                )}

                {filter === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="destructive" onClick={() => reject(r.id)} className="flex-1">
                      <XCircle className="h-4 w-4 mr-1" /> Reject
                    </Button>
                    <Button size="sm" onClick={() => approve(r.id)} className="flex-1">
                      <CheckCircle className="h-4 w-4 mr-1" /> Approve
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AdminLayout>
  );
}
