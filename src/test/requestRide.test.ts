import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestRide } from "@/lib/requestRide";

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    getSession: vi.fn(),
  },
}));

const goBackendMock = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("@/lib/supabaseClient", () => ({ supabase: supabaseMock }));
vi.mock("@/lib/goBackendClient", () => ({ goBackend: goBackendMock }));
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

describe("requestRide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnline(true);
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: undefined, email_confirmed_at: null } },
      error: null,
    });
  });

  it("creates a cash ride via the Go backend", async () => {
    goBackendMock.post.mockResolvedValue({ id: "ride-1" });

    const result = await requestRide(validInput);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ride.id).toBe("ride-1");
    expect(goBackendMock.post).toHaveBeenCalledWith(
      "/api/rides",
      expect.objectContaining({
        user_id: "user-1",
        pickup_address: "Pickup",
        dropoff_address: "Dropoff",
        pickup_lon: validInput.pickup_lng,
        dropoff_lon: validInput.dropoff_lng,
        payment_method: "cash",
        status: "pending",
      }),
    );
  });

  it("returns a safe error when the user is not authenticated", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await requestRide(validInput);

    expect(result).toEqual({ ok: false, error: "You must be logged in to request a ride." });
    expect(goBackendMock.post).not.toHaveBeenCalled();
  });

  it("rejects invalid ride input before calling the API", async () => {
    const result = await requestRide({ ...validInput, pickup_address: "", fare: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Pickup address is required.");
    expect(goBackendMock.post).not.toHaveBeenCalled();
  });

  it("rejects invalid payment methods before calling the API", async () => {
    const result = await requestRide({ ...validInput, payment_method: "bitcoin" });

    expect(result).toEqual({ ok: false, error: "Select a valid payment method." });
    expect(goBackendMock.post).not.toHaveBeenCalled();
  });

  it("returns a business-logic error when the backend responds with ok:false", async () => {
    goBackendMock.post.mockResolvedValue({ ok: false, reason: "No drivers available" });

    const result = await requestRide(validInput);

    expect(result).toEqual({ ok: false, error: "No drivers available" });
  });

  it("surfaces Go backend failures", async () => {
    goBackendMock.post.mockRejectedValue(new Error("Network error while contacting backend"));

    const result = await requestRide(validInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Ride request failed: Network error while contacting backend");
    }
  });

  it("falls back to a top-level ride_id when the backend omits a nested ride object", async () => {
    goBackendMock.post.mockResolvedValue({ ride_id: "ride-1", fare: 5 });

    const result = await requestRide(validInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ride.id).toBe("ride-1");
      expect(result.ride.fare).toBe(5);
    }
  });

  it("sends the wallet payment method through to the Go backend", async () => {
    goBackendMock.post.mockResolvedValue({ id: "ride-wallet" });

    const result = await requestRide({ ...validInput, payment_method: "wallet" });

    expect(goBackendMock.post).toHaveBeenCalledWith(
      "/api/rides",
      expect.objectContaining({ payment_method: "wallet" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ride.id).toBe("ride-wallet");
  });
});
