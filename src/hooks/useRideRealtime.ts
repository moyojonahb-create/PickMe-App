/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { connectGoRideSocket } from '@/lib/goRideSocket';

export function useRideRealtime(
  rideId: string | null,
  callbacks: {
    onRideChange?: () => void;
    onOfferChange?: () => void;
    onMessageChange?: () => void;
  }
) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!rideId) return;

    let disconnectGo: (() => void) | null = null;
    connectGoRideSocket(rideId, (message) => {
      if (message.type === "ride_offer") callbacksRef.current.onOfferChange?.();
      if (message.type === "ride_accepted" || message.type === "ride_started" || message.type === "ride_completed") {
        callbacksRef.current.onRideChange?.();
      }
      if (message.type === "driver_location") {
        callbacksRef.current.onRideChange?.();
      }
    }).then((disconnect) => { disconnectGo = disconnect; });

    const channel = supabase
      .channel(`ride-messages-${rideId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `ride_id=eq.${rideId}` },
        () => callbacksRef.current.onMessageChange?.()
      )
      .subscribe();

    return () => {
      disconnectGo?.();
      supabase.removeChannel(channel);
    };
  }, [rideId]);
}

/**
 * Still Supabase-backed because the current Go websocket contract is ride-room
 * scoped and does not define a global driver marketplace room yet.
 */
export function useOpenRidesRealtime(onUpdate: () => void) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const channel = supabase
      .channel('open-rides')
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rides" },
        () => onUpdateRef.current()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offers" },
        () => onUpdateRef.current()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}

/**
 * Deprecated for business events. Use the Go ride websocket when a ride id is
 * known; this remains for legacy notification UI until a Go marketplace room
 * exists.
 */
export function useRealtimeRideRequests(onNewRide: (ride: unknown) => void) {
  const onNewRideRef = useRef(onNewRide);
  onNewRideRef.current = onNewRide;

  useEffect(() => {
    const channel = supabase
      .channel('driver-ride-requests')
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "rides" },
        (payload) => {
          const ride = payload.new;
          if (ride.status === "pending") {
            const expiresAt = ride.expires_at ? new Date(ride.expires_at).getTime() : null;
            if (!expiresAt || expiresAt > Date.now()) {
              onNewRideRef.current(ride);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}

export function useRealtimeOffers(rideId: string | null, onOffer: (offer: unknown) => void) {
  const onOfferRef = useRef(onOffer);
  onOfferRef.current = onOffer;

  useEffect(() => {
    if (!rideId) return;

    let disconnectGo: (() => void) | null = null;
    connectGoRideSocket(rideId, (message) => {
      if (message.type === "ride_offer") onOfferRef.current(message.payload);
    }).then((disconnect) => { disconnectGo = disconnect; });

    return () => {
      disconnectGo?.();
    };
  }, [rideId]);
}

export function useRealtimeRideStatus(rideId: string | null, onUpdate: (ride: unknown) => void) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!rideId) return;

    let disconnectGo: (() => void) | null = null;
    connectGoRideSocket(rideId, (message) => {
      if (message.type === "ride_accepted" || message.type === "ride_started" || message.type === "ride_completed") {
        onUpdateRef.current(message.payload);
      }
    }).then((disconnect) => { disconnectGo = disconnect; });

    return () => {
      disconnectGo?.();
    };
  }, [rideId]);
}
