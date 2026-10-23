import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase client so submitPlanAdvertisement can be exercised
// without network access. The rpc mock records the payload it receives.
const rpcMock = vi.fn();

vi.mock("../src/lib/supabase.js", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: (...args) => rpcMock(...args),
    storage: { from: vi.fn() },
  },
}));

import { submitPlanAdvertisement } from "../src/services/subscriptions.js";

const USER_ID = "2e4abd3f-ae47-4f9a-afa2-220a171ffc9e";

function baseForm(overrides = {}) {
  return {
    companyName: "Test Company",
    headline: "Test headline",
    category: "Eat",
    location: "Noida",
    address: "Test address",
    website: "",
    rating: "",
    reviews: "",
    paymentReference: "TEST-REF-123",
    paymentProof: null,
    imageFiles: [],
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
});

describe("submitPlanAdvertisement location handling", () => {
  it("submits the selected city as a single text string", async () => {
    await submitPlanAdvertisement({
      tier: "T3",
      form: baseForm({ location: "Noida" }),
      userId: USER_ID,
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, { p_payload }] = rpcMock.mock.calls[0];
    expect(fnName).toBe("submit_advertisement");
    expect(p_payload.location).toBe("Noida");
    expect(typeof p_payload.location).toBe("string");
    expect(p_payload.locations).toBeUndefined();
  });

  it("accepts every supported city", async () => {
    for (const city of ["Noida", "Mumbai", "Delhi", "Bangalore", "Pune"]) {
      rpcMock.mockClear();
      await expect(
        submitPlanAdvertisement({
          tier: "T3",
          form: baseForm({ location: city }),
          userId: USER_ID,
        })
      ).resolves.toEqual({ ok: true });
      expect(rpcMock.mock.calls[0][1].p_payload.location).toBe(city);
    }
  });

  it("rejects a city outside the supported list before calling the API", async () => {
    await expect(
      submitPlanAdvertisement({
        tier: "T3",
        form: baseForm({ location: "Chennai" }),
        userId: USER_ID,
      })
    ).rejects.toThrow(/supported cities/i);

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an empty location", async () => {
    await expect(
      submitPlanAdvertisement({
        tier: "T3",
        form: baseForm({ location: "   " }),
        userId: USER_ID,
      })
    ).rejects.toThrow(/supported cities/i);

    expect(rpcMock).not.toHaveBeenCalled();
  });
});
