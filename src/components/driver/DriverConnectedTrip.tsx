import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, Phone, MessageCircle, Users, X, Navigation as NavigationIcon } from 'lucide-react';
import MapboxMap from '@/components/map/LazyMapboxMap';
import type { MapEtaCard } from '@/components/MapboxMap';
import EmergencyButton from '@/components/ride/EmergencyButton';
import { RideCommunication } from '@/components/ride/RideCommunication';
import RideBottomSheet, { type SheetState } from '@/components/ride/RideBottomSheet';
import PassengerInfoCard from '@/components/driver/PassengerInfoCard';
import type { Coordinates } from '@/lib/osrm';

export interface RiderInfo {
  full_name: string | null;
  avatar_url: string | null;
  gender: string | null;
  completedTrips: number | null;
}

export interface DriverConnectedActiveTrip {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  fare: number;
  user_id: string;
  status: string;
  pickup_lat: number;
  pickup_lon: number;
  dropoff_lat: number;
  dropoff_lon: number;
  distance_km?: number | null;
  passenger_count?: number | null;
  passenger_name?: string | null;
  passenger_phone?: string | null;
}

interface DriverConnectedTripProps {
  activeTrip: DriverConnectedActiveTrip;
  riderInfo: RiderInfo | null;
  riderPhone: string | null;
  driverCoords: Coordinates | null;
  userId: string;
  onNavigate: () => void;
  onOpenSettings: () => void;
}

