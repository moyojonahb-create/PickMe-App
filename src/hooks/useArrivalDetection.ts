import { useState, useEffect, useCallback, useRef } from 'react';
import { calculateHaversineDistance, type Coordinates } from '@/lib/osrm';
import { useVoiceNavigation } from './useVoiceNavigation';
import { toast } from 'sonner';

interface ArrivalState {
  isArrived: boolean;
  distanceToPickup: number | null; // in meters
  distanceToDropoff: number | null;
  arrivalType: 'pickup' | 'dropoff' | null;
}

interface UseArrivalDetectionOptions {
  driverLocation: Coordinates | null;
  pickupLocation: Coordinates | null;
  dropoffLocation: Coordinates | null;
  arrivalThresholdMeters?: number;
  checkIntervalMs?: number;
  enableVoice?: boolean;
  onArrivedAtPickup?: () => void;
  onArrivedAtDropoff?: () => void;
}

export function useArrivalDetection({
  driverLocation,
  pickupLocation,
  dropoffLocation,
  arrivalThresholdMeters = 50,
  checkIntervalMs = 3000,
  enableVoice = true,
  onArrivedAtPickup,
  onArrivedAtDropoff,
}: UseArrivalDetectionOptions) {
  const [arrivalState, setArrivalState] = useState<ArrivalState>({
    isArrived: false,
    distanceToPickup: null,
    distanceToDropoff: null,
    arrivalType: null,
  });

  const hasNotifiedPickupRef = useRef(false);
  const hasNotifiedDropoffRef = useRef(false);
  const { speakRiderArrival, speakArrival, isSupported: voiceSupported } = useVoiceNavigation({ enabled: enableVoice });

  const checkArrival = useCallback(() => {
    if (!driverLocation) return;

    let distanceToPickup: number | null = null;
    let distanceToDropoff: number | null = null;

    // Check distance to pickup
    if (pickupLocation && !hasNotifiedPickupRef.current) {
      distanceToPickup = calculateHaversineDistance(driverLocation, pickupLocation) * 1000; // km to meters

      if (distanceToPickup <= arrivalThresholdMeters) {
        hasNotifiedPickupRef.current = true;
        
        // Notify rider
        toast.success('🚗 Your CruiXe ride has arrived!', {
          description: 'Your driver is at the pickup location',
          duration: 10000,
        });

        // Voice announcement
        if (enableVoice && voiceSupported) {
          speakRiderArrival();
        }

        setArrivalState({
          isArrived: true,
          distanceToPickup,
          distanceToDropoff: null,
          arrivalType: 'pickup',
        });

        onArrivedAtPickup?.();
        return;
      }
    }

    // Check distance to dropoff (after pickup)
    if (dropoffLocation && hasNotifiedPickupRef.current && !hasNotifiedDropoffRef.current) {
      distanceToDropoff = calculateHaversineDistance(driverLocation, dropoffLocation) * 1000;

      if (distanceToDropoff <= arrivalThresholdMeters) {
        hasNotifiedDropoffRef.current = true;

        // Notify about destination arrival
        toast.success('🎉 You have arrived!', {
          description: 'You have reached your destination',
          duration: 10000,
        });

        if (enableVoice && voiceSupported) {
          speakArrival();
        }

        setArrivalState({
          isArrived: true,
          distanceToPickup: null,
          distanceToDropoff,
          arrivalType: 'dropoff',
        });

        onArrivedAtDropoff?.();
        return;
      }
    }

    // Update distances without arrival notification
    setArrivalState(prev => ({
      ...prev,
      isArrived: false,
      distanceToPickup,
      distanceToDropoff,
    }));
  }, [
    driverLocation, 
    pickupLocation, 
    dropoffLocation, 
    arrivalThresholdMeters,
    enableVoice,
    voiceSupported,
    speakRiderArrival,
    speakArrival,
    onArrivedAtPickup,
    onArrivedAtDropoff,
  ]);

  // Continuous arrival checking
  useEffect(() => {
    if (!driverLocation) return;

    checkArrival();

    const interval = setInterval(checkArrival, checkIntervalMs);
    return () => clearInterval(interval);
  }, [checkArrival, checkIntervalMs, driverLocation]);

  // Reset when locations change
  const reset = useCallback(() => {
    hasNotifiedPickupRef.current = false;
    hasNotifiedDropoffRef.current = false;
    setArrivalState({
      isArrived: false,
      distanceToPickup: null,
      distanceToDropoff: null,
      arrivalType: null,
    });
  }, []);

  return {
    ...arrivalState,
    reset,
    checkArrival,
  };
}

// Format distance for display
export function formatArrivalDistance(meters: number | null): string {
  if (meters === null) return '';
  if (meters < 100) return `${Math.round(meters)}m away`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m away`;
  return `${(meters / 1000).toFixed(1)}km away`;
}
