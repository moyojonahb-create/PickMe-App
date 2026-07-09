import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Navigation, Clock, CreditCard, Users, ChevronRight, Briefcase } from 'lucide-react';
import RidePreferenceTags from '@/components/ride/RidePreferenceTags';
import LuggagePreviewSheet from '@/components/luggage/LuggagePreviewSheet';
import { supabase } from '@/integrations/supabase/client';

interface RidePrefs {
  quiet_ride: boolean;
  cool_temperature: boolean;
  wav_required?: boolean;
  hearing_impaired?: boolean;
  gender_preference?: string;
}

interface RideRequestCardProps {
  ride: {
    id: string;
    pickup_address: string;
    dropoff_address: string;
    fare: number;
    distance_km: number;
    duration_minutes: number;
    passenger_count?: number;
    payment_method?: string;
    expires_at?: string | null;
    passenger_name?: string | null;
    passenger_phone?: string | null;
  };
  preferences?: RidePrefs | null;
  secsLeft: number;
  index: number;
  onClick: () => void;
  fmtUSD: (n: number) => string;
}

export default function RideRequestCard({ ride, preferences, secsLeft, index, onClick, fmtUSD }: RideRequestCardProps) {
  const [luggage, setLuggage] = useState<{ count: number; description: string | null } | null>(null);
  const [luggageOpen, setLuggageOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase
      .from('luggage_requests')
      .select('description, image_paths')
      .eq('ride_id', ride.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!mounted || !data) return;
        setLuggage({
          count: (data.image_paths || []).length,
          description: data.description,
        });
      });
    return () => { mounted = false; };
  }, [ride.id]);

  // Strip gender_preference from driver view — drivers should never see it
  const sanitizedPrefs = preferences ? { ...preferences, gender_preference: undefined } : preferences;
  const hasPrefs = sanitizedPrefs && (
    sanitizedPrefs.quiet_ride || sanitizedPrefs.cool_temperature ||
    sanitizedPrefs.wav_required || sanitizedPrefs.hearing_impaired
  );

  const urgentExpiry = secsLeft > 0 && secsLeft <= 15;

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, type: 'spring', stiffness: 400, damping: 30 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      className="w-full text-left bg-card rounded-2xl space-y-2.5 border border-border/40 shadow-sm hover:shadow-md hover:border-primary/30 transition-all active:bg-muted/50 overflow-hidden cursor-pointer"
    >
      {/* Blue top bar */}
      <div className="px-4 py-1.5 text-center text-[10px] font-bold tracking-wider uppercase bg-primary/10 text-primary">
        New Ride Request
      </div>
      <div className="px-3.5 pb-3.5 space-y-2.5">
      {/* Route + fare */}
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center mt-1 shrink-0">
          <div className="w-2.5 h-2.5 rounded-full bg-primary ring-2 ring-primary/15" />
          <div className="w-0.5 h-5 bg-border" />
          <div className="w-2.5 h-2.5 rounded-full bg-destructive ring-2 ring-destructive/15" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground truncate leading-tight">{ride.pickup_address}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5 leading-tight">{ride.dropoff_address}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xl font-black text-primary tabular-nums">{fmtUSD(Number(ride.fare))}</p>
        </div>
      </div>

      {/* Ride for someone else badge */}
      {ride.passenger_name && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <Users className="w-3 h-3 text-amber-600" />
          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
            Ride for: {ride.passenger_name}
          </span>
        </div>
      )}

      {/* Luggage badge */}
      {luggage && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setLuggageOpen(true); }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-yellow-400/15 border border-yellow-400/40 hover:bg-yellow-400/25 transition-colors text-left"
        >
          <Briefcase className="w-3.5 h-3.5 text-yellow-600 shrink-0" />
          <span className="text-[11px] font-bold text-yellow-700 dark:text-yellow-400">
            Luggage Included{luggage.count > 0 ? ` (${luggage.count} ${luggage.count === 1 ? 'photo' : 'photos'})` : ''}
          </span>
          {luggage.description && (
            <span className="text-[10px] text-muted-foreground truncate flex-1">
              · {luggage.description}
            </span>
          )}
          <span className="text-[10px] font-bold text-yellow-700 ml-auto shrink-0">View →</span>
        </button>
      )}

      {/* Meta chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <MetaChip icon={<Navigation className="w-2.5 h-2.5" />} text={`${ride.distance_km?.toFixed(1)} km`} />
        <MetaChip icon={<Clock className="w-2.5 h-2.5" />} text={`~${ride.duration_minutes} min`} />
        {ride.passenger_count && ride.passenger_count > 1 && (
          <MetaChip icon={<Users className="w-2.5 h-2.5" />} text={`${ride.passenger_count} pax`} />
        )}
        {ride.payment_method && ride.payment_method !== 'cash' && (
          <MetaChip icon={<CreditCard className="w-2.5 h-2.5" />} text={ride.payment_method} highlight />
        )}
      </div>

      {/* Preferences */}
      {hasPrefs && (
        <RidePreferenceTags
          quietRide={sanitizedPrefs!.quiet_ride}
          coolTemperature={sanitizedPrefs!.cool_temperature}
          wavRequired={sanitizedPrefs!.wav_required}
          hearingImpaired={sanitizedPrefs!.hearing_impaired}
        />
      )}

      {/* Expiry bar */}
      {ride.expires_at && secsLeft > 0 && (
        <div>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-muted-foreground">Expires</span>
            <span className={`font-bold tabular-nums ${urgentExpiry ? 'text-destructive' : 'text-primary'}`}>
              {secsLeft}s
            </span>
          </div>
          <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${urgentExpiry ? 'bg-destructive' : 'bg-primary'}`}
              initial={{ width: '100%' }}
              animate={{ width: `${Math.min(100, (secsLeft / 300) * 100)}%` }}
              transition={{ duration: 0.3, ease: 'linear' }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl bg-primary/10 px-3 py-2">
        <div>
          <p className="text-xs font-extrabold text-primary">Review and send offer</p>
          <p className="text-[10px] text-muted-foreground">Confirm pickup, fare, and ETA before accepting.</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <ChevronRight className="h-4 w-4" />
        </div>
      </div>
      </div>
    </motion.div>
    <LuggagePreviewSheet
      open={luggageOpen}
      onClose={() => setLuggageOpen(false)}
      rideId={ride.id}
      currentFare={Number(ride.fare)}
      onAccepted={onClick}
    />
    </>
  );
}

function MetaChip({ icon, text, highlight }: { icon: React.ReactNode; text: string; highlight?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
      highlight ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
    }`}>
      {icon} {text}
    </span>
  );
}
