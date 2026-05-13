import { useEffect, useState, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Car, Navigation, Clock, CheckCircle2, Timer } from "lucide-react";

interface DriverETABannerProps {
  driverLocation: { lat: number; lng: number };
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  rideStatus: string;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateMinutes(distanceKm: number): number {
  // Average urban speed ~25 km/h
  return Math.max(1, Math.round(distanceKm / 25 * 60));
}

export default function DriverETABanner({
  driverLocation, pickupLat, pickupLng, dropoffLat, dropoffLng, rideStatus
}: DriverETABannerProps) {
  const [, setTick] = useState(0);
  const prevEta = useRef<number>(0);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(0);
  const lastEtaRef = useRef<number>(0);

  const isInProgress = rideStatus === "in_progress";

  // Single consolidated timer: ticks UI + decrements countdown every 1s.
  // This is a UI-only countdown (no network calls), with proper cleanup on unmount.
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => (t + 1) % 1_000_000);
      setCountdownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Sync countdown when ETA changes
  useEffect(() => {
    const eta = isInProgress
      ? estimateMinutes(haversineKm(driverLocation.lat, driverLocation.lng, dropoffLat, dropoffLng))
      : estimateMinutes(haversineKm(driverLocation.lat, driverLocation.lng, pickupLat, pickupLng));
    if (Math.abs(eta - lastEtaRef.current) >= 1 || countdownSeconds <= 0) {
      setCountdownSeconds(eta * 60);
      lastEtaRef.current = eta;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverLocation.lat, driverLocation.lng, isInProgress]);

  const isEnRoute = rideStatus === "accepted";
  const isArrived = rideStatus === "arrived";
  const isInProgress = rideStatus === "in_progress";

  const distToPickup = haversineKm(driverLocation.lat, driverLocation.lng, pickupLat, pickupLng);
  const distToDropoff = haversineKm(driverLocation.lat, driverLocation.lng, dropoffLat, dropoffLng);
  const etaToPickup = estimateMinutes(distToPickup);
  const etaToDropoff = estimateMinutes(distToDropoff);
  const isNearPickup = distToPickup < 0.15;

  const currentEta = isInProgress ? etaToDropoff : etaToPickup;
  const etaChanged = prevEta.current !== currentEta;
  useEffect(() => { prevEta.current = currentEta; }, [currentEta]);

  // Is driver close? (under 2 min)
  const isClose = currentEta <= 2;

  // Format countdown
  const countdownDisplay = useMemo(() => {
    const mins = Math.floor(countdownSeconds / 60);
    const secs = countdownSeconds % 60;
    return { mins, secs, formatted: `${mins}:${secs.toString().padStart(2, '0')}` };
  }, [countdownSeconds]);

  const progressPercent = isInProgress
    ? Math.max(5, Math.min(95, (1 - distToDropoff / Math.max(distToDropoff + 1, 5)) * 100))
    : isEnRoute
    ? Math.max(5, Math.min(95, (1 - distToPickup / Math.max(distToPickup + 2, 5)) * 100))
    : 0;

  if (isArrived || (isNearPickup && isEnRoute)) {
    return (
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="flex items-center gap-3 px-4 py-3.5 bg-accent text-accent-foreground rounded-b-2xl"
      >
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
        >
          <CheckCircle2 className="h-6 w-6" />
        </motion.div>
        <div className="flex-1">
          <p className="font-bold text-sm">Driver has arrived!</p>
          <p className="text-xs opacity-80">Meet your driver at the pickup point</p>
        </div>
      </motion.div>
    );
  }

  if (isInProgress) {
    return (
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className={`px-4 py-3.5 rounded-b-2xl transition-colors duration-500 ${isClose ? "bg-accent text-accent-foreground" : "bg-primary text-primary-foreground"}`}
      >
        <div className="flex items-center gap-3 mb-2">
          <Navigation className="h-5 w-5" />
          <div className="flex-1">
            <p className="font-bold text-sm">Trip in progress</p>
            <p className="text-xs opacity-80">
              {distToDropoff.toFixed(1)} km to destination
            </p>
          </div>
          <motion.div
            key={countdownDisplay.formatted}
            initial={etaChanged ? { scale: 1.4 } : false}
            animate={{ scale: 1 }}
            className="text-right"
          >
            <div className="flex items-center gap-1 justify-end">
              <Timer className="w-3 h-3 opacity-60" />
              <p className={`text-2xl font-black font-display tabular-nums ${isClose ? "text-accent-foreground" : ""}`}>
                {countdownDisplay.formatted}
              </p>
            </div>
            <p className="text-[10px] font-semibold opacity-70 uppercase">min:sec</p>
          </motion.div>
        </div>
        <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${isClose ? "bg-accent-foreground" : "bg-accent"}`}
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </div>
      </motion.div>
    );
  }

  if (isEnRoute) {
    return (
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className={`px-4 py-3.5 rounded-b-2xl transition-colors duration-500 ${isClose ? "bg-accent text-accent-foreground" : "bg-primary text-primary-foreground"}`}
      >
        <div className="flex items-center gap-3 mb-2">
          <motion.div
            animate={{ x: [0, 4, 0] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
          >
            <Car className="h-5 w-5" />
          </motion.div>
          <div className="flex-1">
            <p className="font-bold text-sm">
              {isClose ? "Almost there!" : "Driver is on the way"}
            </p>
            <p className="text-xs opacity-80">{distToPickup.toFixed(1)} km away</p>
          </div>
          <motion.div
            key={countdownDisplay.formatted}
            initial={etaChanged ? { scale: 1.4 } : false}
            animate={{ scale: 1 }}
            className="text-right"
          >
            <div className="flex items-center gap-1 justify-end">
              <Timer className="w-3 h-3 opacity-60" />
              <p className={`text-2xl font-black font-display tabular-nums ${isClose ? "text-accent-foreground" : ""}`}>
                {countdownDisplay.formatted}
              </p>
            </div>
            <p className="text-[10px] font-semibold opacity-70 uppercase">min:sec</p>
          </motion.div>
        </div>
        <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${isClose ? "bg-accent-foreground" : "bg-accent"}`}
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </div>
      </motion.div>
    );
  }

  return null;
}
