/**
 * Developer-only admin page that visualizes RLS policies and SECURITY
 * DEFINER grants. The data is statically baked from our migrations and
 * the live RLS test suite — no DB queries are issued, so it loads
 * instantly and stays accurate even offline.
 *
 * Mounted at /admin/rls (admin-gated, dev-only surface).
 */
import { useMemo, useState } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import AdminGuard from "@/components/admin/AdminGuard";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Lock, CheckCircle2, XCircle, Search } from "lucide-react";

type Role = "anon" | "authenticated" | "driver" | "admin";
type Op = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "EXECUTE";

interface RowRule {
  resource: string;
  type: "table" | "rpc";
  notes?: string;
  // role -> allowed ops (with optional condition note)
  matrix: Partial<Record<Role, Partial<Record<Op, string | true>>>>;
}

// ─── Wallet & PIN surface ───
const RULES: RowRule[] = [
  {
    resource: "wallets",
    type: "table",
    notes: "Balance only readable by owner. Updates/deletes admin-only — money moves go through wallet RPCs.",
    matrix: {
      anon: {},
      authenticated: { SELECT: "user_id = auth.uid()", INSERT: "user_id = auth.uid()" },
      driver: { SELECT: "user_id = auth.uid()", INSERT: "user_id = auth.uid()" },
      admin: { SELECT: true, INSERT: true, UPDATE: true, DELETE: true },
    },
  },
  {
    resource: "driver_wallets",
    type: "table",
    notes: "Driver USD wallet. Updates/deletes admin-only.",
    matrix: {
      anon: {},
      authenticated: {},
      driver: { SELECT: "driver_id = auth.uid()", INSERT: "driver_id = auth.uid()" },
      admin: { SELECT: true, INSERT: true, UPDATE: true, DELETE: true },
    },
  },
  {
    resource: "wallet_pins",
    type: "table",
    notes: "Hashes never leave the server. Zero client policies — service role only.",
    matrix: {
      anon: {},
      authenticated: {},
      driver: {},
      admin: {},
    },
  },
  {
    resource: "deposit_requests",
    type: "table",
    notes: "Drivers see their own; admins see/manage all.",
    matrix: {
      anon: {},
      authenticated: {},
      driver: { SELECT: "own row", INSERT: "own row" },
      admin: { SELECT: true, INSERT: true, UPDATE: true, DELETE: true },
    },
  },
  // ─── Wallet RPCs (allowlisted SECURITY DEFINER) ───
  {
    resource: "transfer_funds",
    type: "rpc",
    notes: "CruiXe wallet → wallet transfer (riders).",
    matrix: {
      anon: {},
      authenticated: { EXECUTE: true },
      driver: { EXECUTE: true },
      admin: { EXECUTE: true },
    },
  },
  {
    resource: "request_withdrawal",
    type: "rpc",
    notes: "Driver-initiated EcoCash payout request.",
    matrix: {
      anon: {},
      authenticated: { EXECUTE: true },
      driver: { EXECUTE: true },
      admin: { EXECUTE: true },
    },
  },
  {
    resource: "pay_ride_from_wallet",
    type: "rpc",
    notes: "Charge a completed ride's fare against the rider's wallet.",
    matrix: {
      anon: {},
      authenticated: { EXECUTE: true },
      driver: { EXECUTE: true },
      admin: { EXECUTE: true },
    },
  },
  {
    resource: "request_wallet_ride",
    type: "rpc",
    notes: "Atomic balance check + ride creation.",
    matrix: {
      anon: {},
      authenticated: { EXECUTE: true },
      driver: { EXECUTE: true },
      admin: { EXECUTE: true },
    },
  },
  // ─── Locked-down internal RPCs ───
  ...[
    "generate_pickme_account",
    "set_pickme_account",
    "cleanup_throttle",
    "cleanup_old_messages",
    "expire_old_rides",
    "dispatch_scheduled_rides",
    "update_driver_rating_avg",
    "generate_referral_code",
    "handle_new_user",
    "handle_new_user_wallet",
    "update_updated_at_column",
    "set_ride_expiry",
    "complete_trip_and_charge_flat_r4",
    "check_rate_limit",
  ].map<RowRule>((fn) => ({
    resource: fn,
    type: "rpc",
    notes: "Internal trigger/cron — REVOKEd from clients.",
    matrix: { anon: {}, authenticated: {}, driver: {}, admin: { EXECUTE: true } },
  })),
  {
    resource: "lookup_user_by_pickme_account",
    type: "rpc",
    notes: "Used to resolve PMR…R numbers for transfers — auth required.",
    matrix: {
      anon: {},
      authenticated: { EXECUTE: true },
      driver: { EXECUTE: true },
      admin: { EXECUTE: true },
    },
  },
];

