import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestRide } from "@/lib/requestRide";

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    getSession: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabaseClient", () => ({ supabase: supabaseMock }));
vi.mock("@/lib/offlineQueue", () => ({ queueOfflineRide: vi.fn() }));
vi.mock("@/lib/fraudDetection", () => ({
  detectSuspiciousPatterns: vi.fn(() => Promise.resolve([])),
  reportFraudFlag: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/rateLimit", () => ({ isRateLimited: vi.fn(() => false) }));

const validInput = {
  pickup_address: "Pickup",
  dropoff_address: "Dropoff",
  fare: 5,
  distance_km: 2.5,
  duration_minutes: 8,
  pickup_lat: -17.8,
  pickup_lng: 31.0,
  dropoff_lat: -17.81,
  dropoff_lng: 31.02,
  payment_method: "cash",
};

function mockOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

function mockRideFetch(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  supabaseMock.from.mockReturnValue({ select });
  return { select, eq, maybeSingle };
}

describe("requestRide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnline(true);
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: undefined, email_confirmed_at: null } },
      error: null,
    });
  });

  it("creates a cash ride through the server-side fare RPC", async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { ok: true, ride_id: "ride-1", fare: 5 }, error: null });
    mockRideFetch({ data: { id: "ride-1", status: "pending" }, error: null });

    const result = await requestRide(validInput);

    expect(result).toEqual({ ok: true, ride: { id: "ride-1", status: "pending" } });
    expect(supabaseMock.rpc).toHaveBeenCalledWith("request_cash_ride", {
      p_payload: expect.objectContaining({
        user_id: "user-1",
        pickup_address: "Pickup",
        dropoff_address: "Dropoff",
        pickup_lon: validInput.pickup_lng,
        dropoff_lon: validInput.dropoff_lng,
        payment_method: "cash",
        status: "pending",
      }),
    });
  });

  it("returns a safe error when the user is not authenticated", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await requestRide(validInput);

    expect(result).toEqual({ ok: false, error: "You must be logged in to request a ride." });
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("rejects invalid ride input before calling the API", async () => {
    const result = await requestRide({ ...validInput, pickup_address: "", fare: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Pickup address is required.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("rejects invalid payment methods before calling the API", async () => {
    const result = await requestRide({ ...validInput, payment_method: "bitcoin" });

    expect(result).toEqual({ ok: false, error: "Select a valid payment method." });
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("surfaces network/API RPC failures", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "Network request failed", details: "fetch failed", hint: "Retry later" },
    });

    const result = await requestRide(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Ride request failed: Network request failed");
      expect(result.error).toContain("Details: fetch failed");
      expect(result.error).toContain("Hint: Retry later");
    }
  });

  it("handles an empty successful fetch response without crashing", async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { ok: true, ride_id: "ride-1", fare: 5 }, error: null });
    mockRideFetch({ data: null, error: null });

    const result = await requestRide(validInput);

    expect(result).toEqual({ ok: true, ride: { id: "ride-1", fare: 5 } });
  });

  it("uses wallet RPC and handles empty fetch response", async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { ok: true, ride_id: "ride-wallet" }, error: null });
    supabaseMock.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })),
      })),
    });

    const result = await requestRide({ ...validInput, payment_method: "wallet" });

    expect(supabaseMock.rpc).toHaveBeenCalledWith("request_wallet_ride", expect.any(Object));
    expect(result).toEqual({ ok: true, ride: { id: "ride-wallet" } });
  });
});
