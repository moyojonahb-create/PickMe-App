import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Navigation, Clock, CreditCard, Users, Briefcase } from 'lucide-react';
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
  // Strip gender_preference from driver view — drivers should never see it
  const sanitizedPrefs = preferences ? { ...preferences, gender_preference: undefined } : preferences;
  const hasPrefs = sanitizedPrefs && (
    sanitizedPrefs.quiet_ride || sanitizedPrefs.cool_temperature ||
    sanitizedPrefs.wav_required || sanitizedPrefs.hearing_impaired
  );

  const urgentExpiry = secsLeft > 0 && secsLeft <= 15;

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, type: 'spring', stiffness: 400, damping: 30 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="w-full text-left bg-card rounded-2xl space-y-2.5 border border-border/40 shadow-sm hover:shadow-md hover:border-primary/30 transition-all active:bg-muted/50 overflow-hidden"
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
      </div>
    </motion.button>
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
