import { useEffect, useState } from 'react';
import { Search, Filter, BookOpen } from 'lucide-react';
import AdminLayout from '@/components/admin/AdminLayout';
import AdminGuard from '@/components/admin/AdminGuard';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { adminListLedger } from '@/lib/walletApi';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface LedgerRow {
  id: string;
  trip_id: string;
  driver_id: string | null;
  passenger_id: string | null;
  amount: number;
  currency: string;
  status: string;
  to_account_id: string;
  created_at: string;
}

const AdminLedger = () => {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('all');

  useEffect(() => {
    const fetchLedger = async () => {
      setLoading(true);
      const data = await adminListLedger(dateFilter);
      setRows(data || []);
      setLoading(false);
    };
    fetchLedger();
  }, [dateFilter]);

  const filtered = rows.filter(r =>
    !search || r.trip_id.includes(search) || r.driver_id?.includes(search) || r.passenger_id?.includes(search)
  );

  const totalAmount = filtered.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Platform Ledger</h1>
            <p className="text-muted-foreground">All settled trips • Total: ${totalAmount.toFixed(2)} ({filtered.length} entries)</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by trip, driver, or passenger ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-[140px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No settlements found</p>
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 font-semibold">Date</th>
                    <th className="text-left p-3 font-semibold">Trip ID</th>
                    <th className="text-left p-3 font-semibold">Amount</th>
                    <th className="text-left p-3 font-semibold">Currency</th>
                    <th className="text-left p-3 font-semibold">Status</th>
                    <th className="text-left p-3 font-semibold">Account</th>
                    <th className="text-left p-3 font-semibold">Driver</th>
                    <th className="text-left p-3 font-semibold">Passenger</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-border hover:bg-secondary/50">
                      <td className="p-3">{format(new Date(r.created_at), 'MMM d, HH:mm')}</td>
                      <td className="p-3 font-mono text-xs">{r.trip_id.slice(0, 8)}…</td>
                      <td className="p-3 font-bold">${Number(r.amount).toFixed(2)}</td>
                      <td className="p-3">{r.currency}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="bg-emerald-100 text-emerald-700">{r.status}</Badge>
                      </td>
                      <td className="p-3 font-mono text-xs">{r.to_account_id}</td>
                      <td className="p-3 font-mono text-xs">{r.driver_id?.slice(0, 8) ?? '—'}</td>
                      <td className="p-3 font-mono text-xs">{r.passenger_id?.slice(0, 8) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </AdminLayout>
    </AdminGuard>
  );
};

export default AdminLedger;
