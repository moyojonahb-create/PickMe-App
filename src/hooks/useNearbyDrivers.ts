import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { calculateDistance } from "@/lib/driverLocation";

interface NearbyDriver {
  id: string;
  lat: number;
  lng: number;
  isOnline: boolean;
  /** Distance from rider in km (when riderLocation provided) */
  distanceKm?: number;
}

interface RiderLocation {
  lat: number;
  lng: number;
}

/**
 * Pure-realtime nearby drivers hook — no polling.
 * When `riderLocation` + `radiusKm` are provided, results are filtered to drivers
 * within that radius around the rider (default 1km — Uber/Bolt feel).
 */
export function useNearbyDrivers(
  active: boolean,
  riderLocation?: RiderLocation | null,
  radiusKm: number = 1
): NearbyDriver[] {
  const [drivers, setDrivers] = useState<NearbyDriver[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const driversMapRef = useRef<Map<string, NearbyDriver>>(new Map());
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable rider coords (avoid re-subscribing on every tiny GPS jitter)
  const riderKey = riderLocation
    ? `${riderLocation.lat.toFixed(3)},${riderLocation.lng.toFixed(3)}`
    : "none";

  const computeDistance = useCallback(
    (lat: number, lng: number): number | undefined => {
      if (!riderLocation) return undefined;
      return calculateDistance(riderLocation.lat, riderLocation.lng, lat, lng);
    },
    [riderLocation?.lat, riderLocation?.lng]
  );

  const syncToState = useCallback(() => {
    if (syncTimerRef.current) return;
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      const all = Array.from(driversMapRef.current.values()).filter((d) => d.isOnline);
      if (!riderLocation) {
        setDrivers(all);
        return;
      }
      const filtered = all
        .map((d) => ({ ...d, distanceKm: computeDistance(d.lat, d.lng) }))
        .filter((d) => (d.distanceKm ?? Infinity) <= radiusKm)
        .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
      setDrivers(filtered);
    }, 400);
  }, [computeDistance, radiusKm, riderLocation?.lat, riderLocation?.lng]);

  useEffect(() => {
    if (!active) {
      setDrivers([]);
      driversMapRef.current.clear();
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      return;
    }

    const fetchDrivers = async () => {
      const { data } = await supabase
        .from("live_locations")
        .select("user_id, latitude, longitude, is_online")
        .eq("user_type", "driver")
        .eq("is_online", true)
        .limit(200);

      if (data) {
        const map = new Map<string, NearbyDriver>();
        data.forEach((d) => {
          map.set(d.user_id, {
            id: d.user_id,
            lat: d.latitude,
            lng: d.longitude,
            isOnline: d.is_online ?? true,
          });
        });
        driversMapRef.current = map;
        syncToState();
      }
    };

    fetchDrivers();

    const channel = supabase
      .channel(`nearby-drivers-rt`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_locations",
          filter: "user_type=eq.driver",
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Record<string, unknown>;
            if (old?.user_id) driversMapRef.current.delete(old.user_id as string);
          } else {
            const row = payload.new as Record<string, unknown>;
            if (row?.user_id && row.user_type === "driver") {
              const isOnline = (row.is_online as boolean) ?? true;
              if (!isOnline) {
                driversMapRef.current.delete(row.user_id as string);
              } else {
                driversMapRef.current.set(row.user_id as string, {
                  id: row.user_id as string,
                  lat: row.latitude as number,
                  lng: row.longitude as number,
                  isOnline,
                });
              }
            }
          }
          syncToState();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [active, syncToState]);

  // Re-filter when rider moves (without re-subscribing)
  useEffect(() => {
    if (!active) return;
    syncToState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riderKey, radiusKm]);

  return drivers;
}
