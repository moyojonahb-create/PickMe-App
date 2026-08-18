/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef, useCallback } from "react";
import { AlertTriangle, Phone, X, Shield, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { createEmergencyEvent } from "@/lib/businessApi";

interface EmergencyButtonProps {
  rideId?: string;
  pickupAddress?: string;
  dropoffAddress?: string;
  driverName?: string;
  /** 'default' (existing) is the floating red circle. 'square' matches the
   * bordered icon-over-label action-grid style used on the redesigned
   * connected-ride screens. Same panel/SOS logic either way. */
  variant?: 'default' | 'square';
}

export default function EmergencyButton({ rideId, pickupAddress, dropoffAddress, driverName, variant = 'default' }: EmergencyButtonProps) {
  const { user } = useAuth();
  const [showPanel, setShowPanel] = useState(false);
  const [sosCountdown, setSosCountdown] = useState<number | null>(null);
  const [locationShared, setLocationShared] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Always-fresh location + ride context, immune to stale closures inside the
  // countdown interval. An SOS must never report a stale/zeroed position.
  const lastPosRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const rideIdRef = useRef(rideId);
  rideIdRef.current = rideId;

  const emergencyContacts = [
    { label: "Police (ZRP)", number: "995", color: "bg-destructive/10 border-destructive/20" },
    { label: "Ambulance", number: "994", color: "bg-orange-500/10 border-orange-500/20" },
    { label: "Fire Brigade", number: "993", color: "bg-amber-500/10 border-amber-500/20" },
  ];

  const writeEmergencyAlert = async (latitude: number, longitude: number) => {
    if (!user) return;
    try {
      await createEmergencyEvent({
        ride_id: rideIdRef.current || null,
        latitude,
        longitude,
      });
    } catch (e) {
      console.error("Failed to write emergency alert:", e);
    }
  };

  const startSOS = useCallback(() => {
    setSosCountdown(5);
    countdownRef.current = setInterval(() => {
      setSosCountdown(prev => {
        if (prev === null || prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          // Get location, write alert, then dial
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              lastPosRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
              void writeEmergencyAlert(pos.coords.latitude, pos.coords.longitude);
              void shareEmergencyLocation();
            },
            () => {
              // GPS failed — fall back to the most recent tracked fix, not 0,0
              const last = lastPosRef.current;
              void writeEmergencyAlert(last?.lat ?? 0, last?.lng ?? 0);
            },
            { enableHighAccuracy: true, timeout: 3000 }
          );
          // Dial emergency immediately
          window.location.href = "tel:995";
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [user]);

  const cancelSOS = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setSosCountdown(null);
  }, []);

  // Keep a warm, continuously-updated GPS fix while the safety UI is mounted.
  useEffect(() => {
    if (!navigator.geolocation?.watchPosition) return;
    let watchId: number | null = null;
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          lastPosRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
        },
        () => { /* non-fatal: SOS still dials */ },
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
      );
    } catch { /* unsupported environment */ }
    return () => { if (watchId !== null) navigator.geolocation.clearWatch(watchId); };
  }, []);

  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, []);


  const shareEmergencyLocation = async () => {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000 })
      );
      const { latitude, longitude } = pos.coords;
      const mapsLink = `https://www.mapbox.com/directions?destination=${longitude},${latitude}`;
      const text = [
        `🆘 EMERGENCY — I need help!`,
        driverName ? `Driver: ${driverName}` : '',
        pickupAddress ? `From: ${pickupAddress}` : '',
        dropoffAddress ? `To: ${dropoffAddress}` : '',
        `My location: ${mapsLink}`,
        rideId ? `Ride ID: ${rideId.substring(0, 8)}` : '',
      ].filter(Boolean).join('\n');

      if (navigator.share) {
        await navigator.share({ title: 'Emergency - PickMe', text });
      } else {
        await navigator.clipboard.writeText(text);
        toast.success('Emergency info copied to clipboard');
      }
      setLocationShared(true);
    } catch {
      toast.error('Could not get location');
    }
  };

  return (
    <>
      {variant === 'square' ? (
        <button
          type="button"
          onClick={() => setShowPanel(true)}
          aria-label="Safety"
          className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-border active:scale-95 transition-transform relative"
        >
          <Shield className="w-5 h-5 text-foreground" />
          <span className="text-[11px] font-medium text-foreground">Safety</span>
          <span className="absolute top-1.5 right-[calc(50%-20px)] w-2 h-2 bg-destructive rounded-full animate-pulse" />
        </button>
      ) : (
        <motion.div whileTap={{ scale: 0.9 }}>
          <Button
            variant="destructive"
            size="icon"
            className="h-12 w-12 rounded-full shadow-lg relative"
            onClick={() => setShowPanel(true)}
            aria-label="Emergency"
          >
            <Shield className="h-5 w-5" />
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-destructive rounded-full border-2 border-background animate-pulse" />
          </Button>
        </motion.div>
      )}

      <AnimatePresence>
        {showPanel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-end justify-center p-3"
          >
            <motion.div
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 300, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full max-w-md bg-background rounded-3xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                    <Shield className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-foreground">Safety Center</h2>
                    <p className="text-xs text-muted-foreground">We're here for you</p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowPanel(false); cancelSOS(); }}
                  className="p-2 rounded-full hover:bg-muted transition-colors"
                >
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>

              {/* SOS Button */}
              <motion.button
                onTouchStart={startSOS}
                onTouchEnd={cancelSOS}
                onMouseDown={startSOS}
                onMouseUp={cancelSOS}
                onMouseLeave={cancelSOS}
                className="w-full py-5 bg-destructive rounded-2xl flex flex-col items-center justify-center gap-1 relative overflow-hidden"
                whileTap={{ scale: 0.97 }}
              >
                {sosCountdown !== null && (
                  <motion.div
                    initial={{ width: '100%' }}
                    animate={{ width: '0%' }}
                    transition={{ duration: 5, ease: 'linear' }}
                    className="absolute top-0 left-0 h-full bg-white/20"
                  />
                )}
                <AlertTriangle className="h-8 w-8 text-destructive-foreground" />
                <span className="text-destructive-foreground font-black text-lg">
                  {sosCountdown !== null ? `Calling in ${sosCountdown}...` : 'Hold for SOS'}
                </span>
                <span className="text-destructive-foreground/70 text-xs">
                  {sosCountdown !== null ? 'Release to cancel' : 'Hold to auto-call police & share location'}
                </span>
              </motion.button>

              {/* Direct Call Button */}
              <a
                href="tel:995"
                className="flex items-center justify-center gap-2 w-full h-12 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive font-bold text-sm transition-colors hover:bg-destructive/20"
              >
                <Phone className="h-4 w-4" />
                Call Emergency Services (995)
              </a>

              {/* Share Location */}
              <Button
                variant="outline"
                className="w-full h-12 rounded-2xl flex items-center gap-2 border-primary/20"
                onClick={shareEmergencyLocation}
              >
                <MapPin className="h-4 w-4 text-primary" />
                <span className="font-semibold">
                  {locationShared ? '✓ Location Shared' : 'Share My Location'}
                </span>
              </Button>

              {/* Emergency Numbers */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Emergency Services</p>
                {emergencyContacts.map((c) => (
                  <motion.a
                    key={c.number}
                    href={`tel:${c.number}`}
                    whileTap={{ scale: 0.98 }}
                    className={`flex items-center justify-between p-4 ${c.color} border rounded-xl transition-colors`}
                  >
                    <div>
                      <p className="font-bold text-foreground">{c.label}</p>
                      <p className="text-sm text-muted-foreground">{c.number}</p>
                    </div>
                    <Phone className="h-5 w-5 text-destructive" />
                  </motion.a>
                ))}
              </div>

              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => { setShowPanel(false); cancelSOS(); }}
              >
                Close
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
