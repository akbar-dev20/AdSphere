import { describe, it, expect } from "vitest";
import { SUPPORTED_CITIES } from "../src/services/subscriptions.js";

// The list of cities MUST stay in lockstep with the
// advRec_location_check constraint in the database. The plan form's
// location dropdown and the listings page filter are built from this
// constant, so any change here requires a matching migration.
describe("SUPPORTED_CITIES", () => {
  it("contains exactly the five cities allowed by the database constraint", () => {
    expect(SUPPORTED_CITIES).toEqual([
      "Noida",
      "Mumbai",
      "Delhi",
      "Bangalore",
      "Pune",
    ]);
  });

  it("has no duplicates, blanks, or case inconsistencies", () => {
    expect(new Set(SUPPORTED_CITIES).size).toBe(SUPPORTED_CITIES.length);
    SUPPORTED_CITIES.forEach((city) => {
      expect(city.trim()).toBe(city);
      expect(city).toMatch(/^[A-Z][a-z]+$/);
    });
  });
});
