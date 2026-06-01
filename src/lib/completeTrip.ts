import { backendPost } from "@/lib/backendClient";

export async function completeTrip(tripId: string) {
  if (!tripId?.trim()) throw new Error("Trip id is required");
  return backendPost<{
    ok: boolean;
    fare_usd?: number;
    commission_usd?: number;
    driver_earnings_usd?: number;
    reason?: string;
  }>(`/api/rides/${tripId}/complete`);
}

export async function settleTrip(tripId: string) {
  return backendPost<{ ok: boolean; alreadySettled?: boolean; settlement?: unknown }>(
    `/api/rides/${tripId}/settle`
  );
}
