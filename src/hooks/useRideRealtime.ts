/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  backendSocketClient,
  eventRideId,
  type BackendSocketEvent,
} from '@/lib/backendSocketClient';

export function useRideRealtime(
  rideId: string | null,
  callbacks: {
    onRideChange?: (event?: BackendSocketEvent) => void;
    onOfferChange?: (event?: BackendSocketEvent) => void;
    onDriverLocation?: (event: BackendSocketEvent) => void;
    onMessageChange?: () => void;
  }
) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!rideId) return;

    backendSocketClient.joinRide(rideId);

    const unsubs = [
      backendSocketClient.on("ride_offer", (event) => {
        if (eventRideId(event) === rideId) callbacksRef.current.onOfferChange?.(event);
      }),
      backendSocketClient.on("ride_accepted", (event) => {
        if (eventRideId(event) === rideId) callbacksRef.current.onRideChange?.(event);
      }),
      backendSocketClient.on("driver_location", (event) => {
        const eventId = eventRideId(event);
        if (eventId === rideId || !eventId) callbacksRef.current.onDriverLocation?.(event);
      }),
      backendSocketClient.on("ride_status_updated", (event) => {
        if (eventRideId(event) === rideId) callbacksRef.current.onRideChange?.(event);
      }),
      backendSocketClient.on("ride_cancelled", (event) => {
        if (eventRideId(event) === rideId) callbacksRef.current.onRideChange?.(event);
      }),
      backendSocketClient.on("ride_started", (event) => {
        if (eventRideId(event) === rideId) callbacksRef.current.onRideChange?.(event);
      }),
      backendSocketClient.on("ride_completed", (event) => {
        if (eventRideId(event) === rideId) callbacksRef.current.onRideChange?.(event);
      }),
    ];

    // Chat remains Supabase-backed; ride lifecycle and offers use Go websocket events.
    const channel = supabase
      .channel(`ride-messages-${rideId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `ride_id=eq.${rideId}` },
        () => callbacksRef.current.onMessageChange?.()
      )
      .subscribe();

    return () => {
      unsubs.forEach((unsub) => unsub());
      backendSocketClient.leaveRide(rideId);
      supabase.removeChannel(channel);
    };
  }, [rideId]);
}

export function useOpenRidesRealtime(onUpdate: (event?: BackendSocketEvent) => void) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const unsubs = [
      backendSocketClient.on("ride_offer", (event) => onUpdateRef.current(event)),
      backendSocketClient.on("ride_accepted", (event) => onUpdateRef.current(event)),
      backendSocketClient.on("ride_status_updated", (event) => onUpdateRef.current(event)),
      backendSocketClient.on("ride_cancelled", (event) => onUpdateRef.current(event)),
      backendSocketClient.on("ride_started", (event) => onUpdateRef.current(event)),
      backendSocketClient.on("ride_completed", (event) => onUpdateRef.current(event)),
    ];

    // The Go websocket is not always reachable (self-hosted backend offline,
    // preview builds, flaky mobile networks). Without a second path a driver
    // sitting on the dashboard never learns a new request was broadcast, so
    // subscribe to Supabase realtime on `rides` too: a new pending row fires
    // an immediate refresh, other writes are coalesced into a 400ms window.
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduled = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => onUpdateRef.current(), 400);
    };
    const channel = supabase
      .channel('open-rides-broadcast')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, () => onUpdateRef.current())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, scheduled)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rides' }, scheduled)
      .subscribe();

    // Safety net so a request is never missed by more than 5s even if both
    // realtime paths are down.
    const poll = setInterval(() => onUpdateRef.current(), 5000);

    return () => {
      unsubs.forEach((unsub) => unsub());
      supabase.removeChannel(channel);
      clearInterval(poll);
      if (debounce) clearTimeout(debounce);
    };
  }, []);
}


export function useRealtimeRideRequests(onNewRide: (ride: BackendSocketEvent) => void) {
  const onNewRideRef = useRef(onNewRide);
  onNewRideRef.current = onNewRide;

  useEffect(() => {
    return backendSocketClient.on("ride_offer", (event) => onNewRideRef.current(event));
  }, []);
}

export function useRealtimeOffers(rideId: string | null, onOffer: (offer: BackendSocketEvent) => void) {
  const onOfferRef = useRef(onOffer);
  onOfferRef.current = onOffer;

  useEffect(() => {
    if (!rideId) return;
    backendSocketClient.joinRide(rideId);
    const unsub = backendSocketClient.on("ride_offer", (event) => {
      if (eventRideId(event) === rideId) onOfferRef.current(event);
    });
    return () => {
      unsub();
      backendSocketClient.leaveRide(rideId);
    };
  }, [rideId]);
}

export function useRealtimeRideStatus(rideId: string | null, onUpdate: (ride: BackendSocketEvent) => void) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!rideId) return;
    backendSocketClient.joinRide(rideId);
    const unsubs = [
      backendSocketClient.on("ride_accepted", (event) => {
        if (eventRideId(event) === rideId) onUpdateRef.current(event);
      }),
      backendSocketClient.on("ride_status_updated", (event) => {
        if (eventRideId(event) === rideId) onUpdateRef.current(event);
      }),
      backendSocketClient.on("ride_cancelled", (event) => {
        if (eventRideId(event) === rideId) onUpdateRef.current(event);
      }),
      backendSocketClient.on("ride_started", (event) => {
        if (eventRideId(event) === rideId) onUpdateRef.current(event);
      }),
      backendSocketClient.on("ride_completed", (event) => {
        if (eventRideId(event) === rideId) onUpdateRef.current(event);
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
      backendSocketClient.leaveRide(rideId);
    };
  }, [rideId]);
}
