import { describe, it, expect, vi, beforeEach } from "vitest";

// Demo rows with mixed location formats — the same shapes the location
// filter must handle while migrating from text[] to text.
vi.mock("../src/data/demoAds.js", () => ({
  demoAds: [
    { id: "d1", name: "Plain text", location: "Noida", status: "active" },
    { id: "d2", name: "Legacy array", location: ["Mumbai"], status: "active" },
    {
      id: "d3",
      name: "Legacy JSON string",
      location: '["Delhi"]',
      status: "active",
    },
    { id: "d4", name: "Loose casing", location: "noida", status: "active" },
    { id: "d5", name: "Other city", location: "Chennai", status: "active" },
  ],
}));

beforeEach(() => {
  vi.resetModules();
  // Force demo mode so no network calls are made.
  vi.stubEnv("VITE_SUPABASE_URL", "");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
});

async function loadService() {
  return import("../src/services/advertisements.js");
}

describe("getPublicAdvertisements location filtering (demo mode)", () => {
  it("returns every advertisement for 'All'", async () => {
    const { getPublicAdvertisements } = await loadService();
    const { data, source } = await getPublicAdvertisements({
      location: "All",
    });

    expect(source).toBe("demo");
    expect(data).toHaveLength(5);
  });

  it("returns every advertisement when no filter is passed (backward compatible)", async () => {
    const { getPublicAdvertisements } = await loadService();
    const { data } = await getPublicAdvertisements();
    expect(data).toHaveLength(5);
  });

  it("filters to only matching ads for a specific city", async () => {
    const { getPublicAdvertisements } = await loadService();

    const noida = await getPublicAdvertisements({ location: "Noida" });
    expect(noida.data.map((ad) => ad.name).sort()).toEqual([
      "Loose casing",
      "Plain text",
    ]);

    const mumbai = await getPublicAdvertisements({ location: "Mumbai" });
    expect(mumbai.data.map((ad) => ad.name)).toEqual(["Legacy array"]);

    const delhi = await getPublicAdvertisements({ location: "Delhi" });
    expect(delhi.data.map((ad) => ad.name)).toEqual(["Legacy JSON string"]);
  });

  it("matches case-insensitively", async () => {
    const { getPublicAdvertisements } = await loadService();
    const { data } = await getPublicAdvertisements({ location: "NOIDA" });
    expect(data.map((ad) => ad.name).sort()).toEqual([
      "Loose casing",
      "Plain text",
    ]);
  });

  it("returns an empty list when no ad matches the city", async () => {
    const { getPublicAdvertisements } = await loadService();
    const { data, source } = await getPublicAdvertisements({
      location: "Bangalore",
    });
    expect(source).toBe("demo");
    expect(data).toEqual([]);
  });
});
