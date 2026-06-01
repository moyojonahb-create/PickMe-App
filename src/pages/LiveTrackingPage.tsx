import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Car, Shield } from "lucide-react";
import { motion } from "framer-motion";
import { backendSocketClient, eventDriverId } from "@/lib/backendSocketClient";
import TripGoogleMap from "@/components/TripGoogleMap";

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
}

interface DriverInfo {
  vehicle_make: string | null;
  vehicle_model: string | null;
  plate_number: string | null;
  vehicle_type: string;
  user_id: string;
  fullName: string;
}

interface DriverLocation {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  updated_at: string;
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
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

export default function LiveTrackingPage() {
  const { tripId } = useParams<{ tripId: string }>();

  const [ride, setRide] = useState<RideInfo | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [driverLoc, setDriverLoc] = useState<DriverLocation | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  // LOAD RIDE
  useEffect(() => {
    if (!tripId) return;

    (async () => {
      const { data: rideData, error: rideErr } = await supabase
        .from("rides")
        .select(
          `
          id,
          pickup_address,
          dropoff_address,
          status,
          driver_id,
          pickup_lat,
          pickup_lon,
          dropoff_lat,
          dropoff_lon,
          fare,
          passenger_name
        `
        )
        .eq("id", tripId)
        .maybeSingle();

      if (rideErr || !rideData) {
        setError("Trip not found or access denied");
        setLoading(false);
        return;
      }

      setRide(rideData as unknown as RideInfo);

      // LOAD DRIVER
      if (rideData.driver_id) {
        const { data: driverData } = await supabase
          .from("drivers")
          .select(
            `
            vehicle_make,
            vehicle_model,
            plate_number,
            vehicle_type,
            user_id
          `
          )
          .eq("id", rideData.driver_id)
          .maybeSingle();

        if (driverData) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", driverData.user_id)
            .maybeSingle();

          setDriver({
            ...driverData,
            fullName: profile?.full_name || "Your Driver",
          });
        }
      }

      setLoading(false);
    })();
  }, [tripId]);

