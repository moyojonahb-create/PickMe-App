import MapboxMap, { type Coords, type MapEtaCard } from "@/components/MapboxMap";

export type TripPhase = "driver_to_pickup" | "pickup_to_dropoff" | "idle";

interface TripMapboxMapProps {
  driverLocation: Coords | null;
  pickup: Coords;
  dropoff: Coords;
  tripStatus: string;
  height?: string;
  className?: string;
  routeGradient?: boolean;
  mapCards?: MapEtaCard[];
  bottomInset?: number;
}

function getPhase(status: string): TripPhase {
  if (["accepted", "enroute", "enroute_pickup", "driver_arriving"].includes(status)) return "driver_to_pickup";
  if (["arrived", "driver_arrived", "in_progress", "ongoing", "near_destination"].includes(status)) return "pickup_to_dropoff";
  return "idle";
}

export default function TripMapboxMap({
  driverLocation,
  pickup,
  dropoff,
  tripStatus,
  height,
  className,
  routeGradient,
  mapCards,
  bottomInset,
}: TripMapboxMapProps) {
  const phase = getPhase(tripStatus);
  const routeCoordinates =
    phase === "driver_to_pickup" && driverLocation
      ? [driverLocation, pickup]
      : phase === "pickup_to_dropoff"
        ? [driverLocation ?? pickup, dropoff]
        : [pickup, dropoff];

  return (
    <MapboxMap
      pickup={pickup}
      dropoff={dropoff}
      driverLocation={driverLocation}
      routeCoordinates={routeCoordinates}
      height={height ?? "300px"}
      className={className}
      routeGradient={routeGradient}
      mapCards={mapCards}
      bottomInset={bottomInset}
    />
  );
}
