import React, { useEffect, useMemo, useRef, useState } from "react";
import { playNewRequestSound } from "@/lib/notificationSounds";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User, Star } from "lucide-react";

export type DriverViewing = {
  driverId: string;
  name: string;
  phone: string;
  vehicleType: "Car" | "Taxi" | "Motorbike";
  plateNumber: string;
  vehicleColor?: string;
  languages: string[];
  distanceKm: number;
  etaMinutes: number;
};

export type DriverOffer = DriverViewing & {
  offerId: string;
  offeredFareR: number;
  createdAt: string;
  driverName?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  gender?: string | null;
  avatarUrl?: string | null;
  ratingAvg?: number | null;
  totalTrips?: number | null;
};

type Props = {
  isOpen: boolean;
  tripId: string;
  viewing: DriverViewing[];
  offers: DriverOffer[];
  onAcceptOffer: (offerId: string) => Promise<void> | void;
  onDeclineOffer: (offerId: string) => Promise<void> | void;
  onCancelRide: () => Promise<void> | void;
  onClose: () => void;
};

const ACCEPT_WINDOW_SECONDS = 180;

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}

// Progress bar component for 10-second countdown
function ExpiryProgressBar({
  secondsLeft,
  totalSeconds = ACCEPT_WINDOW_SECONDS



}: {secondsLeft: number;totalSeconds?: number;}) {
  const progress = Math.max(0, secondsLeft / totalSeconds * 100);

  return (
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mt-2">
      <div
        className="h-full bg-primary rounded-full transition-all duration-200 ease-linear"
        style={{
          width: `${progress}%`,
          transition: 'width 0.2s linear'
        }} />
      
    </div>);

}