  // REALTIME DRIVER LOCATION
  useEffect(() => {
    if (!driver?.user_id) return;

    // INITIAL LOCATION FROM SUPABASE
    supabase
      .from("live_locations")
      .select(
        `
        latitude,
        longitude,
        heading,
        speed,
        updated_at
      `
      )
      .eq("user_id", driver.user_id)
      .eq("user_type", "driver")
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setDriverLoc(data);
        }
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
        updated_at: typeof data.updated_at === "string" ? data.updated_at : new Date().toISOString(),
      });
    });

    // SUPABASE FALLBACK REALTIME
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

          if (loc?.latitude) {
            setDriverLoc(loc);
          }
        }
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

          setRide((prev) =>
            prev
              ? {
                  ...prev,
                  ...updated,
                }
              : prev
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId]);

  // LOADING
  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Car
              className="w-7 h-7 text-primary animate-bounce"
              style={{ animationDuration: "2s" }}
            />
          </div>

          <span className="text-sm text-muted-foreground">
            Loading trip…
          </span>
        </div>
      </div>
    );
  }

  // ERROR
  if (error || !ride) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto" />

          <h1 className="text-xl font-bold text-foreground">
            Trip Not Found
          </h1>

          <p className="text-sm text-muted-foreground">
            {error || "This trip link may have expired."}
          </p>

          <a
            href="/"
            className="inline-block mt-4 px-6 py-3 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm"
          >
            Get the App
          </a>
        </div>
      </div>
    );
  }

  const isActive = [
    "accepted",
    "driver_arriving",
    "driver_arrived",
    "in_progress",
  ].includes(ride.status);

  const isCompleted = ride.status === "completed";

  const isCancelled = ride.status === "cancelled";

  const isInProgress = ride.status === "in_progress";

  const targetLat = isInProgress
    ? ride.dropoff_lat
    : ride.pickup_lat;

  const targetLon = isInProgress
    ? ride.dropoff_lon
    : ride.pickup_lon;

  const etaMinutes = driverLoc
    ? Math.max(
        1,
        Math.round(
          (haversineKm(
            driverLoc.latitude,
            driverLoc.longitude,
            targetLat,
            targetLon
          ) /
            25) *
            60
        )
      )
    : null;

  const distKm = driverLoc
    ? haversineKm(
        driverLoc.latitude,
        driverLoc.longitude,
        targetLat,
        targetLon
      )
    : null;

  const statusLabels: Record<
    string,
    {
      label: string;
      color: string;
      bg: string;
    }
  > = {
    pending: {
      label: "Waiting for driver",
      color: "text-yellow-600",
      bg: "bg-yellow-500",
    },

    searching: {
      label: "Searching for driver",
      color: "text-yellow-600",
      bg: "bg-yellow-500",
    },

    accepted: {
      label: "Driver en route to pickup",
      color: "text-primary",
      bg: "bg-primary",
    },

    driver_arriving: {
      label: "Driver on the way",
      color: "text-primary",
      bg: "bg-primary",
    },

    driver_arrived: {
      label: "Driver has arrived",
      color: "text-primary",
      bg: "bg-primary",
    },

    in_progress: {
      label: "Trip in progress",
      color: "text-primary",
      bg: "bg-primary",
    },

    completed: {
      label: "Trip completed",
      color: "text-muted-foreground",
      bg: "bg-muted-foreground",
    },

    cancelled: {
      label: "Trip cancelled",
      color: "text-destructive",
      bg: "bg-destructive",
    },
  };

  const status =
    statusLabels[ride.status] || statusLabels.pending;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background">

      {/* MAP */}
      <div className="absolute inset-0 bottom-0">
        <TripGoogleMap
          pickup={{
            lat: ride.pickup_lat,
            lng: ride.pickup_lon,
          }}
          dropoff={{
            lat: ride.dropoff_lat,
            lng: ride.dropoff_lon,
          }}
          driverLocation={
            driverLoc
              ? {
                  lat: driverLoc.latitude,
                  lng: driverLoc.longitude,
                }
              : null
          }
          tripStatus={ride.status}
          height="100%"
        />
      </div>

      {/* TOP BAR */}
      <div
        className="absolute top-0 left-0 right-0 z-40"
        style={{
          paddingTop:
            "calc(env(safe-area-inset-top) + 8px)",
        }}
      >
        <div className="mx-4 px-4 py-3 rounded-2xl bg-card/95 backdrop-blur-md shadow-lg flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: "var(--gradient-primary)",
            }}
          >
            <Car className="w-5 h-5 text-primary-foreground" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground">
              Live Trip Tracking
            </p>

            <p className="text-[10px] text-muted-foreground">
              Shared via Voyex
            </p>
          </div>

          {etaMinutes && isActive && (
            <motion.div
              key={etaMinutes}
              initial={{ scale: 1.2 }}
              animate={{ scale: 1 }}
              className="text-right"
            >
              <p className="text-xl font-black text-primary tabular-nums">
                {etaMinutes}
              </p>

              <p className="text-[9px] font-semibold text-muted-foreground uppercase">
                min
              </p>
            </motion.div>
          )}
        </div>
      </div>

      {/* BOTTOM PANEL */}
      <div
        className="absolute bottom-0 left-0 right-0 z-50 bg-card rounded-t-[28px] shadow-[0_-8px_40px_rgba(0,0,0,0.12)]"
        style={{
          paddingBottom:
            "calc(env(safe-area-inset-bottom) + 12px)",
        }}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        <div className="px-5 pb-4 space-y-3">

          {/* STATUS */}
          <div className="flex items-center gap-2.5">
            <motion.div
              animate={
                isActive
                  ? { scale: [1, 1.3, 1] }
                  : {}
              }
              transition={{
                repeat: Infinity,
                duration: 1.5,
              }}
              className={`w-2.5 h-2.5 rounded-full ${status.bg}`}
            />

            <span
              className={`text-sm font-bold ${status.color}`}
            >
              {status.label}
            </span>

            {distKm !== null && isActive && (
              <span className="ml-auto text-xs text-muted-foreground">
                {distKm.toFixed(1)} km away
              </span>
            )}
          </div>

          {/* ROUTE */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-muted/40">
            <div className="flex flex-col items-center gap-0.5">
              <div className="w-2 h-2 rounded-full bg-primary" />

              <div className="w-px h-4 bg-border" />

              <div className="w-2 h-2 rounded-full bg-accent" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">
                {ride.pickup_address}
              </p>

              <p className="text-xs text-muted-foreground truncate mt-1.5">
                {ride.dropoff_address}
              </p>
            </div>
          </div>

          {/* DRIVER CARD */}
          {driver && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/40">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Car className="w-5 h-5 text-primary" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">
                  {driver.fullName}
                </p>

                <p className="text-xs text-muted-foreground">
                  {driver.vehicle_make}{" "}
                  {driver.vehicle_model} ·{" "}
                  {driver.plate_number}
                </p>
              </div>
            </div>
          )}

          {/* LIVE METRICS */}
          {driverLoc && isActive && (
            <div className="grid grid-cols-3 gap-2">

              <div className="bg-muted/40 rounded-xl p-2.5 text-center">
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {driverLoc.speed
                    ? `${(driverLoc.speed * 3.6).toFixed(0)}`
                    : "—"}
                </p>

                <p className="text-[9px] text-muted-foreground uppercase">
                  km/h
                </p>
              </div>

              <div className="bg-muted/40 rounded-xl p-2.5 text-center">
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {distKm?.toFixed(1) ?? "—"}
                </p>

                <p className="text-[9px] text-muted-foreground uppercase">
                  km left
                </p>
              </div>

              <div className="bg-muted/40 rounded-xl p-2.5 text-center">
                <p className="text-lg font-bold text-primary tabular-nums">
                  {etaMinutes ?? "—"}
                </p>

                <p className="text-[9px] text-muted-foreground uppercase">
                  min eta
                </p>
              </div>

            </div>
          )}

          {/* COMPLETED */}
          {isCompleted && (
            <div className="text-center py-3 rounded-xl bg-primary/10">
              <p className="text-2xl mb-1">🏁</p>

              <p className="text-sm font-bold text-foreground">
                Trip Completed
              </p>

              <p className="text-xs text-muted-foreground">
                The rider has arrived safely
              </p>
            </div>
          )}

          {/* CANCELLED */}
          {isCancelled && (
            <div className="text-center py-3 rounded-xl bg-destructive/10">
              <p className="text-sm font-bold text-destructive">
                Trip Cancelled
              </p>
            </div>
          )}

          {/* CTA */}
          <a
            href="/"
            className="block w-full py-3 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm text-center active:scale-[0.98] transition-all"
          >
            Get Voyex — Ride with Confidence
          </a>

        </div>
      </div>
    </div>
  );
}
