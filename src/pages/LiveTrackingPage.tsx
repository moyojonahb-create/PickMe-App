import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import {
  Car,
  Shield,
  Phone,
  MessageCircle,
  Share2,
  AlertTriangle,
  Star,
  Wallet,
  Banknote,
  GraduationCap,
  CheckCircle2,
  Circle,
  Navigation as NavIcon,
  Clock,
  Gauge,
  MapPin,
} from "lucide-react";
import { motion } from "framer-motion";
import { backendSocketClient, eventDriverId } from "@/lib/backendSocketClient";
import TripGoogleMap from "@/components/TripGoogleMap";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { resolveAvatarUrl } from "@/lib/avatarUrl";

interface RideInfo {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lon: number;
  dropoff_lat: number;
  dropoff_lon: number;
  status: string;
  driver_id: string | null;
  fare: number | null;
  passenger_name: string | null;
  payment_method?: string | null;
  student_discount_applied?: boolean | null;
}

interface DriverInfo {
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color?: string | null;
  plate_number: string | null;
  vehicle_type: string;
  user_id: string;
  fullName: string;
  avatarUrl?: string | null;
  rating?: number | null;
  totalTrips?: number | null;
  phone?: string | null;
}

interface DriverLocation {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  updated_at: string;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Step = "accepted" | "enroute" | "arrived" | "started" | "arriving" | "completed";

const STEPS: { key: Step; label: string }[] = [
  { key: "accepted", label: "Driver Accepted" },
  { key: "enroute", label: "Enroute to Pickup" },
  { key: "arrived", label: "Arrived" },
  { key: "started", label: "Trip Started" },
  { key: "arriving", label: "Arriving Soon" },
  { key: "completed", label: "Completed" },
];

function stepFromStatus(status: string, etaMin: number | null): Step {
  switch (status) {
    case "accepted":
      return "accepted";
    case "driver_arriving":
      return "enroute";
    case "driver_arrived":
      return "arrived";
    case "in_progress":
      return etaMin !== null && etaMin <= 3 ? "arriving" : "started";
    case "completed":
      return "completed";
    default:
      return "accepted";
  }
}

export default function LiveTrackingPage() {
  const { tripId } = useParams<{ tripId: string }>();

  const [ride, setRide] = useState<RideInfo | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [driverLoc, setDriverLoc] = useState<DriverLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // LOAD RIDE + DRIVER
  useEffect(() => {
    if (!tripId) return;
    (async () => {
      const { data: rideData, error: rideErr } = await supabase
        .from("rides")
        .select(
          `id, pickup_address, dropoff_address, status, driver_id,
           pickup_lat, pickup_lon, dropoff_lat, dropoff_lon,
           fare, passenger_name, payment_method, student_discount_applied`,
        )
        .eq("id", tripId)
        .maybeSingle();

      if (rideErr || !rideData) {
        setError("Trip not found or access denied");
        setLoading(false);
        return;
      }

      setRide(rideData as unknown as RideInfo);

      if (rideData.driver_id) {
        const { data: driverData } = await supabase
          .from("drivers")
          .select(
            `vehicle_make, vehicle_model, vehicle_color, plate_number, vehicle_type, user_id, rating, total_trips`,
          )
          .eq("id", rideData.driver_id)
          .maybeSingle();

        if (driverData) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, avatar_url, phone")
            .eq("user_id", driverData.user_id)
            .maybeSingle();

          const avatarUrl = await resolveAvatarUrl(
            profile?.avatar_url,
            "avatars",
          ).catch(() => null);

          setDriver({
            ...(driverData as any),
            fullName: profile?.full_name || "Your Driver",
            avatarUrl: avatarUrl ?? null,
            rating: (driverData as any).rating ?? null,
            totalTrips: (driverData as any).total_trips ?? null,
            phone: profile?.phone ?? null,
          });
        }
      }
      setLoading(false);
    })();
  }, [tripId]);

