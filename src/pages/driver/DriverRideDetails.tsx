import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RotateCcw, User, Car, Bus, Package, Users } from 'lucide-react';
import { toast } from 'sonner';
import { getDriverProfile, submitOffer, defaultNightMultiplier, clampTo5 } from '@/lib/offerHelpers';
import { fetchEnrichedOpenRides, type EnrichedRideRequest } from '@/lib/driverRideRequests';
import RouteIndicator from '@/components/driver/RouteIndicator';
import PreferenceList from '@/components/driver/PreferenceList';
import FareEditor from '@/components/driver/FareEditor';
import LanguageRow from '@/components/driver/LanguageRow';
import NotesCard from '@/components/driver/NotesCard';
import StickyRideActions from '@/components/driver/StickyRideActions';

const VEHICLE_ICON: Record<string, typeof Car> = { economy: Car, share: Bus, parcel: Package };
const VEHICLE_LABEL: Record<string, string> = { economy: 'Economy', share: 'Comfort', parcel: 'Parcel' };

function fmtUSD(n: number): string {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

export default function DriverRideDetails() {
  const { rideId } = useParams<{ rideId: string }>();
  const navigate = useNavigate();

  const [ride, setRide] = useState<EnrichedRideRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [fare, setFare] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number } | null>(null);

  const baseFare = ride?.fare ?? 0;

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setDriverCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }, []);

  const load = useCallback(async () => {
    if (!rideId) return;
    setLoading(true);
    try {
      const profile = await getDriverProfile();
      const list = await fetchEnrichedOpenRides(profile?.gender);
      const found = list.find((r) => r.id === rideId) ?? null;
      setRide(found);
      if (found) {
        const mult = defaultNightMultiplier();
        setFare(clampTo5(found.fare * mult));
      }
    } catch (e) {
      toast.error('Could not load ride', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => { load(); }, [load]);

  const minutesAway = useMemo(() => {
    if (!driverCoords || !ride?.pickup_lat || !ride?.pickup_lon) return null;
    const dLat = (ride.pickup_lat - driverCoords.lat) * 111;
    const dLng = (ride.pickup_lon - driverCoords.lng) * 111 * Math.cos((driverCoords.lat * Math.PI) / 180);
    const km = Math.sqrt(dLat * dLat + dLng * dLng);
    return Math.max(1, Math.round((km / 25) * 60));
  }, [driverCoords, ride]);

  const handleInc = () => setFare((p) => Math.round((p + 0.5) * 2) / 2);
  const handleDec = () => setFare((p) => Math.max(0.5, Math.round((p - 0.5) * 2) / 2));
  const handleReset = () => { if (ride) setFare(clampTo5(ride.fare * defaultNightMultiplier())); };

  const handleAccept = async () => {
    if (!ride || submitting) return;
    setSubmitting(true);
    try {
      const eta = Math.max(5, Math.round(ride.duration_minutes / 2)) || 10;
      await submitOffer({ ride_id: ride.id, price: fare, eta_minutes: eta });
      toast.success('Offer sent!', { description: `${fmtUSD(fare)} for ${eta} min ETA — waiting for the rider to confirm.` });
      navigate('/driver/dashboard');
    } catch (e) {
      toast.error('Could not send offer', { description: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = () => navigate('/driver/requests');

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background p-4 space-y-3">
        <div className="h-8 w-40 rounded bg-muted animate-pulse" />
        <div className="h-40 rounded-2xl bg-muted animate-pulse" />
        <div className="h-24 rounded-2xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (!ride) {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-bold text-foreground">This request is no longer available</p>
        <p className="text-sm text-muted-foreground">It may have expired or been taken by another driver.</p>
        <button onClick={() => navigate('/driver/requests')} className="mt-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-bold text-sm">
          Back to requests
        </button>
      </div>
    );
  }

  const vehicleType = ride.vehicle_type || 'economy';
  const VehicleIcon = VEHICLE_ICON[vehicleType] ?? Car;
  const vehicleLabel = VEHICLE_LABEL[vehicleType] ?? 'Economy';
  const gender = ride.passenger_gender;

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-lg border-b border-border/50 px-4 py-3.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 14px)' }}>
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 flex items-center justify-center rounded-full active:scale-90 transition-transform">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-[16px] font-bold text-foreground">Ride Details</h1>
          <button onClick={handleReset} className="flex items-center gap-1 text-[13px] font-bold text-primary active:opacity-70 transition-opacity">
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>
      </div>

      <div className="flex-1 max-w-lg w-full mx-auto px-4 py-4 space-y-4">
        {/* Ride summary */}
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: '#FFE6E6', color: '#B81104' }}>
              {minutesAway !== null ? `${minutesAway} min away` : 'Nearby'}
            </span>
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
              {vehicleLabel}
              <VehicleIcon className="w-4 h-4" />
            </span>
          </div>

          <div className="flex items-start justify-between gap-3">
            <RouteIndicator pickupAddress={ride.pickup_address} dropoffAddress={ride.dropoff_address} className="flex-1 min-w-0" />
            <div className="w-28 shrink-0 space-y-2">
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground mb-1">Passenger</p>
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: gender === 'female' ? '#FCE7F3' : '#DBEAFE', color: gender === 'female' ? '#DB2777' : '#2563EB' }}
                  >
                    <User className="w-3 h-3" />
                  </span>
                  {gender === 'female' ? 'Female' : gender === 'male' ? 'Male' : 'Rider'}
                </span>
              </div>
              {ride.passenger_count && ride.passenger_count > 1 && (
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                  <Users className="w-3.5 h-3.5 text-muted-foreground" />
                  {ride.passenger_count} passengers
                </span>
              )}
              <PreferenceList
                noLuggage={!ride.hasLuggage}
                coolTemperature={ride.preferences?.cool_temperature}
                quietRide={ride.preferences?.quiet_ride}
                wavRequired={ride.preferences?.wav_required}
                hearingImpaired={ride.preferences?.hearing_impaired}
              />
            </div>
          </div>
        </div>

        {/* Fare */}
        <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">Est. Distance</p>
              <p className="text-[15px] font-bold text-foreground">{ride.distance_km.toFixed(1)} km</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold text-muted-foreground">Your Fare</p>
              <p className="text-xl font-black text-primary">{fmtUSD(fare)}</p>
            </div>
          </div>

          <FareEditor baseFare={baseFare} value={fare} onInc={handleInc} onDec={handleDec} fmtUSD={fmtUSD} />
        </div>

        {/* Additional info */}
        <div className="rounded-2xl border border-border bg-card px-4 divide-y divide-border/60">
          <LanguageRow />
          <NotesCard note={null} />
        </div>
      </div>

      <StickyRideActions
        onDecline={handleDecline}
        onAccept={handleAccept}
        submitting={submitting}
        acceptLabel="Accept Request"
        acceptSubLabel={`Send offer at ${fmtUSD(fare)}`}
      />
    </div>
  );
}
