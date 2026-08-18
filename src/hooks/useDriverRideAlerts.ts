import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { playNewRequestSound } from '@/lib/notificationSounds';
import { haptic } from '@/lib/haptics';
import { detectCity } from '@/lib/pricing';

export interface IncomingRideRequest {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  distance_km: number | null;
  fare: number;
}

export type DriverServiceArea = 'both' | 'gwanda' | 'beitbridge' | null | undefined;

/**
 * Fires the moment a new open ride request lands — a genuine Supabase
 * Realtime `postgres_changes` INSERT subscription on `rides`, not a poll.
 * Only surfaces requests inside the driver's service area (when they've set
 * one) and matching their gender-preference eligibility, and only while
 * they're online.
 */
export function useDriverRideAlerts(
  isOnline: boolean,
  serviceArea: DriverServiceArea,
  driverGender: string | null | undefined
) {
  const [incoming, setIncoming] = useState<IncomingRideRequest | null>(null);
  const [badgeCount, setBadgeCount] = useState(0);
  const areaRef = useRef(serviceArea);
  areaRef.current = serviceArea;
  const genderRef = useRef(driverGender);
  genderRef.current = driverGender;

  useEffect(() => {
    if (!isOnline) return;

    const channel = supabase
      .channel('driver-new-ride-requests')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rides', filter: 'status=eq.pending' },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.driver_id) return;

          const gp = row.gender_preference as string | null;
          if (genderRef.current && genderRef.current !== 'female' && gp && gp !== 'any') return;

          const area = areaRef.current;
          if (area && area !== 'both') {
            const lat = Number(row.pickup_lat);
            const lng = Number(row.pickup_lon);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              const city = detectCity({ lat, lng });
              if (city !== area) return;
            }
          }

          setIncoming({
            id: String(row.id),
            pickup_address: String(row.pickup_address ?? 'Pickup'),
            dropoff_address: String(row.dropoff_address ?? 'Drop-off'),
            distance_km: row.distance_km != null ? Number(row.distance_km) : null,
            fare: Number(row.fare ?? 0),
          });
          setBadgeCount((n) => n + 1);
          playNewRequestSound();
          void haptic('heavy');
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isOnline]);

  const dismiss = useCallback(() => setIncoming(null), []);
  const clearBadge = useCallback(() => setBadgeCount(0), []);

  return { incoming, dismiss, badgeCount, clearBadge };
}
