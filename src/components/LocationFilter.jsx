import { MapPin } from "lucide-react";
import { SUPPORTED_CITIES } from "../services/subscriptions";

// "All" plus exactly the cities accepted by the advRec.location column
// (single source of truth: SUPPORTED_CITIES in services/subscriptions.js).
const LOCATION_OPTIONS = ["All", ...SUPPORTED_CITIES];

/**
 * Location filter for the advertisements listing page.
 *
 * A button group whose options are exactly: All, Noida, Mumbai, Delhi,
 * Bangalore, Pune. "All" (the default) shows every advertisement; picking
 * a city passes that value to the ads fetch API as a filter parameter.
 */
export default function LocationFilter({ value, onChange }) {
  return (
    <nav
      className="category-nav location-filter"
      aria-label="Filter advertisements by location"
    >
      {LOCATION_OPTIONS.map((city) => (
        <button
          key={city}
          type="button"
          className={`category-button ${value === city ? "active" : ""}`}
          aria-pressed={value === city}
          onClick={() => onChange(city)}
        >
          {city === "All" && <MapPin size={16} />}
          <span>{city}</span>
        </button>
      ))}
    </nav>
  );
}
