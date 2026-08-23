import { Pencil, User, Car, Bus, Package, Banknote, UserPlus, MessageCircle } from 'lucide-react';
import RouteIndicator from './RouteIndicator';
import PreferenceList from './PreferenceList';
import type { EnrichedRideRequest } from '@/lib/driverRideRequests';
import { useTrackRideViewer } from '@/lib/rideViewerPresence';

const VEHICLE_ICON: Record<string, typeof Car> = { economy: Car, share: Bus, parcel: Package };
const VEHICLE_LABEL: Record<string, string> = { economy: 'Economy', share: 'Share Ride', parcel: 'Parcel' };
const PARCEL_SIZE_LABEL: Record<string, string> = { small: 'Small · lap', medium: 'Medium · boot', large: 'Large · back seat' };

interface RideRequestListCardProps {
  ride: EnrichedRideRequest;
  minutesAway: number | null;
  fmtUSD: (n: number) => string;
  onAccept: () => void;
  onEditFare: () => void;
  onClick?: () => void;
}

export default function RideRequestListCard({ ride, minutesAway, fmtUSD, onAccept, onEditFare, onClick }: RideRequestListCardProps) {
  // Marks this driver as "viewing" the ride for as long as its card is on
  // screen — feeds the rider's live "N drivers viewing" count.
  useTrackRideViewer(ride.id);
  const vehicleType = ride.vehicle_type || 'economy';
  const VehicleIcon = VEHICLE_ICON[vehicleType] ?? Car;
  const vehicleLabel = VEHICLE_LABEL[vehicleType] ?? 'Economy';
  const gender = ride.passenger_gender;

  return (
    <div
      role={onClick ? 'button' : undefined}
      onClick={onClick}
      className="rounded-2xl border border-border bg-card p-4 space-y-3.5 cursor-pointer"
    >
      {/* Top row: time away + vehicle type */}
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

        {/* Passenger info — parcel rides show what's being carried instead;
            a parcel is not a passenger, so gender/luggage/preferences don't apply. */}
        {vehicleType === 'parcel' && ride.parcel ? (
          <div className="w-32 shrink-0 space-y-1.5">
            <p className="text-[11px] font-semibold text-muted-foreground">{PARCEL_SIZE_LABEL[ride.parcel.packageSize] ?? ride.parcel.packageSize}</p>
            <p className="text-[12px] font-semibold text-foreground truncate">To: {ride.parcel.recipientName}</p>
            {ride.parcel.deliveryNote && (
              <p className="text-[11px] text-muted-foreground line-clamp-2">{ride.parcel.deliveryNote}</p>
            )}
            <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground">
              <Banknote className="w-3 h-3" />
              {ride.parcel.whoPays === 'sender' ? 'Sender pays' : 'Recipient pays'}
            </span>
          </div>
        ) : (
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
              {ride.passenger_name && (
                <p className="mt-1 flex items-center gap-1 text-[10.5px] font-semibold text-amber-700 dark:text-amber-400">
                  <UserPlus className="w-3 h-3 shrink-0" />
                  <span className="truncate">For {ride.passenger_name}</span>
                </p>
              )}
            </div>
            <PreferenceList
              noLuggage={!ride.hasLuggage}
              coolTemperature={ride.preferences?.cool_temperature}
              quietRide={ride.preferences?.quiet_ride}
              wavRequired={ride.preferences?.wav_required}
              hearingImpaired={ride.preferences?.hearing_impaired}
            />
          </div>
        )}
      </div>

      {/* Rider's note — reaches the driver here, before they accept, not as
          a surprise after pickup. */}
      {ride.rider_note && (
        <div className="flex items-start gap-1.5 rounded-xl bg-muted/60 px-2.5 py-2">
          <MessageCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          <p className="text-[12px] text-foreground line-clamp-2">{ride.rider_note}</p>
        </div>
      )}

      {/* Fare row */}
      <div className="flex items-center justify-between pt-3 border-t border-border/60">
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground">Est. Distance</p>
          <p className="text-[13px] font-bold text-foreground">{ride.distance_km.toFixed(1)} km</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground">
            Est. Fare · {ride.payment_method === 'wallet' ? 'Wallet' : 'Cash'}
          </p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEditFare(); }}
            className="flex items-center gap-1 text-[15px] font-black text-primary"
          >
            {fmtUSD(ride.fare)}
            <Pencil className="w-3 h-3 text-muted-foreground" />
          </button>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAccept(); }}
          className="px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-[13px] font-bold active:scale-95 transition-transform"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
