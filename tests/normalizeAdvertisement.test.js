import { describe, it, expect } from "vitest";
import { normalizeAdvertisement } from "../src/services/advertisements.js";

describe("normalizeAdvertisement location handling", () => {
  it("keeps a plain text location as-is (new column type)", () => {
    const ad = normalizeAdvertisement({ id: "a1", location: "Noida", address: null });
    expect(ad.location).toBe("Noida");
  });

  it("falls back to location when address is empty", () => {
    const ad = normalizeAdvertisement({ id: "a1", location: "Pune", address: "" });
    expect(ad.location).toBe("Pune");
  });

  it("prefers address over location for display when both exist", () => {
    const ad = normalizeAdvertisement({
      id: "a1",
      location: "Noida",
      address: "Sector 18, Noida",
    });
    expect(ad.location).toBe("Sector 18, Noida");
  });

  it("still renders legacy array locations (backward compatible)", () => {
    const ad = normalizeAdvertisement({ id: "a1", location: ["Noida"], address: null });
    expect(ad.location).toBe("Noida");
  });

  it("still renders legacy JSON-encoded array locations", () => {
    const ad = normalizeAdvertisement({
      id: "a1",
      location: '["Mumbai"]',
      address: null,
    });
    expect(ad.location).toBe("Mumbai");
  });

  it("defaults to a friendly string when location is missing", () => {
    const ad = normalizeAdvertisement({ id: "a1", location: null, address: null });
    expect(ad.location).toBe("");
  });
});
