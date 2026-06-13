import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import AdminGuard from "@/components/admin/AdminGuard";
import AdminLayout from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  Wallet, ArrowDownToLine, ArrowUpFromLine, ShieldAlert, RefreshCw,
  CheckCircle, XCircle, Flag, TrendingUp, Eye, Loader2,
  Lock, Unlock, Undo2, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import {
  adminApproveDeposit,
  adminApproveWithdrawalGo,
  adminFlagUser,
  adminLockWallet,
  adminRejectWithdrawalGo,
  adminResolveFraudFlag,
  adminReverseTransaction,
  adminUnlockWallet,
  getAdminWalletDashboard,
} from "@/lib/walletApi";

interface Tx {
  id: string;
  user_id: string;
  amount: number;
  transaction_type: string;
  description: string | null;
  reference_code: string | null;
  created_at: string;
}
interface Deposit {
  id: string; driver_id: string; amount_usd: number;
  ecocash_phone: string; ecocash_reference: string;
  proof_path: string | null; created_at: string; status: string;
}
interface Withdrawal {
  id: string; driver_id: string; amount_usd: number;
  method: string; destination: string; account_name: string | null;
  status: string; created_at: string;
}
interface FraudFlag {
  id: string; user_id: string; flag_type: string; severity: string;
  details: Record<string, unknown> | null; resolved: boolean; created_at: string;
}
interface FailedRide {
  id: string; user_id: string; fare: number;
  payment_failure_reason: string | null;
  pickup_address: string; dropoff_address: string;
  created_at: string;
}
interface LockedWallet {
  id: string; user_id: string; balance: number;
  locked_reason: string | null; locked_at: string | null;
}

