import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { ArrowLeft, CheckCircle, Clock, UserCircle } from 'lucide-react';
import { goBackend } from '@/lib/goBackendClient';
import { fetchPendingOffers } from '@/lib/offerHelpers';
import { isRequestedRideStatus, normalizeRideRow } from '@/lib/rideContract';

type RideRequest = {
  id: string;
  pickup: string;
  dropoff: string;
  offered_fare: number;
  currency: string;
  status: string;
};

type RideOffer = {
  id: string;
  request_id: string;
  driver_id: string;
  offer_fare: number;
  status: string;
  created_at: string;
};

export default function RiderOffersScreen() {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [request, setRequest] = useState<RideRequest | null>(null);
  const [offers, setOffers] = useState<RideOffer[]>([]);
  const [acceptedRideId, setAcceptedRideId] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Load request details
  useEffect(() => {
    if (!requestId) return;
    goBackend
      .get<Record<string, unknown>>(`/api/rides/${requestId}`)
      .then((data) => {
        const ride = normalizeRideRow(data);
        setRequest({
          id: String(ride.id),
          pickup: String(ride.pickup_address ?? ride.pickup_location ?? ''),
          dropoff: String(ride.dropoff_address ?? ride.dropoff_location ?? ''),
          offered_fare: Number(ride.fare ?? ride.estimated_fare ?? 0),
          currency: 'USD',
          status: ride.status,
        });
      })
      .catch((error) => {
        toast({ title: 'Error loading ride', description: (error as Error).message, variant: 'destructive' });
      });
  }, [requestId]);

  // Load offers — stable ref to avoid stale closures in realtime
  const loadOffers = useCallback(async () => {
    if (!requestId) return;
    const data = await fetchPendingOffers(requestId);
    setOffers(data.map((offer) => ({
      id: offer.id,
      request_id: offer.ride_id,
      driver_id: offer.driver_id,
      offer_fare: offer.price,
      status: offer.status,
      created_at: offer.created_at,
    })));
  }, [requestId]);

  const loadOffersRef = useRef(loadOffers);
  useEffect(() => { loadOffersRef.current = loadOffers; }, [loadOffers]);

  useEffect(() => {
    loadOffers();
  }, [loadOffers]);

  // Realtime subscription — uses ref to avoid stale closure
  useEffect(() => {
    if (!requestId) return;

    const channel = supabase
      .channel(`rider-offers-realtime-${requestId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ride_offers', filter: `ride_id=eq.${requestId}` },
        () => { loadOffersRef.current(); }
      )
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [requestId]);

  async function handleAccept(offer: RideOffer) {
    if (!user || !request) return;
    setAccepting(offer.id);

    try {
      const data = await goBackend.post<{ id?: string; ride_id?: string; ride?: { id?: string } }>(
        `/api/rides/${requestId}/offers/${offer.id}/accept`
      );
      const rideId = data.ride_id ?? data.ride?.id ?? data.id ?? requestId;
      setAcceptedRideId(rideId ?? null);
      toast({ title: 'Ride Accepted!', description: `Driver's offer of $${offer.offer_fare} accepted.` });
    } catch (e: unknown) {
      toast({ title: 'Error accepting ride', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setAccepting(null);
    }
  }

  if (acceptedRideId) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <CheckCircle className="w-16 h-16 text-primary mb-4" />
        <h2 className="text-2xl font-bold text-foreground mb-2">Ride Accepted!</h2>
        <p className="text-muted-foreground mb-1">Your ride is confirmed.</p>
        <p className="text-xs text-muted-foreground font-mono bg-muted px-3 py-1 rounded-lg mt-2">
          Ride ID: {acceptedRideId}
        </p>
        <Button className="mt-8 w-full max-w-xs" onClick={() => navigate('/')}>
          Back to Home
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <button onClick={() => navigate(-1)} className="p-1 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="text-lg font-bold text-foreground">Driver Offers</h1>
        <span className="ml-auto flex items-center gap-1 text-xs text-primary">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          Live
        </span>
      </div>

      {/* Request Summary */}
      {request && (
        <div className="m-4 p-4 bg-muted rounded-2xl space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Your Request</p>
          <p className="text-sm font-semibold text-foreground">📍 {request.pickup}</p>
          <p className="text-sm font-semibold text-foreground">🏁 {request.dropoff}</p>
          <p className="text-sm text-muted-foreground">
            Offered: <span className="font-bold text-foreground">${Number(request.offered_fare).toFixed(2)}</span>
          </p>
          {isRequestedRideStatus(request.status) && (
            <p className="text-xs text-primary flex items-center gap-1 mt-1">
              <Clock className="w-3 h-3" /> Waiting for driver offers…
            </p>
          )}
        </div>
      )}

      {/* Offers List */}
      <div className="flex-1 px-4 pb-6 space-y-3">
        {offers.length === 0 ? (
          <div className="text-center py-12">
            <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No offers yet. Drivers will appear here in real time.</p>
          </div>
        ) : (
          offers.map(offer => (
            <div
              key={offer.id}
              className={`p-4 rounded-2xl border transition-all ${
                offer.status === 'accepted'
                  ? 'border-primary bg-primary/5'
                  : offer.status === 'rejected'
                  ? 'border-border bg-muted opacity-50'
                  : 'border-border bg-background'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <UserCircle className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Driver's Offer</p>
                    <p className="text-xl font-bold text-foreground">${offer.offer_fare}</p>
                  </div>
                </div>
                {offer.status === 'pending' && isRequestedRideStatus(request?.status) && (
                  <Button
                    size="sm"
                    onClick={() => handleAccept(offer)}
                    disabled={!!accepting}
                  >
                    {accepting === offer.id ? 'Accepting…' : 'Accept'}
                  </Button>
                )}
                {offer.status === 'accepted' && (
                  <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-1 rounded-full">
                    Accepted ✓
                  </span>
                )}
                {offer.status === 'rejected' && (
                  <span className="text-xs text-muted-foreground">Rejected</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {new Date(offer.created_at).toLocaleTimeString()}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
