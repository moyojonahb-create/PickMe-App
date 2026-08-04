import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptOffer } from "@/lib/offerHelpers";
import { completeTrip, settleTrip } from "@/lib/completeTrip";

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
vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));
vi.mock("@/lib/goBackendClient", () => ({ goBackend: goBackendMock }));
vi.mock("@/lib/avatarUrl", () => ({ resolveAvatarUrl: vi.fn((url) => Promise.resolve(url)) }));
vi.mock("@/lib/queryCache", () => ({ getCached: vi.fn(() => null), setCache: vi.fn() }));

describe("API call helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: "rider-1" } }, error: null });
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
    goBackendMock.post.mockResolvedValue({ ok: true });
  });

  it("acceptOffer posts the accept action to the Go backend", async () => {
    await acceptOffer("ride-1", "offer-1");

    expect(goBackendMock.post).toHaveBeenCalledWith("/api/rides/ride-1/offers/offer-1/accept");
  });

  it("acceptOffer accepts an Offer object by extracting its id", async () => {
    await acceptOffer("ride-1", { id: "offer-2" } as never);

    expect(goBackendMock.post).toHaveBeenCalledWith("/api/rides/ride-1/offers/offer-2/accept");
  });

  it("acceptOffer propagates a Go backend rejection", async () => {
    goBackendMock.post.mockRejectedValue(new Error("Offer not found"));

    await expect(acceptOffer("ride-1", "missing-offer")).rejects.toThrow("Offer not found");
  });

  it("completeTrip calls the Go backend to complete, then auto-settles on success", async () => {
    const result = await completeTrip("ride-1");

    expect(goBackendMock.post).toHaveBeenCalledWith("/api/rides/ride-1/complete");
    expect(goBackendMock.post).toHaveBeenCalledWith("/api/rides/ride-1/settle");
    expect(result.ok).toBe(true);
  });

  it("completeTrip throws Go backend errors", async () => {
    goBackendMock.post.mockRejectedValue(new Error("Go completion failed"));

    await expect(completeTrip("ride-1")).rejects.toThrow("Go completion failed");
  });

  it("does not auto-settle when the backend reports the trip cannot be completed", async () => {
    goBackendMock.post.mockResolvedValueOnce({ ok: false, reason: "Trip can only be completed after it has started" });

    const result = await completeTrip("ride-1");

    expect(result).toEqual({ ok: false, reason: "Trip can only be completed after it has started" });
    expect(goBackendMock.post).toHaveBeenCalledTimes(1);
    expect(goBackendMock.post).toHaveBeenCalledWith("/api/rides/ride-1/complete");
  });

  it("settleTrip rejects invalid user/session", async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } });
    goBackendMock.post.mockRejectedValue(new Error("Not authenticated"));

    await expect(settleTrip("ride-1")).rejects.toThrow("Not authenticated");
    expect(goBackendMock.post).toHaveBeenCalledWith("/api/rides/ride-1/settle");
  });
});
