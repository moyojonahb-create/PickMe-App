/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MapPin, Navigation, Phone, MessageCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { completeTrip } from '@/lib/completeTrip';
import LiveNavMap, { type NavPhase } from '@/components/map/LiveNavMap';
import SpeedBadge from '@/components/map/SpeedBadge';
import DirectionArrow3D from '@/components/map/DirectionArrow3D';
import TurnByTurnStrip from '@/components/map/TurnByTurnStrip';
import TripTimeline, { statusToPhase } from '@/components/trip/TripTimeline';
import { useOSRMRoute } from '@/hooks/useOSRMRoute';
import { haversineMeters } from '@/lib/routeProgress';
import type { Coordinates } from '@/lib/osrm';


interface ActiveTrip {
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
  payment_method: string;
  passenger_name?: string | null;
  passenger_phone?: string | null;
}

interface DriverLiveNavProps {
  activeTrip: ActiveTrip;
  driverCoords: Coordinates | null;
  riderPhone: string | null;
  riderName?: string | null;
  onTripUpdate: (trip: ActiveTrip) => void;
  onTripComplete: () => void;
  onExit: () => void;
  onStartCall: () => void;
}

/** Fully in-app live navigation for drivers (Mapbox-primary). */
export default function DriverLiveNav({
  activeTrip,
  driverCoords,
  riderPhone,
  riderName,
  onTripUpdate,
  onTripComplete,
  onExit,
  onStartCall,
}: DriverLiveNavProps) {
  const phase: NavPhase = activeTrip.status === 'in_progress' ? 'to_dropoff' : 'to_pickup';

  const pickup = { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon };
  const dropoff = { lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon };
  const target = phase === 'to_pickup' ? pickup : dropoff;

  const driverLatLng = driverCoords ? { lat: driverCoords.lat, lng: driverCoords.lng } : null;

  // Live route — recomputed when phase changes.
  const { route } = useOSRMRoute(driverLatLng, target);

  const [tele, setTele] = useState({ speedKmh: 0, bearing: 0, remainingMeters: 0 });
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState(false);

  const distanceToTargetM = driverLatLng ? haversineMeters(driverLatLng, target) : Infinity;
  const canGo = phase === 'to_pickup' && distanceToTargetM <= 80;

  const minutesLeft = useMemo(() => {
    const m = tele.remainingMeters || (route?.distanceKm ?? 0) * 1000;
    // Assume avg 28 km/h urban, with 5 min minimum.
    const mins = Math.max(1, Math.round((m / 1000) / 28 * 60));
    return mins;
  }, [tele.remainingMeters, route?.distanceKm]);

  const distanceLabel = useMemo(() => {
    const m = tele.remainingMeters || (route?.distanceKm ?? 0) * 1000;
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
  }, [tele.remainingMeters, route?.distanceKm]);

  // Driver hits GO → status in_progress, route swaps to dropoff (blue).
  const handleGo = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('rides')
        .update({ status: 'in_progress' })
        .eq('id', activeTrip.id)
        .eq('status', activeTrip.status);
      if (error) throw error;
      const next = { ...activeTrip, status: 'in_progress' };
      onTripUpdate(next);
      toast.success('Trip started — navigating to dropoff');
    } catch (e) {
      toast.error('Could not start trip', { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [activeTrip, busy, onTripUpdate]);

  // Mark arrived at pickup (intermediate state) — optional helper button.
  const handleArrived = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('rides')
        .update({ status: 'arrived' })
        .eq('id', activeTrip.id);
      if (error) throw error;
      onTripUpdate({ ...activeTrip, status: 'arrived' });
      toast.info('Marked as arrived');
    } catch (e) {
      toast.error('Failed', { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [activeTrip, busy, onTripUpdate]);

  const handleComplete = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
    try {
      const result = await completeTrip(activeTrip.id) as { ok?: boolean; reason?: string };
      if (!result?.ok) throw new Error(result?.reason || 'Failed to complete');
      toast.success('Trip completed');
      onTripComplete();
    } catch (e) {
      toast.error('Failed to complete', { description: (e as Error).message });
    } finally {
      setCompleting(false);
    }
  }, [activeTrip.id, completing, onTripComplete]);

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      <LiveNavMap
        phase={phase}
        driverLocation={driverLatLng}
        pickup={pickup}
        dropoff={dropoff}
        routeGeometry={route?.geometry ?? null}
        onTelemetry={setTele}
        className="absolute inset-0"
      />

      {/* Top status card */}
      <div className="absolute top-0 left-0 right-0 z-10 p-3 pt-[calc(env(safe-area-inset-top,0px)+12px)] space-y-2">
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-md rounded-3xl bg-white/85 backdrop-blur-xl border border-white/40 shadow-[0_18px_40px_rgba(0,0,0,0.32)] px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onExit} className="rounded-full h-10 w-10 -ml-1">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-foreground/60">
                {phase === 'to_pickup' ? 'En Route to Pickup' : 'On Trip · To Destination'}
              </p>
              <p className="font-extrabold text-base text-foreground truncate">
                {riderName || activeTrip.passenger_name || 'Your rider'}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {phase === 'to_pickup' ? activeTrip.pickup_address : activeTrip.dropoff_address}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase font-semibold text-foreground/55">ETA</p>
              <p className="text-xl font-black tabular-nums text-primary leading-none">{minutesLeft}<span className="text-[10px] ml-0.5">min</span></p>
              <p className="text-[11px] font-semibold text-foreground/70 mt-0.5 tabular-nums">{distanceLabel}</p>
            </div>
          </div>
          <div className="mt-2.5 pt-2.5 border-t border-foreground/10">
            <TripTimeline phase={statusToPhase(activeTrip.status)} compact />
          </div>
        </motion.div>

        {/* Turn-by-turn instruction strip */}
        <TurnByTurnStrip origin={driverLatLng} destination={target} />
      </div>

      {/* Floating speed badge (top-right) */}
      <div className="absolute top-[calc(env(safe-area-inset-top,0px)+200px)] right-3 z-10">
        <SpeedBadge kmh={tele.speedKmh} />
      </div>

      {/* 3D direction arrow (above bottom card) */}
      <div className="absolute bottom-[210px] right-4 z-10 hidden sm:block">
        <DirectionArrow3D bearing={tele.bearing} />
      </div>


      {/* Bottom action panel */}
      <div className="absolute bottom-0 left-0 right-0 z-10 p-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
        <motion.div
          initial={{ y: 32, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 240, damping: 28 }}
          className="mx-auto max-w-md rounded-3xl bg-white/90 backdrop-blur-xl border border-white/50 shadow-[0_22px_50px_rgba(0,0,0,0.35)] p-4 space-y-3"
        >
          {/* Contact rider row */}
          <div className="flex items-center gap-2">
            {riderPhone && (
              <a
                href={`tel:${riderPhone.replace(/[^\d+]/g, '')}`}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm active:scale-95 transition"
              >
                <Phone className="h-4 w-4" /> Call
              </a>
            )}
            <button
              onClick={onStartCall}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-accent/80 text-accent-foreground font-semibold text-sm active:scale-95 transition"
            >
              <MessageCircle className="h-4 w-4" /> In-App
            </button>
          </div>

          {/* Primary CTA — adapts to phase + arrival */}
          <AnimatePresence mode="wait">
            {phase === 'to_pickup' && (
              <motion.div
                key="go"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
              >
                <button
                  onClick={handleGo}
                  disabled={!canGo || busy}
                  className={`w-full rounded-2xl py-5 font-black text-2xl tracking-widest transition-all shadow-lg ${
                    canGo
                      ? 'bg-gradient-to-br from-yellow-300 via-yellow-400 to-amber-500 text-black hover:brightness-110 active:scale-[0.98] animate-pulse'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                  }`}
                >
                  {busy ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : canGo ? 'GO' : `Drive closer · ${distanceLabel}`}
                </button>
                {activeTrip.status === 'accepted' && (
                  <button
                    onClick={handleArrived}
                    className="w-full mt-2 text-xs font-semibold text-foreground/60 underline underline-offset-2"
                  >
                    Mark as arrived
                  </button>
                )}
              </motion.div>
            )}

            {phase === 'to_dropoff' && (
              <motion.div
                key="complete"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
              >
                <button
                  onClick={handleComplete}
                  disabled={completing}
                  className="w-full rounded-2xl py-5 font-black text-xl bg-gradient-to-br from-blue-600 to-blue-800 text-white shadow-lg hover:brightness-110 active:scale-[0.98] transition-all"
                >
                  {completing ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : (
                    <span className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-6 h-6" /> Complete Trip
                    </span>
                  )}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
