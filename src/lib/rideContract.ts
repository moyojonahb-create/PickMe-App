export function normalizeRideStatus(status?: unknown, rideStatus?: unknown): string {
  const raw = String(rideStatus ?? status ?? "requested").trim().toLowerCase();
  switch (raw) {
    case "":
    case "pending":
    case "requested":
      return "requested";
    case "ongoing":
    case "in_progress":
      return "in_progress";
    case "driver_arrived":
      return "arrived";
    case "enroute_pickup":
      return "enroute";
    default:
      return raw;
  }
}

export function canonicalRideStatusForBackend(status?: unknown): string {
  const normalized = normalizeRideStatus(status);
  if (normalized === "in_progress") return "ongoing";
  return normalized;
}

export function isRequestedRideStatus(status?: unknown, rideStatus?: unknown): boolean {
  return normalizeRideStatus(status, rideStatus) === "requested";
}

export function normalizeRideRow<T extends Record<string, unknown>>(row: T): T & { status: string; ride_status: string } {
  const rideStatus = String(row.ride_status ?? canonicalRideStatusForBackend(row.status));
  return {
    ...row,
    ride_status: rideStatus,
    status: normalizeRideStatus(row.status, rideStatus),
  };
}