  // REALTIME DRIVER LOCATION
  useEffect(() => {
    if (!driver?.user_id) return;
    supabase
      .from("live_locations")
      .select(`latitude, longitude, heading, speed, updated_at`)
      .eq("user_id", driver.user_id)
      .eq("user_type", "driver")
      .maybeSingle()
      .then(({ data }) => {
        if (data) setDriverLoc(data);
      });

    backendSocketClient.joinRide(tripId);
    const unsubscribeLocation = backendSocketClient.on("driver_location", (data) => {
      const driverId = eventDriverId(data);
      if (driverId && driverId !== driver.user_id) return;
      if (typeof data.latitude !== "number" || typeof data.longitude !== "number") return;
      setDriverLoc({
        latitude: data.latitude,
        longitude: data.longitude,
        heading: typeof data.heading === "number" ? data.heading : null,
        speed: typeof data.speed === "number" ? data.speed : null,
        updated_at:
          typeof data.updated_at === "string" ? data.updated_at : new Date().toISOString(),
      });
    });

    const channel = supabase
      .channel(`track-driver-${driver.user_id}-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_locations",
          filter: `user_id=eq.${driver.user_id}`,
        },
        (payload) => {
          const loc = payload.new as DriverLocation;
          if (loc?.latitude) setDriverLoc(loc);
        },
      )
      .subscribe();

    return () => {
      unsubscribeLocation();
      backendSocketClient.leaveRide(tripId);
      supabase.removeChannel(channel);
    };
  }, [driver?.user_id, tripId]);

  // REALTIME RIDE STATUS
  useEffect(() => {
    if (!tripId) return;
    const channel = supabase
      .channel(`track-ride-${tripId}-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rides",
          filter: `id=eq.${tripId}`,
        },
        (payload) => {
          const updated = payload.new as RideInfo;
          setRide((prev) => (prev ? { ...prev, ...updated } : prev));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId]);

  // === Derived ===
  const isActive = ride
    ? ["accepted", "driver_arriving", "driver_arrived", "in_progress"].includes(ride.status)
    : false;
  const isCompleted = ride?.status === "completed";
  const isCancelled = ride?.status === "cancelled";
  const isInProgress = ride?.status === "in_progress";

  const targetLat = ride ? (isInProgress ? ride.dropoff_lat : ride.pickup_lat) : 0;
  const targetLon = ride ? (isInProgress ? ride.dropoff_lon : ride.pickup_lon) : 0;

  const distKm =
    ride && driverLoc
      ? haversineKm(driverLoc.latitude, driverLoc.longitude, targetLat, targetLon)
      : null;

  const etaMinutes =
    distKm !== null ? Math.max(1, Math.round((distKm / 25) * 60)) : null;

  const arrivalTime = useMemo(() => {
    if (etaMinutes === null) return null;
    const d = new Date(Date.now() + etaMinutes * 60 * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [etaMinutes]);

  const speedKmh = driverLoc?.speed != null ? Math.round(driverLoc.speed * 3.6) : null;

  const currentStep = ride ? stepFromStatus(ride.status, etaMinutes) : "accepted";
  const currentStepIdx = STEPS.findIndex((s) => s.key === currentStep);

  // === Actions (presentational only — use platform primitives) ===
  const callDriver = () => {
    if (driver?.phone) window.location.href = `tel:${driver.phone}`;
  };
  const messageDriver = () => {
    if (driver?.phone) window.location.href = `sms:${driver.phone}`;
  };
  const shareTrip = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Track my PickMe trip", url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {}
  };
  const emergency = () => {
    window.location.href = "tel:999";
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-[#3B82F6]/10 flex items-center justify-center">
            <Car
              className="w-7 h-7 text-[#2563EB] animate-bounce"
              style={{ animationDuration: "2s" }}
            />
          </div>
          <span className="text-sm text-muted-foreground">Loading trip…</span>
        </div>
      </div>
    );
  }

  if (error || !ride) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-bold text-foreground">Trip Not Found</h1>
          <p className="text-sm text-muted-foreground">
            {error || "This trip link may have expired."}
          </p>
          <a
            href="/"
            className="inline-block mt-4 px-6 py-3 rounded-2xl bg-[#2563EB] text-white font-semibold text-sm"
          >
            Get the App
          </a>
        </div>
      </div>
    );
  }

  const isCash = (ride.payment_method ?? "cash") === "cash";
  const isWallet = ride.payment_method === "wallet";
  const studentApplied = !!ride.student_discount_applied;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background">
      {/* FULL-SCREEN MAP */}
      <div className="absolute inset-0">
        <TripGoogleMap
          pickup={{ lat: ride.pickup_lat, lng: ride.pickup_lon }}
          dropoff={{ lat: ride.dropoff_lat, lng: ride.dropoff_lon }}
          driverLocation={
            driverLoc ? { lat: driverLoc.latitude, lng: driverLoc.longitude } : null
          }
          tripStatus={ride.status}
          height="100%"
        />
      </div>