function AdminWalletDashboardInner() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [failed, setFailed] = useState<FailedRide[]>([]);
  const [locked, setLocked] = useState<LockedWallet[]>([]);
  const [search, setSearch] = useState("");

  // Flag dialog state
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagUserId, setFlagUserId] = useState("");
  const [flagReason, setFlagReason] = useState("");
  const [flagSeverity, setFlagSeverity] = useState<"low"|"medium"|"high"|"critical">("medium");
  const [flagging, setFlagging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdminWalletDashboard();
      setTxs(data.transactions as Tx[]);
      setDeposits(data.deposits.map((row) => ({
        id: row.id,
        driver_id: row.driver_id ?? row.user_id ?? "",
        amount_usd: row.amount_usd,
        ecocash_phone: row.ecocash_phone ?? row.phone_number ?? "",
        ecocash_reference: row.ecocash_reference ?? row.reference ?? "",
        proof_path: row.proof_path,
        created_at: row.created_at,
        status: row.status,
      })));
      setWithdrawals(data.withdrawals.map((row) => ({
        id: row.id,
        driver_id: row.driver_id ?? row.user_id ?? "",
        amount_usd: row.amount_usd,
        method: row.method,
        destination: row.destination,
        account_name: row.account_name,
        status: row.status,
        created_at: row.created_at,
      })));
      setFlags(data.flags as unknown as FraudFlag[]);
      setFailed(data.failed_rides as unknown as FailedRide[]);
      setLocked(data.locked_wallets as unknown as LockedWallet[]);
    } catch (e) {
      toast.error((e as Error).message);
      setTxs([]);
      setDeposits([]);
      setWithdrawals([]);
      setFlags([]);
      setFailed([]);
      setLocked([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const approveDeposit = async (id: string) => {
    const data = await adminApproveDeposit(id, "Approved via wallet dashboard", "driver");
    if (!data.ok) return toast.error(data.reason || "Approval failed");
    toast.success("Deposit approved");
    load();
  };

  const approveWithdrawal = async (id: string) => {
    const data = await adminApproveWithdrawalGo(id, "Approved via wallet dashboard");
    if (!data.ok) return toast.error(data.reason || "Approval failed");
    toast.success("Withdrawal approved");
    load();
  };

  const rejectWithdrawal = async (id: string) => {
    const note = window.prompt("Reason for rejection?") || "Rejected";
    const data = await adminRejectWithdrawalGo(id, note);
    if (!data.ok) return toast.error(data.reason || "Rejection failed");
    toast.success("Withdrawal rejected & refunded");
    load();
  };

  const flagUser = async () => {
    if (!flagUserId.trim() || !flagReason.trim()) {
      return toast.error("User ID and reason required");
    }
    setFlagging(true);
    const data = await adminFlagUser(flagUserId.trim(), flagReason.trim(), flagSeverity);
    setFlagging(false);
    if (!data.ok) return toast.error(data.reason || "Flag failed");
    toast.success("User flagged");
    setFlagOpen(false); setFlagUserId(""); setFlagReason("");
    load();
  };

  const resolveFlag = async (id: string) => {
    const data = await adminResolveFraudFlag(id);
    if (!data.ok) return toast.error(data.reason || "Flag resolution failed");
    toast.success("Flag resolved");
    load();
  };

  const lockWallet = async (userId: string) => {
    const reason = window.prompt("Lock reason?") || "Admin lock";
    const data = await adminLockWallet(userId, reason);
    if (!data.ok) return toast.error(data.reason || "Lock failed");
    toast.success("Wallet locked");
    load();
  };

  const unlockWallet = async (userId: string) => {
    if (!window.confirm("Unlock this wallet?")) return;
    const data = await adminUnlockWallet(userId);
    if (!data.ok) return toast.error(data.reason || "Unlock failed");
    toast.success("Wallet unlocked");
    load();
  };

  const reverseTx = async (txId: string) => {
    const reason = window.prompt("Reason for reversal?");
    if (!reason) return;
    const r = await adminReverseTransaction(txId, reason) as { ok?: boolean; reason?: string; reference?: string };
    if (!r?.ok) return toast.error(r?.reason || "Reversal failed");
    toast.success(`Reversed (${r.reference})`);
    load();
  };

  const totalPending = deposits.reduce((s, d) => s + Number(d.amount_usd), 0);
  const totalWithdraw = withdrawals.reduce((s, w) => s + Number(w.amount_usd), 0);
  const totalTx24h = txs
    .filter(t => Date.now() - new Date(t.created_at).getTime() < 86400000)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  const filteredTxs = txs.filter(t =>
    !search || t.user_id.includes(search) || t.description?.toLowerCase().includes(search.toLowerCase())
  );

  const sevColor = (s: string) =>
    s === "critical" ? "bg-destructive text-destructive-foreground"
    : s === "high" ? "bg-orange-500/15 text-orange-700"
    : s === "medium" ? "bg-amber-500/15 text-amber-700"
    : "bg-muted text-muted-foreground";

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Wallet Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Monitor transactions, approve deposits & withdrawals, flag suspicious users
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setFlagOpen(true)}>
              <Flag className="h-4 w-4 mr-2" /> Flag User
            </Button>
            <Button variant="ghost" size="icon" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold">
                <Wallet className="h-3.5 w-3.5" /> 24h VOLUME
              </div>
              <div className="text-2xl font-black mt-1">${totalTx24h.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold">
                <ArrowDownToLine className="h-3.5 w-3.5" /> PENDING DEPOSITS
              </div>
              <div className="text-2xl font-black mt-1">{deposits.length}</div>
              <div className="text-xs text-muted-foreground">${totalPending.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold">
                <ArrowUpFromLine className="h-3.5 w-3.5" /> PENDING WITHDRAWALS
              </div>
              <div className="text-2xl font-black mt-1">{withdrawals.length}</div>
              <div className="text-xs text-muted-foreground">${totalWithdraw.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold">
                <ShieldAlert className="h-3.5 w-3.5" /> ACTIVE FLAGS
              </div>
              <div className="text-2xl font-black mt-1">{flags.length}</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="transactions">
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="deposits">Deposits ({deposits.length})</TabsTrigger>
            <TabsTrigger value="withdrawals">Withdrawals ({withdrawals.length})</TabsTrigger>
            <TabsTrigger value="failed">Failed ({failed.length})</TabsTrigger>
            <TabsTrigger value="locked">Locked ({locked.length})</TabsTrigger>
            <TabsTrigger value="flags">Flags ({flags.length})</TabsTrigger>
          </TabsList>

          {/* Transactions */}
          <TabsContent value="transactions" className="space-y-3">
            <Input
              placeholder="Search by user ID, description, or reference..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="bg-card rounded-xl border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left p-3">Date</th>
                    <th className="text-left p-3">Reference</th>
                    <th className="text-left p-3">User</th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-right p-3">Amount</th>
                    <th className="text-left p-3">Description</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxs.length === 0 && (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No transactions</td></tr>
                  )}
                  {filteredTxs.map(t => (
                    <tr key={t.id} className="border-t">
                      <td className="p-3 text-xs whitespace-nowrap">{format(new Date(t.created_at), "MMM d, HH:mm")}</td>
                      <td className="p-3 font-mono text-[11px]">{t.reference_code || "—"}</td>
                      <td className="p-3 font-mono text-xs">{t.user_id.slice(0, 8)}…</td>
                      <td className="p-3"><Badge variant="outline" className="capitalize">{t.transaction_type.replace("_", " ")}</Badge></td>
                      <td className={`p-3 text-right font-bold ${Number(t.amount) < 0 ? "text-destructive" : "text-emerald-600"}`}>
                        {Number(t.amount) >= 0 ? "+" : ""}${Number(t.amount).toFixed(2)}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground max-w-xs truncate">{t.description || "—"}</td>
                      <td className="p-3 text-right">
                        {t.transaction_type !== "reversal" && (
                          <Button size="sm" variant="ghost" onClick={() => reverseTx(t.id)} title="Reverse">
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Deposits */}
          <TabsContent value="deposits" className="space-y-3">
            {deposits.length === 0 && <div className="text-center py-8 text-muted-foreground">No pending deposits</div>}
            {deposits.map(d => (
              <Card key={d.id}>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xl font-black">${Number(d.amount_usd).toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.ecocash_phone} · Ref: {d.ecocash_reference} · {format(new Date(d.created_at), "MMM d, HH:mm")}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {d.proof_path && (
                      <Button size="sm" variant="outline"
                        onClick={async () => {
                          const { data } = await supabase.storage.from("deposit-proofs").createSignedUrl(d.proof_path!, 600);
                          if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                        }}>
                        <Eye className="h-4 w-4 mr-1" /> Proof
                      </Button>
                    )}
                    <Button size="sm" onClick={() => approveDeposit(d.id)}>
                      <CheckCircle className="h-4 w-4 mr-1" /> Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            <Button variant="outline" className="w-full" onClick={() => nav("/admin/rider-deposits")}>
              View Rider Deposits →
            </Button>
          </TabsContent>

          {/* Withdrawals */}
          <TabsContent value="withdrawals" className="space-y-3">
            {withdrawals.length === 0 && <div className="text-center py-8 text-muted-foreground">No pending withdrawals</div>}
            {withdrawals.map(w => (
              <Card key={w.id}>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xl font-black">${Number(w.amount_usd).toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {w.method} → <span className="font-mono">{w.destination}</span>
                      {w.account_name && ` (${w.account_name})`}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Driver: {w.driver_id.slice(0, 8)}… · {format(new Date(w.created_at), "MMM d, HH:mm")}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" onClick={() => rejectWithdrawal(w.id)}>
                      <XCircle className="h-4 w-4 mr-1" /> Reject
                    </Button>
                    <Button size="sm" onClick={() => approveWithdrawal(w.id)}>
                      <CheckCircle className="h-4 w-4 mr-1" /> Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* Failed Payments */}
          <TabsContent value="failed" className="space-y-3">
            {failed.length === 0 && <div className="text-center py-8 text-muted-foreground">No failed payments</div>}
            {failed.map(r => (
              <Card key={r.id}>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      <span className="text-lg font-black">${Number(r.fare).toFixed(2)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {r.pickup_address} → {r.dropoff_address}
                    </div>
                    <div className="text-[11px] text-destructive mt-1">{r.payment_failure_reason || "Payment failed"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      User: <span className="font-mono">{r.user_id.slice(0, 8)}…</span> · {format(new Date(r.created_at), "MMM d, HH:mm")}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => unlockWallet(r.user_id)}>
                    <Unlock className="h-4 w-4 mr-1" /> Unlock Wallet
                  </Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* Locked Wallets */}
          <TabsContent value="locked" className="space-y-3">
            {locked.length === 0 && <div className="text-center py-8 text-muted-foreground">No locked wallets</div>}
            {locked.map(w => (
              <Card key={w.id}>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Lock className="h-4 w-4 text-destructive" />
                      <span className="text-lg font-black">${Number(w.balance).toFixed(2)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      User: <span className="font-mono">{w.user_id.slice(0, 12)}…</span>
                    </div>
                    <div className="text-[11px] text-destructive mt-0.5">{w.locked_reason || "Locked"}</div>
                    {w.locked_at && (
                      <div className="text-[11px] text-muted-foreground">
                        Since {format(new Date(w.locked_at), "MMM d, HH:mm")}
                      </div>
                    )}
                  </div>
                  <Button size="sm" onClick={() => unlockWallet(w.user_id)}>
                    <Unlock className="h-4 w-4 mr-1" /> Unlock
                  </Button>
                </CardContent>
              </Card>
            ))}
            <div className="pt-2">
              <Button variant="outline" className="w-full" onClick={() => {
                const id = window.prompt("User ID to lock:");
                if (id?.trim()) lockWallet(id.trim());
              }}>
                <Lock className="h-4 w-4 mr-2" /> Lock a Wallet
              </Button>
            </div>
          </TabsContent>

          {/* Flags */}
          <TabsContent value="flags" className="space-y-3">
            {flags.length === 0 && <div className="text-center py-8 text-muted-foreground">No active fraud flags</div>}
            {flags.map(f => (
              <Card key={f.id}>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge className={sevColor(f.severity)}>{f.severity.toUpperCase()}</Badge>
                      <span className="font-semibold capitalize">{f.flag_type.replace(/_/g, " ")}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      User: <span className="font-mono">{f.user_id.slice(0, 12)}…</span> · {format(new Date(f.created_at), "MMM d, HH:mm")}
                    </div>
                    {f.details && (
                      <pre className="text-[11px] bg-muted/40 rounded-lg p-2 mt-1 max-w-md overflow-x-auto">
                        {JSON.stringify(f.details, null, 2)}
                      </pre>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => resolveFlag(f.id)}>
                    <CheckCircle className="h-4 w-4 mr-1" /> Resolve
                  </Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>

      {/* Flag User Dialog */}
      <Dialog open={flagOpen} onOpenChange={setFlagOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="h-5 w-5 text-destructive" /> Flag Suspicious User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">User ID</label>
              <Input value={flagUserId} onChange={(e) => setFlagUserId(e.target.value)}
                placeholder="UUID of user to flag" className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Severity</label>
              <Select value={flagSeverity} onValueChange={(v) => setFlagSeverity(v as typeof flagSeverity)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Reason</label>
              <Input value={flagReason} onChange={(e) => setFlagReason(e.target.value)}
                placeholder="Why is this user suspicious?" className="mt-1" maxLength={500} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFlagOpen(false)} disabled={flagging}>Cancel</Button>
            <Button variant="destructive" onClick={flagUser} disabled={flagging}>
              {flagging ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Flag className="h-4 w-4 mr-1" /> Flag User</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

export default function AdminWalletDashboard() {
  return (
    <AdminGuard>
      <AdminWalletDashboardInner />
    </AdminGuard>
  );
}