function fmtUSD(n: number): string {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

function haversineKm(a: Coordinates, b: Coordinates): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

/** Driver's post-accept "trip connected, ready to navigate" screen — a
 * full-screen map + bottom sheet, matching the same full-screen pattern
 * FullScreenNavigation already uses for the next phase. Reuses RideBottomSheet
 * (rider-side drag mechanics) and EmergencyButton (rider-side safety panel) —
 * both are generic enough to work from the driver side too. */
export default function DriverConnectedTrip({
  activeTrip,
  riderInfo,
  riderPhone,
  driverCoords,
  userId,
  onNavigate,
  onOpenSettings,
}: DriverConnectedTripProps) {
  const [sheetState, setSheetState] = useState<SheetState>('half');
  const [chatOpen, setChatOpen] = useState(false);

  const pickup: Coordinates = { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon };
  const dropoff: Coordinates = { lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon };
  const isPickupPhase = ['accepted', 'enroute', 'enroute_pickup'].includes(activeTrip.status);

  const etaToPickup = driverCoords
    ? (() => {
        const km = haversineKm(driverCoords, pickup);
        return { km, min: Math.max(1, Math.round((km / 25) * 60)) };
      })()
    : null;

  const mapCards: MapEtaCard[] | undefined = etaToPickup
    ? [{ id: 'pickup', at: pickup, label: 'Pickup', value: `${etaToPickup.min} min`, subvalue: `${etaToPickup.km.toFixed(1)} km` }]
    : undefined;

  const genderLabel = riderInfo?.gender === 'female' ? 'Female' : riderInfo?.gender === 'male' ? 'Male' : null;
  const navigateLabel = activeTrip.status === 'accepted' ? 'Navigate' : 'Open Navigation';

  return (
    <div className="fixed inset-0 z-[90] bg-background flex flex-col">
      <div className="absolute inset-0">
        <MapboxMap
          pickup={pickup}
          dropoff={dropoff}
          driverLocation={driverCoords}
          routeCoordinates={isPickupPhase && driverCoords ? [driverCoords, pickup] : [pickup, dropoff]}
          routeGradient
          mapCards={mapCards}
          className="w-full h-full"
          height="100%"
          defaultZoom={14}
        />
      </div>

      <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top, 12px) + 12px)' }}>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Menu"
          className="w-10 h-10 rounded-full bg-card/95 shadow-md flex items-center justify-center active:scale-90 transition-transform"
        >
          <Menu className="w-5 h-5 text-foreground" />
        </button>
        <span className="px-4 h-10 rounded-full bg-card/95 shadow-md flex items-center text-sm font-bold text-foreground">
          Trip connected
        </span>
        <EmergencyButton
          rideId={activeTrip.id}
          pickupAddress={activeTrip.pickup_address}
          dropoffAddress={activeTrip.dropoff_address}
          driverName={riderInfo?.full_name ?? undefined}
        />
      </div>

      <AnimatePresence>
        {chatOpen && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="absolute right-4 z-10 w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-2xl border border-border/40 bg-card/95 shadow-2xl backdrop-blur-xl"
            style={{ top: 'calc(env(safe-area-inset-top, 12px) + 64px)' }}
          >
            <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
              <p className="text-sm font-bold">Chat with Rider</p>
              <button onClick={() => setChatOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="max-h-[280px] overflow-y-auto">
              <RideCommunication rideId={activeTrip.id} currentUserId={userId} otherUserPhone={riderPhone} riderId={activeTrip.user_id} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <RideBottomSheet state={sheetState} onStateChange={setSheetState} className="z-20">
        <div className="space-y-4">
          {/* Booked for someone else — the passenger's own contact, distinct
           * from the account holder shown in the rider row below. */}
          {activeTrip.passenger_name && activeTrip.passenger_phone && (
            <PassengerInfoCard
              passengerName={activeTrip.passenger_name}
              passengerPhone={activeTrip.passenger_phone}
              onMessage={() => setChatOpen((v) => !v)}
            />
          )}

          {/* Rider row */}
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full overflow-hidden shrink-0 bg-muted flex items-center justify-center ring-2 ring-primary/20">
              {riderInfo?.avatar_url ? (
                <img src={riderInfo.avatar_url} alt={riderInfo.full_name ?? 'Rider'} className="w-full h-full object-cover" />
              ) : (
                <span className={`text-lg font-bold ${riderInfo?.gender === 'female' ? 'text-pink-600' : 'text-primary'}`}>
                  {riderInfo?.gender === 'female' ? '♀' : '♂'}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-foreground text-base truncate">{riderInfo?.full_name || 'Rider'}</p>
              <p className="text-sm text-muted-foreground truncate">
                {riderInfo?.completedTrips !== null && riderInfo?.completedTrips !== undefined && (
                  <>{riderInfo.completedTrips} trip{riderInfo.completedTrips !== 1 ? 's' : ''}{genderLabel ? ' • ' : ''}</>
                )}
                {genderLabel}
                {activeTrip.passenger_count && activeTrip.passenger_count > 1 && (
                  <span className="inline-flex items-center gap-1 ml-1.5">
                    <Users className="w-3 h-3" />
                    {activeTrip.passenger_count} passengers
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {riderPhone && (
                <a
                  href={`tel:${riderPhone.replace(/[^\d+]/g, '')}`}
                  aria-label="Call rider"
                  className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                  style={{ background: 'var(--gradient-primary)' }}
                >
                  <Phone className="w-4 h-4 text-white" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setChatOpen((v) => !v)}
                aria-label="Message rider"
                className={`w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform ${chatOpen ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}
              >
                <MessageCircle className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Trip card */}
          <div className="bg-muted/50 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center pt-0.5">
                <div className="w-2.5 h-2.5 rounded-full bg-accent" />
                <div className="w-0.5 h-8 bg-border" />
                <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-muted-foreground">Pickup</p>
                <p className="text-sm font-medium text-foreground truncate">{activeTrip.pickup_address}</p>
                <p className="text-[11px] font-semibold text-muted-foreground mt-3">Drop off</p>
                <p className="text-sm text-muted-foreground truncate">{activeTrip.dropoff_address}</p>
              </div>
            </div>
          </div>

          {/* Est. distance / fare / Navigate */}
          <div className="flex items-center gap-3">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">Est. distance</p>
              <p className="text-base font-bold text-foreground">
                {activeTrip.distance_km != null ? `${activeTrip.distance_km.toFixed(1)} km` : '—'}
              </p>
            </div>
            <div className="flex-1">
              <p className="text-[11px] font-semibold text-muted-foreground">Your fare</p>
              <p className="text-base font-bold text-primary">{fmtUSD(activeTrip.fare)}</p>
            </div>
            <button
              type="button"
              onClick={onNavigate}
              className="flex items-center gap-1.5 px-5 h-11 rounded-2xl font-bold text-sm text-primary active:scale-95 transition-transform shrink-0"
              style={{ background: '#FFE6E6' }}
            >
              <NavigationIcon className="w-4 h-4" />
              {navigateLabel}
            </button>
          </div>
        </div>
      </RideBottomSheet>
    </div>
  );
}
