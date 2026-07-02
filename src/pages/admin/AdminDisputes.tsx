import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import AdminGuard from '@/components/admin/AdminGuard';
import AdminLayout from '@/components/admin/AdminLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle, Clock, MessageSquare, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { adminUpdateDispute } from '@/lib/businessApi';

interface Dispute {
  id: string;
  ride_id: string;
  reporter_id: string;
  reporter_role: string;
  category: string;
  description: string;
  status: string;
  admin_response: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700',
  investigating: 'bg-blue-100 text-blue-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  dismissed: 'bg-gray-100 text-gray-700',
};

const categoryLabels: Record<string, string> = {
  fare_dispute: '💰 Fare Issue',
  route_issue: '🗺️ Route Problem',
  safety_concern: '🛡️ Safety Concern',
  late_arrival: '⏰ Late Arrival',
  other: '📋 Other',
};

export default function AdminDisputes() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<string | null>(null);
  const [response, setResponse] = useState('');
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    const query = supabase
      .from('disputes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (filter === 'open') {
      query.in('status', ['open', 'investigating']);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Failed to fetch disputes:', error);
      toast.error('Failed to load disputes');
    }
    setDisputes(data || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  const handleResolve = async (disputeId: string, status: 'resolved' | 'dismissed') => {
    setResponding(disputeId);
    try {
      await adminUpdateDispute(disputeId, {
        status,
        admin_response: response || null,
        resolved_at: new Date().toISOString(),
      });
      toast.success(`Dispute ${status}`);
      setResponse('');
      setResponding(null);
      fetchDisputes();
    } catch (err) {
      console.error('Failed to update dispute:', err);
      toast.error('Failed to update dispute');
    } finally {
      setResponding(null);
    }
  };

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Disputes</h1>
              <p className="text-muted-foreground text-sm">{disputes.length} {filter === 'open' ? 'open' : 'total'} disputes</p>
            </div>
            <div className="flex gap-2">
              <Button variant={filter === 'open' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('open')}>
                Open
              </Button>
              <Button variant={filter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('all')}>
                All
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : disputes.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="w-12 h-12 mx-auto text-emerald-500 mb-4" />
              <h2 className="text-lg font-semibold">No open disputes</h2>
              <p className="text-muted-foreground">All clear!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {disputes.map((d) => (
                <div key={d.id} className="bg-card rounded-xl border border-border p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="font-semibold text-sm">{categoryLabels[d.category] || d.category}</span>
                      <Badge variant="outline" className="text-xs capitalize">{d.reporter_role}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={cn('capitalize text-xs', statusColors[d.status])}>{d.status}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(d.created_at), 'MMM d, HH:mm')}
                      </span>
                    </div>
                  </div>

                  <p className="text-sm text-foreground">{d.description}</p>

                  <div className="text-xs text-muted-foreground">
                    Ride: {d.ride_id.substring(0, 8)} • Reporter: {d.reporter_id.substring(0, 8)}
                  </div>

                  {d.admin_response && (
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Admin Response</p>
                      <p className="text-sm">{d.admin_response}</p>
                    </div>
                  )}

                  {(d.status === 'open' || d.status === 'investigating') && (
                    <div className="space-y-2 pt-2 border-t border-border">
                      <Textarea
                        placeholder="Add a response (optional)..."
                        value={responding === d.id ? response : ''}
                        onChange={(e) => { setResponding(d.id); setResponse(e.target.value); }}
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleResolve(d.id, 'resolved')}
                          disabled={responding === d.id && !response}
                          className="gap-1.5"
                        >
                          {responding === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                          Resolve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleResolve(d.id, 'dismissed')}
                        >
                          Dismiss
                        </Button>
                        {d.status === 'open' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={async () => {
                              await adminUpdateDispute(d.id, { status: 'investigating' });
                              fetchDisputes();
                            }}
                            className="gap-1.5"
                          >
                            <Clock className="h-3.5 w-3.5" />
                            Investigating
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </AdminLayout>
    </AdminGuard>
  );
}
