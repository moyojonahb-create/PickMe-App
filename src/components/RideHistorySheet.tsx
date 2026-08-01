import { forwardRef, useState, useEffect } from 'react';
import { Clock, MapPin, ArrowRight, Loader2, ReceiptText, RotateCcw } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import PaymentStatusBadge from '@/components/ride/PaymentStatusBadge';

interface Ride {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lon: number;
  dropoff_lat: number;
  dropoff_lon: number;
  distance_km: number;
  duration_minutes: number;
  fare: number;
  status: string;
  created_at: string;
  vehicle_type: string;
  passenger_count: number;
  payment_method?: string | null;
  wallet_paid?: boolean | null;
  payment_failed?: boolean | null;
  payment_failure_reason?: string | null;
}

interface RideHistorySheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const statusColors: Record<string, string> = {
  completed: 'bg-accent/20 text-accent-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
  expired: 'bg-muted text-muted-foreground',
  pending: 'bg-primary/10 text-primary',
  accepted: 'bg-primary/10 text-primary',
  in_progress: 'bg-primary/10 text-primary',
};

const RideHistorySheet = forwardRef<HTMLDivElement, RideHistorySheetProps>(({ isOpen, onClose }, ref) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && user) {
      fetchRides();
    }
  }, [isOpen, user]);

  const fetchRides = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('rides')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      toast.error('Failed to load ride history');
      console.error(error);
    } else {
      setRides((data || []) as Ride[]);
    }
    setLoading(false);
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const handleRebook = (ride: Ride) => {
    onClose();
    // Navigate to ride page with pre-filled locations via state
    navigate('/ride', {
      state: {
        rebook: {
          pickup: { name: ride.pickup_address, lat: ride.pickup_lat, lng: ride.pickup_lon },
          dropoff: { name: ride.dropoff_address, lat: ride.dropoff_lat, lng: ride.dropoff_lon },
        },
      },
    });
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent ref={ref} side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Ride History
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 overflow-y-auto max-h-[calc(100dvh-120px)]">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : rides.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No rides yet</p>
              <p className="text-sm">Your ride history will appear here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {rides.map((ride) => {
                const isExpanded = expandedId === ride.id;
                return (
                  <div
                    key={ride.id}
                    className="border border-border rounded-xl overflow-hidden transition-all"
                  >
                    {/* Summary row — always visible */}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : ride.id)}
                      className="w-full text-left p-4 hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(ride.created_at), 'MMM d, yyyy • h:mm a')}
                        </div>
                        <div className="font-semibold text-lg">
                          ${Number(ride.fare).toFixed(2)}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <div className="w-3 h-3 rounded-full bg-primary mt-1 flex-shrink-0" />
                          <p className="text-sm truncate flex-1">{ride.pickup_address}</p>
                        </div>
                        <div className="flex items-start gap-2">
                          <div className="w-3 h-3 rounded-full bg-accent mt-1 flex-shrink-0" />
                          <p className="text-sm truncate flex-1">{ride.dropoff_address}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                        <span>{ride.distance_km.toFixed(1)} km</span>
                        <span>•</span>
                        <span>{formatDuration(ride.duration_minutes)}</span>
                        <span className={`ml-auto capitalize px-2 py-0.5 rounded-full text-xs font-semibold ${statusColors[ride.status] || 'bg-muted text-muted-foreground'}`}>
                          {ride.status}
                        </span>
                      </div>

                      {(ride.status === 'completed' || ride.payment_failed) && (
                        <div className="mt-3">
                          <PaymentStatusBadge
                            status={ride.status}
                            paymentMethod={ride.payment_method}
                            walletPaid={ride.wallet_paid}
                            paymentFailed={ride.payment_failed}
                            paymentFailureReason={ride.payment_failure_reason}
                          />
                        </div>
                      )}
                    </button>

                    {/* Expanded receipt */}
                    {isExpanded && (
                      <div className="border-t border-border px-4 pb-4 pt-3 bg-muted/30">
                        <div className="flex items-center gap-2 mb-3">
                          <ReceiptText className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold text-sm">Fare Breakdown</span>
                        </div>

                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Distance</span>
                            <span>{ride.distance_km.toFixed(1)} km</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Duration</span>
                            <span>{formatDuration(ride.duration_minutes)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Vehicle</span>
                            <span className="capitalize">{ride.vehicle_type}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Passengers</span>
                            <span>{ride.passenger_count}</span>
                          </div>
                          <div className="border-t border-border pt-2 flex justify-between font-bold">
                            <span>Total Fare</span>
                            <span>${Number(ride.fare).toFixed(2)}</span>
                          </div>
                        </div>

                        {/* Re-book button */}
                        {ride.status === 'completed' && (
                          <Button
                            variant="outline"
                            className="w-full mt-4 gap-2"
                            onClick={() => handleRebook(ride)}
                          >
                            <RotateCcw className="h-4 w-4" />
                            Book Again
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
});

RideHistorySheet.displayName = 'RideHistorySheet';

export default RideHistorySheet;