export default function OffersModal({
  isOpen,
  tripId,
  viewing,
  offers,
  onAcceptOffer,
  onDeclineOffer,
  onCancelRide,
  onClose
}: Props) {
  const deadlinesRef = useRef<Record<string, number>>({});
  const [now, setNow] = useState<number>(Date.now());
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [busyCancel, setBusyCancel] = useState(false);
  const prevOffersCount = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    for (const o of offers) {
      if (!deadlinesRef.current[o.offerId]) {
        const created = new Date(o.createdAt).getTime();
        deadlinesRef.current[o.offerId] = created + ACCEPT_WINDOW_SECONDS * 1000;
      }
    }

    // Play sound when new offers arrive
    if (offers.length > prevOffersCount.current && prevOffersCount.current > 0) {
      playNewRequestSound();
    }
    prevOffersCount.current = offers.length;
  }, [offers, isOpen]);

  const offersWithCountdown = useMemo(() => {
    return offers.map((o) => {
      const deadline = deadlinesRef.current[o.offerId] ?? Date.now() + ACCEPT_WINDOW_SECONDS * 1000;
      const msLeft = deadline - now;
      const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));
      const expired = msLeft <= 0;
      return { ...o, secondsLeft, expired };
    }).filter((o) => !o.expired); // Hide expired offers
  }, [offers, now]);

  const handleAccept = async (offerId: string, expired: boolean) => {
    if (expired || busyOfferId) return;
    try {
      setBusyOfferId(offerId);
      await onAcceptOffer(offerId);
      onClose();
    } finally {
      setBusyOfferId(null);
    }
  };

  const handleDecline = async (offerId: string) => {
    if (busyOfferId) return;
    try {
      setBusyOfferId(offerId);
      await onDeclineOffer(offerId);
    } finally {
      setBusyOfferId(null);
    }
  };

  const handleCancelRide = async () => {
    if (busyCancel) return;
    try {
      setBusyCancel(true);
      await onCancelRide();
      onClose();
    } finally {
      setBusyCancel(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-center items-end z-[9999] p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Nearby drivers">
      
      <div className="w-full max-w-[520px] rounded-3xl border border-white/35 bg-white/30 backdrop-blur-2xl p-4 shadow-[0_22px_60px_rgba(0,0,0,0.28)] max-h-[88vh] overflow-auto">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-black text-foreground">Driver Offers</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {offersWithCountdown.length} active offer{offersWithCountdown.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            className="border-none bg-muted hover:bg-muted/80 rounded-full p-2 text-lg cursor-pointer transition-colors"
            aria-label="Close">
            
            ✕
          </button>
        </div>

        {/* Viewing Section */}
        <section className="mt-4">
          <div className="font-bold text-foreground mb-2 text-sm">Drivers viewing your request</div>
          {viewing.length === 0 ? (
            <div className="p-3 bg-muted/50 rounded-xl text-muted-foreground text-sm">
              Waiting for drivers to view your request…
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {viewing.map((d) => (
                <div key={d.driverId} className="flex items-center gap-3 p-2 bg-muted/30 rounded-xl">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.vehicleType} • {d.plateNumber}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">~{d.etaMinutes} min</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Offers Section */}
        <section className="mt-4">
          <div className="font-bold text-foreground mb-2 text-sm">Offers received</div>
          {offersWithCountdown.length === 0 ?
          <div className="p-4 bg-muted/50 rounded-xl text-muted-foreground text-sm text-center">
              <div className="animate-pulse">Waiting for driver offers…</div>
              <p className="text-xs mt-1">Offers appear here when drivers bid on your ride</p>
            </div> :

          <div className="flex flex-col gap-3">
              {offersWithCountdown.map((o) =>
            <div
              key={o.offerId}
              className="rounded-2xl border border-white/40 bg-white/55 backdrop-blur-xl p-4 shadow-[0_10px_28px_rgba(0,0,0,0.10)]">
              
                  {/* Driver Info */}
                  <div className="flex justify-between items-start gap-3 mb-3">
                    <div className="flex items-start gap-3 flex-1">
                      <Avatar className="h-12 w-12 border-2 border-white/70 shadow-sm">
                        {o.avatarUrl ?
                    <AvatarImage src={o.avatarUrl} alt={o.driverName || 'Driver'} /> :
                    null}
                        <AvatarFallback className={`text-sm font-bold ${o.gender === 'female' ? 'bg-pink-100 text-pink-700' : 'bg-primary/10 text-primary'}`}>
                          {o.gender === 'female' ? '♀' : '♂'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-foreground text-[16px] leading-tight">
                          {o.driverName || o.name || 'Driver'}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {o.vehicleMake && o.vehicleModel ? `${o.vehicleMake} ${o.vehicleModel}` : o.vehicleModel || o.vehicleType}
                          {o.vehicleColor && ` • ${o.vehicleColor}`}
                        </div>
                        <div className="text-sm text-muted-foreground mt-0.5">
                          Plate: <span className="font-semibold text-foreground">{o.plateNumber}</span>
                        </div>
                        {o.gender &&
                    <div className="text-sm mt-1">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${o.gender === 'female' ? 'bg-pink-100 text-pink-700' : 'bg-primary/10 text-primary'}`}>
                              {o.gender === 'female' ? '♀ Female' : '♂ Male'} driver
                            </span>
                          </div>
                    }
                        {/* Rating & Trips */}
                        <div className="flex items-center gap-2 mt-1.5">
                          {o.ratingAvg != null && o.ratingAvg > 0 &&
                      <span className="flex items-center gap-0.5 text-xs font-semibold text-yellow-700 bg-yellow-100/70 px-1.5 py-0.5 rounded-full">
                              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                              {Number(o.ratingAvg).toFixed(1)}
                            </span>
                      }
                          <span className="text-xs text-muted-foreground font-medium">
                            {o.totalTrips || 0} trips
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Fare</p>
                      <div className="font-black text-2xl text-primary leading-none">
                        ${o.offeredFareR.toFixed(2)}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-foreground bg-primary/10 rounded-full px-2 py-0.5 inline-block">
                        ETA {o.etaMinutes} min
                      </div>
                    </div>
                  </div>

                  {/* Contact Info */}
                  {o.phone && o.phone !== "+263" &&
              <div className="mb-3 p-2 bg-muted rounded-lg">
                      <a
                  className="font-semibold text-primary no-underline hover:underline flex items-center gap-2"
                  href={`tel:${normalizePhone(o.phone)}`}>
                  
                        📞 {o.phone}
                      </a>
                    </div>
              }

                  {/* Expiry Progress Bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Offer expires in</span>
                      <span className="font-bold text-primary">{o.secondsLeft}s</span>
                    </div>
                    <ExpiryProgressBar secondsLeft={o.secondsLeft} />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2.5">
                    <button
                  onClick={() => handleAccept(o.offerId, o.expired)}
                  disabled={o.expired || busyOfferId !== null}
                  className="flex-1 h-14 inline-flex items-center justify-center border border-white/30 rounded-xl px-4 font-semibold cursor-pointer bg-primary/20 backdrop-blur-xl text-primary disabled:opacity-50 transition-all hover:opacity-90 shadow-[0_4px_16px_hsl(var(--primary)/0.2)]">
                  
                      {busyOfferId === o.offerId ? "Accepting..." : "Accept"}
                    </button>
                    <button
                  onClick={() => handleDecline(o.offerId)}
                  disabled={busyOfferId !== null}
                  className="flex-1 border border-slate-200 rounded-xl px-4 py-3.5 font-semibold cursor-pointer bg-slate-100 text-foreground disabled:opacity-50 transition-all hover:bg-slate-200">
                  
                      Decline
                    </button>
                  </div>
                </div>
            )}
            </div>
          }
        </section>

        {/* Cancel Ride Button */}
        <div className="mt-4">
          <button
            onClick={handleCancelRide}
            disabled={busyCancel}
            className="w-full border-2 border-destructive rounded-xl px-4 py-3 font-bold cursor-pointer bg-transparent text-destructive disabled:opacity-50 transition-all hover:bg-destructive hover:text-destructive-foreground">
            
            {busyCancel ? "Cancelling…" : "Cancel Ride"}
          </button>
        </div>

        {/* Info Note */}
        <div className="mt-3 text-xs text-center text-muted-foreground">
          Offers are valid for 3 minutes. Expired offers disappear automatically.
        </div>
      </div>
    </div>);

}