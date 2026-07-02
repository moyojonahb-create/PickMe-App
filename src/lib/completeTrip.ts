import { goBackend } from "@/lib/goBackendClient";

export async function completeTrip(tripId: string) {
  if (!tripId?.trim()) throw new Error("Trip id is required");

  const result = await goBackend.post<{
    ok: boolean;
    fare_usd?: number;
    commission_usd?: number;
    driver_earnings_usd?: number;
    reason?: string;
  }>(`/api/rides/${tripId}/complete`);

  // Auto-settle to platform ledger after successful completion
  if (result.ok) {
    try {
      await settleTrip(tripId);
    } catch (e) {
      console.warn("Settlement failed (non-blocking):", e);
    }
  }

  return result;
}

export async function settleTrip(tripId: string) {
  return goBackend.post<{ ok: boolean; alreadySettled?: boolean; settlement?: unknown }>(`/api/rides/${tripId}/settle`);
}