const ROLES: Role[] = ["anon", "authenticated", "driver", "admin"];
const OPS: Op[] = ["SELECT", "INSERT", "UPDATE", "DELETE", "EXECUTE"];

function Cell({ ops }: { ops: Partial<Record<Op, string | true>> | undefined }) {
  const list = ops ? Object.entries(ops) : [];
  if (list.length === 0) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground/60">
        <XCircle className="h-3.5 w-3.5" />
        <span className="text-xs">denied</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {list.map(([op, cond]) => (
        <Badge
          key={op}
          variant="secondary"
          className="text-[10px] font-mono px-1.5 py-0"
          title={typeof cond === "string" ? cond : "allowed"}
        >
          <CheckCircle2 className="h-3 w-3 mr-0.5" />
          {op}
        </Badge>
      ))}
    </div>
  );
}

const AdminRlsViewer = () => {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "table" | "rpc">("all");

  const filtered = useMemo(() => {
    return RULES.filter((r) => {
      if (filter !== "all" && r.type !== filter) return false;
      if (!q.trim()) return true;
      const hay = `${r.resource} ${r.notes ?? ""}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
  }, [q, filter]);

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="p-4 sm:p-6 space-y-6 max-w-[1400px] mx-auto">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">RLS & RPC Visualizer</h1>
              <p className="text-sm text-muted-foreground">
                Static view of which roles can perform which operations.
                Sourced from migrations + the live RLS test allowlist.
              </p>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Lock className="h-4 w-4" /> Wallet & PIN surface
                </CardTitle>
                <div className="flex gap-2 items-center">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter…"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      className="pl-8 h-8 w-48"
                    />
                  </div>
                  <div className="flex rounded-md border overflow-hidden text-xs">
                    {(["all", "table", "rpc"] as const).map((k) => (
                      <button
                        key={k}
                        onClick={() => setFilter(k)}
                        className={`px-2.5 py-1 ${
                          filter === k
                            ? "bg-primary text-primary-foreground"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {k.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 pr-4 min-w-[200px]">Resource</th>
                    <th className="text-left py-2 pr-2">Type</th>
                    {ROLES.map((r) => (
                      <th key={r} className="text-left py-2 px-2 min-w-[150px]">
                        {r}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={`${row.type}:${row.resource}`}
                      className="border-b last:border-0 hover:bg-muted/30 align-top"
                    >
                      <td className="py-2 pr-4">
                        <div className="font-mono text-xs font-medium">
                          {row.resource}
                        </div>
                        {row.notes && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 max-w-[260px]">
                            {row.notes}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <Badge variant={row.type === "rpc" ? "default" : "outline"} className="text-[10px]">
                          {row.type.toUpperCase()}
                        </Badge>
                      </td>
                      {ROLES.map((r) => (
                        <td key={r} className="py-2 px-2">
                          <Cell ops={row.matrix[r]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={2 + ROLES.length} className="text-center py-8 text-muted-foreground text-sm">
                        No rules match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Operations key</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1">
              {OPS.map((op) => (
                <div key={op}>
                  <span className="font-mono font-semibold text-foreground">{op}</span>{" "}
                  — {op === "EXECUTE" ? "callable as an RPC" : `permission on rows (${op.toLowerCase()})`}
                </div>
              ))}
              <p className="pt-2">
                Source of truth: <code>supabase/migrations/*.sql</code> +{" "}
                <code>src/test/walletRlsLive.test.ts</code>. To change a rule, edit
                a migration and the corresponding test, then regenerate this page.
              </p>
            </CardContent>
          </Card>
        </div>
      </AdminLayout>
    </AdminGuard>
  );
};

export default AdminRlsViewer;