      {/* TOP FLOATING ETA PILL */}
      <div
        className="absolute top-0 left-0 right-0 z-40 px-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)" }}
      >
        <div className="mx-auto max-w-md flex items-center gap-2">
          <div className="flex-1 rounded-2xl bg-white/95 backdrop-blur-xl shadow-[0_8px_24px_-8px_rgba(15,23,42,0.18)] border border-white/60 px-3.5 py-2.5 flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, #1D4ED8 0%, #2563EB 50%, #3B82F6 100%)",
              }}
            >
              <NavIcon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground leading-none">
                {isInProgress ? "Arriving in" : "Driver in"}
              </p>
              <p className="text-base font-black text-foreground leading-tight mt-0.5">
                {etaMinutes !== null ? `${etaMinutes} min` : "—"}
                {arrivalTime && (
                  <span className="text-xs font-medium text-muted-foreground ml-1.5">
                    · {arrivalTime}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={shareTrip}
              aria-label="Share trip"
              className="w-9 h-9 rounded-xl bg-[#F1F5FF] text-[#1D4ED8] flex items-center justify-center active:scale-95 transition"
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* BOTTOM SHEET */}
      <div
        className="absolute bottom-0 left-0 right-0 z-50 bg-white dark:bg-card rounded-t-[28px] border-t border-[#3B82F6]/10 shadow-[0_-12px_40px_-8px_rgba(29,78,216,0.18)]"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        <div className="px-4 pb-2 space-y-3 max-h-[68vh] overflow-y-auto">
          {/* DRIVER CARD */}
          {driver && (
            <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-[#F1F5FF] to-white border border-[#3B82F6]/15 p-3">
              <div className="relative shrink-0">
                <Avatar className="w-14 h-14 border-2 border-[#3B82F6]/30 shadow-sm">
                  {driver.avatarUrl && (
                    <AvatarImage
                      src={driver.avatarUrl}
                      alt={driver.fullName}
                      className="object-cover"
                    />
                  )}
                  <AvatarFallback className="bg-[#3B82F6]/10 text-[#1D4ED8] font-black">
                    {driver.fullName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {(driver.totalTrips ?? 0) >= 50 && (
                  <span className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#2563EB] fill-[#DBEAFE]" />
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-[15px] font-bold text-foreground truncate">
                    {driver.fullName}
                  </p>
                  {driver.rating != null && driver.rating > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[12px] font-bold text-foreground shrink-0">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      {Number(driver.rating).toFixed(1)}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground truncate mt-0.5">
                  {[driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(" ")}
                  {driver.vehicle_color ? ` · ${driver.vehicle_color}` : ""}
                </p>
                {driver.plate_number && (
                  <span className="inline-block mt-1 font-mono text-[11px] font-black px-1.5 py-0.5 rounded-md bg-white text-foreground border border-border/60 tracking-wider">
                    {driver.plate_number}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5 shrink-0">
                <button
                  onClick={callDriver}
                  disabled={!driver.phone}
                  aria-label="Call driver"
                  className="w-10 h-10 rounded-full bg-[#2563EB] text-white flex items-center justify-center shadow-[0_6px_14px_-4px_rgba(37,99,235,0.55)] active:scale-95 transition disabled:opacity-40"
                >
                  <Phone className="w-4 h-4" />
                </button>
                <button
                  onClick={messageDriver}
                  disabled={!driver.phone}
                  aria-label="Message driver"
                  className="w-10 h-10 rounded-full bg-white text-[#1D4ED8] border border-[#3B82F6]/30 flex items-center justify-center active:scale-95 transition disabled:opacity-40"
                >
                  <MessageCircle className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* LIVE METRICS */}
          {isActive && (
            <div className="grid grid-cols-4 gap-2">
              <Metric
                icon={<Clock className="w-3.5 h-3.5" />}
                label="ETA"
                value={etaMinutes !== null ? `${etaMinutes}m` : "—"}
                accent
              />
              <Metric
                icon={<MapPin className="w-3.5 h-3.5" />}
                label="Left"
                value={distKm !== null ? `${distKm.toFixed(1)}km` : "—"}
              />
              <Metric
                icon={<Gauge className="w-3.5 h-3.5" />}
                label="Speed"
                value={speedKmh !== null ? `${speedKmh}` : "—"}
                suffix="km/h"
              />
              <Metric
                icon={<NavIcon className="w-3.5 h-3.5" />}
                label="Arrive"
                value={arrivalTime ?? "—"}
              />
            </div>
          )}

          {/* TRIP PROGRESS TIMELINE */}
          {!isCancelled && (
            <div className="rounded-2xl border border-border/50 bg-white dark:bg-card p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Trip Progress
              </p>
              <div className="flex items-start justify-between gap-1">
                {STEPS.map((s, idx) => {
                  const done = idx < currentStepIdx || isCompleted;
                  const active = idx === currentStepIdx && !isCompleted;
                  return (
                    <div key={s.key} className="flex-1 flex flex-col items-center min-w-0">
                      <div className="flex items-center w-full">
                        <div
                          className={`flex-1 h-0.5 ${idx === 0 ? "bg-transparent" : done || active ? "bg-[#2563EB]" : "bg-border"}`}
                        />
                        <div
                          className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                            done
                              ? "bg-[#2563EB] text-white"
                              : active
                                ? "bg-white ring-2 ring-[#2563EB] text-[#2563EB]"
                                : "bg-white ring-1 ring-border text-muted-foreground"
                          }`}
                        >
                          {done ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : active ? (
                            <motion.span
                              animate={{ scale: [1, 1.4, 1] }}
                              transition={{ repeat: Infinity, duration: 1.6 }}
                              className="w-2 h-2 rounded-full bg-[#2563EB]"
                            />
                          ) : (
                            <Circle className="w-2.5 h-2.5" />
                          )}
                        </div>
                        <div
                          className={`flex-1 h-0.5 ${idx === STEPS.length - 1 ? "bg-transparent" : done ? "bg-[#2563EB]" : "bg-border"}`}
                        />
                      </div>
                      <p
                        className={`text-[9px] font-semibold text-center mt-1.5 leading-tight ${
                          done || active ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {s.label}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ROUTE */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-2xl bg-[#F8FAFF] border border-[#3B82F6]/10">
            <div className="flex flex-col items-center gap-0.5">
              <div className="w-2 h-2 rounded-full bg-[#2563EB]" />
              <div className="w-px h-4 bg-border" />
              <div className="w-2 h-2 rounded-full bg-rose-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-foreground truncate">
                {ride.pickup_address}
              </p>
              <p className="text-[12px] text-muted-foreground truncate mt-1.5">
                {ride.dropoff_address}
              </p>
            </div>
          </div>

          {/* FARE + PAYMENT */}
          <div className="rounded-2xl border border-border/50 bg-white dark:bg-card p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Fare
                </p>
                <p className="text-2xl font-black text-[#1D4ED8] tabular-nums leading-tight mt-0.5">
                  {ride.fare != null ? `$${Number(ride.fare).toFixed(2)}` : "—"}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {isWallet ? (
                  <Badge tone="blue" icon={<Wallet className="w-3 h-3" />}>
                    Wallet
                  </Badge>
                ) : (
                  <Badge tone="emerald" icon={<Banknote className="w-3 h-3" />}>
                    Cash
                  </Badge>
                )}
                {studentApplied && (
                  <Badge tone="violet" icon={<GraduationCap className="w-3 h-3" />}>
                    Student
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* COMPLETED / CANCELLED */}
          {isCompleted && (
            <div className="text-center py-3 rounded-2xl bg-[#DBEAFE] text-[#1D4ED8]">
              <p className="text-sm font-black">Trip Completed 🎉</p>
              <p className="text-xs opacity-80">Thanks for riding with PickMe</p>
            </div>
          )}
          {isCancelled && (
            <div className="text-center py-3 rounded-2xl bg-destructive/10">
              <p className="text-sm font-bold text-destructive">Trip Cancelled</p>
            </div>
          )}

          {/* ACTIONS: SHARE + EMERGENCY */}
          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <button
              onClick={shareTrip}
              className="h-11 rounded-2xl bg-white border border-[#3B82F6]/30 text-[#1D4ED8] text-sm font-bold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition"
            >
              <Share2 className="w-4 h-4" /> Share Trip
            </button>
            <button
              onClick={emergency}
              className="h-11 rounded-2xl bg-destructive text-white text-sm font-bold inline-flex items-center justify-center gap-1.5 shadow-[0_8px_18px_-6px_rgba(220,38,38,0.55)] active:scale-[0.98] transition"
            >
              <AlertTriangle className="w-4 h-4" /> Emergency
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  suffix,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-2 py-2 text-center ${
        accent
          ? "bg-gradient-to-br from-[#1D4ED8] to-[#3B82F6] text-white border-transparent shadow-[0_6px_14px_-6px_rgba(37,99,235,0.6)]"
          : "bg-white dark:bg-card border-border/50 text-foreground"
      }`}
    >
      <div
        className={`flex items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-wider ${
          accent ? "text-white/85" : "text-muted-foreground"
        }`}
      >
        {icon} {label}
      </div>
      <p className="text-sm font-black tabular-nums mt-0.5 leading-tight">
        {value}
        {suffix && (
          <span className={`text-[9px] font-bold ml-0.5 ${accent ? "text-white/80" : "text-muted-foreground"}`}>
            {suffix}
          </span>
        )}
      </p>
    </div>
  );
}

function Badge({
  icon,
  children,
  tone,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  tone: "blue" | "emerald" | "violet";
}) {
  const tones = {
    blue: "bg-[#DBEAFE] text-[#1D4ED8] border-[#3B82F6]/20",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${tones[tone]}`}
    >
      {icon} {children}
    </span>
  );
}
