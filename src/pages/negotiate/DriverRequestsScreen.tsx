import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, MapPin, Navigation, RefreshCw } from 'lucide-react';
import { goBackend } from '@/lib/goBackendClient';
import { decimalToMinor } from '@/lib/money';

type RideRequest = {
  id: string;
  pickup: string;
  dropoff: string;
  offered_fare: number;
  currency: string;
  status: string;
  created_at: string;
};

export default function DriverRequestsScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [requests, setRequests] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [offerFares, setOfferFares] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [isTopDriver, setIsTopDriver] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoading(true);

    // Check if top driver
    if (user) {
      const { data: topStatus } = await supabase.rpc("is_top_driver", { _user_id: user.id });
      setIsTopDriver(!!topStatus);
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('ride_requests')
      .select('*')
      .eq('status', 'negotiating')
      .gte('created_at', fiveMinutesAgo)
      .order('created_at', { ascending: false });

    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else {
      let results = (data ?? []) as RideRequest[];
      // Non-top drivers only see requests older than 30 seconds
      if (!isTopDriver) {
        const thirtySecsAgo = Date.now() - 30_000;
        results = results.filter(r => new Date(r.created_at).getTime() <= thirtySecsAgo);
      }
      setRequests(results);
    }
    setLoading(false);
  }, [user, isTopDriver]);

  const loadRequestsRef = useRef(loadRequests);
  useEffect(() => { loadRequestsRef.current = loadRequests; }, [loadRequests]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  // Realtime: auto-refresh when ride_requests change
  useEffect(() => {
    const channel = supabase
      .channel(`driver-requests-realtime-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ride_requests' },
        () => { loadRequestsRef.current(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function sendOffer(requestId: string) {
    if (!user) {
      toast({ title: 'Not logged in', variant: 'destructive' });
      return;
    }
    const fareStr = offerFares[requestId];
    const fare = parseFloat(fareStr ?? '');
    if (isNaN(fare) || fare <= 0) {
      toast({ title: 'Invalid fare', description: 'Enter a valid offer amount.', variant: 'destructive' });
      return;
    }

    setSending(requestId);
    try {
      await goBackend.post(`/api/rides/${requestId}/offers`, {
        offer_fare_minor: decimalToMinor(fare),
        price_minor: decimalToMinor(fare),
        status: 'pending',
      });
      toast({ title: 'Offer sent!', description: `Your offer of $${fare} was submitted.` });
      setOfferFares(prev => ({ ...prev, [requestId]: '' }));
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <button onClick={() => navigate(-1)} className="p-1 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="text-lg font-bold text-foreground">Open Ride Requests</h1>
        <button
          onClick={() => loadRequests()}
          className="ml-auto p-1.5 rounded-lg hover:bg-muted transition-colors"
        >
          <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 px-4 py-4 space-y-3">
        {loading ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Loading requests…</div>
        ) : requests.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm">No open ride requests right now.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={loadRequests}>
              Refresh
            </Button>
          </div>
        ) : (
          requests.map(req => (
            <div key={req.id} className="p-4 rounded-2xl border border-border bg-background space-y-3">
              {/* Trip details */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                  {new Date(req.created_at).toLocaleTimeString()}
                </p>
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-sm font-semibold text-foreground">{req.pickup}</p>
                </div>
                <div className="flex items-start gap-2">
                  <Navigation className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <p className="text-sm font-semibold text-foreground">{req.dropoff}</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Rider offering:{' '}
                  <span className="font-bold text-foreground">
                    ${req.offered_fare.toFixed(2)}
                  </span>
                </p>
              </div>

              {/* Offer input */}
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Your fare ($)"
                  min="0.01"
                  step="0.01"
                  value={offerFares[req.id] ?? ''}
                  onChange={e =>
                    setOfferFares(prev => ({ ...prev, [req.id]: e.target.value }))
                  }
                  className="flex-1"
                />
                <Button
                  size="default"
                  onClick={() => sendOffer(req.id)}
                  disabled={sending === req.id || !offerFares[req.id]}
                >
                  {sending === req.id ? 'Sending…' : 'Send Offer'}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
