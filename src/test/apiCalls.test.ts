import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptOffer } from "@/lib/offerHelpers";
import { completeTrip, settleTrip } from "@/lib/completeTrip";

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    getSession: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
  functions: {
    invoke: vi.fn(),
  },
}));

const goBackendMock = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("@/lib/supabaseClient", () => ({ supabase: supabaseMock }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));
vi.mock("@/lib/goBackendClient", () => ({ goBackend: goBackendMock }));
vi.mock("@/lib/avatarUrl", () => ({ resolveAvatarUrl: vi.fn((url) => Promise.resolve(url)) }));
vi.mock("@/lib/queryCache", () => ({ getCached: vi.fn(() => null), setCache: vi.fn() }));

function mockOfferAcceptChain() {
  const offerSingle = vi.fn().mockResolvedValue({ data: { driver_id: "driver-user-1" }, error: null });
  const offerEq1 = vi.fn(() => ({ single: offerSingle }));
  const offerSelect = vi.fn(() => ({ eq: offerEq1 }));

  const driverMaybeSingle = vi.fn().mockResolvedValue({ data: { id: "driver-row-1" }, error: null });
  const driverEq = vi.fn(() => ({ maybeSingle: driverMaybeSingle }));
  const driverSelect = vi.fn(() => ({ eq: driverEq }));

  const updateResult = { error: null };
  const offerUpdateEq = vi.fn().mockResolvedValue(updateResult);
  const offerUpdateNeq = vi.fn().mockResolvedValue(updateResult);
  const offerUpdateEqForRide = vi.fn(() => ({ neq: offerUpdateNeq }));
  const offerUpdate = vi
    .fn()
    .mockReturnValueOnce({ eq: offerUpdateEq })
    .mockReturnValueOnce({ eq: offerUpdateEqForRide });

  const rideUpdateEq = vi.fn().mockResolvedValue(updateResult);
  const rideUpdate = vi.fn(() => ({ eq: rideUpdateEq }));

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "offers") return { select: offerSelect, update: offerUpdate };
    if (table === "drivers") return { select: driverSelect };
    if (table === "rides") return { update: rideUpdate };
    throw new Error(`Unexpected table ${table}`);
  });

  return { offerUpdate, rideUpdate };
}

describe("API call helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: "rider-1" } }, error: null });
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
    goBackendMock.post.mockResolvedValue({ ok: true });
  });

  it("acceptOffer updates offer, ride assignment, and competing offers", async () => {
    const chain = mockOfferAcceptChain();

    await acceptOffer("ride-1", "offer-1");

    expect(chain.offerUpdate).toHaveBeenCalledWith({ status: "accepted" });
    expect(chain.rideUpdate).toHaveBeenCalledWith({ status: "accepted", driver_id: "driver-row-1" });
    expect(chain.offerUpdate).toHaveBeenCalledWith({ status: "rejected" });
  });

  it("acceptOffer fails safely on an empty offer response", async () => {
    const offerSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    supabaseMock.from.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: offerSingle })) })),
    });

    await expect(acceptOffer("ride-1", "missing-offer")).rejects.toThrow("Offer not found");
  });

  it("completeTrip calls RPC and then settlement when completion succeeds", async () => {
    supabaseMock.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "ride-1", status: "in_progress", fare: 8, payment_method: "cash", driver_id: "driver-1" },
            error: null,
          }),
        })),
      })),
    });
    const result = await completeTrip("ride-1");

    expect(goBackendMock.post).toHaveBeenCalledWith("/api/rides/ride-1/complete");
    expect(goBackendMock.post).toHaveBeenCalledWith("/api/rides/ride-1/settle");
    expect(result.ok).toBe(true);
  });

  it("completeTrip throws Go backend errors", async () => {
    supabaseMock.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "ride-1", status: "in_progress", fare: 8, payment_method: "cash", driver_id: "driver-1" },
            error: null,
          }),
        })),
      })),
    });
    goBackendMock.post.mockRejectedValue(new Error("Go completion failed"));

    await expect(completeTrip("ride-1")).rejects.toThrow("Go completion failed");
  });

  it("completeTrip rejects trips that have not started", async () => {
    supabaseMock.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "ride-1", status: "arrived", fare: 8, payment_method: "cash", driver_id: "driver-1" },
            error: null,
          }),
        })),
      })),
    });

    await expect(completeTrip("ride-1")).rejects.toThrow("Trip can only be completed after it has started");
    expect(goBackendMock.post).not.toHaveBeenCalled();
  });

  it("settleTrip rejects invalid user/session", async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } });
    goBackendMock.post.mockRejectedValue(new Error("Not authenticated"));

    await expect(settleTrip("ride-1")).rejects.toThrow("Not authenticated");
    expect(goBackendMock.post).toHaveBeenCalledWith("/api/rides/ride-1/settle");
  });
});
