
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { demoAds } from "../data/demoAds";

const LIVE_TABLE = "advRec";

function firstNonEmpty(...values) {
  return values.find(
    (value) =>
      value !== null &&
      value !== undefined &&
      value !== ""
  );
}

function toDisplayText(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item === null || item === undefined) {
          return "";
        }

        if (typeof item === "object") {
          return firstNonEmpty(
            item.name,
            item.address,
            item.label,
            item.text,
            ""
          );
        }

        return String(item);
      })
      .filter(Boolean)
      .join(" · ");
  }

  if (typeof value === "object") {
    return String(
      firstNonEmpty(
        value.name,
        value.address,
        value.label,
        value.text,
        ""
      )
    );
  }

  // Legacy rows sometimes store arrays as JSON-encoded strings
  // (e.g. '["Noida"]'). Render them like real arrays, matching how the
  // location filter (rowMatchesLocation) treats them.
  const stringValue = String(value);
  const trimmed = stringValue.trim();

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);

      if (Array.isArray(parsed)) {
        return toDisplayText(parsed);
      }
    } catch {
      // Not valid JSON — fall through and show the raw string.
    }
  }

  return stringValue;
}


function normalizeImages(images) {
  if (!images) return [];

  // Support arrays, JSON-encoded arrays, and individual URLs.
  let values = images;

  if (typeof values === "string") {
    const trimmed = values.trim();

    if (!trimmed) return [];

    if (trimmed.startsWith("[")) {
      try {
        values = JSON.parse(trimmed);
      } catch {
        values = [trimmed];
      }
    } else {
      values = [trimmed];
    }
  }

  if (!Array.isArray(values)) {
    values = [values];
  }

  return [
    ...new Set(
      values
        .map((image) => {
          let url = "";

          if (typeof image === "string") {
            url = image.trim();
          } else if (image && typeof image === "object") {
            url = String(
              firstNonEmpty(
                image.url,
                image.src,
                image.image_url,
                ""
              )
            ).trim();
          }

          if (!url) return "";

          try {
            const parsed = new URL(url);

            // Only accept absolute HTTP(S) URLs.
            if (!["http:", "https:"].includes(parsed.protocol)) {
              return "";
            }

            // Reject known placeholders and sharing-page URLs.
            if (
              parsed.hostname === "example.com" ||
              parsed.hostname.endsWith(".example.com") ||
              parsed.hostname === "share.google"
            ) {
              return "";
            }

            return url;
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    ),
  ];
}


function normalizeTier(value) {
  const tier = String(value ?? "T3").trim().toUpperCase();

  if (["T1", "T2", "T3"].includes(tier)) {
    return tier;
  }

  if (["1", "TIER 1"].includes(tier)) return "T1";
  if (["2", "TIER 2"].includes(tier)) return "T2";
  if (["3", "TIER 3"].includes(tier)) return "T3";

  return "T3";
}

export function normalizeAdvertisement(row) {
  const tier = normalizeTier(row.tier);

// T3 must never display images, even if stale data exists in Supabase.
const images = tier === "T3" ? [] : normalizeImages(row.images);

  const location = toDisplayText(
    firstNonEmpty(row.address, row.location, "")
  );

  const reviews = Array.isArray(row.review)
    ? row.review.map(toDisplayText).filter(Boolean)
    : row.review
      ? [toDisplayText(row.review)].filter(Boolean)
      : [];

  return {
    id: row.id,
    company_id: row.company_id ?? null,

    name: row.name ?? "Untitled business",
    category: row.category ?? "Services",
    subcategory: "",

    // The current advRec schema has label, not description.
    description:
      row.label ?? "Discover this local business on AdSphere.",

    label: row.label ?? "",

    tier,

    // Your database stores images as an array of URLs.
    images,
    image_url: images[0] ?? "",

    // Your actual database column is website.
    website_url: row.website ?? "",

    location,
    address: row.address ?? "",

    rating:
      row.rating === null || row.rating === undefined
        ? null
        : Number(row.rating),

    reviews,
    review_count: reviews.length,

    amount:
      row.amount === null || row.amount === undefined
        ? null
        : Number(row.amount),

    payment_status: row.payment_status ?? null,
    subscription_expiry: row.subscription_expiry ?? null,
    subscription_id: row.subscription_id ?? null,
    created_at: row.created_at ?? null,

    // advRec has no status column in the supplied schema.
    // Public visibility is controlled by the database RLS policy.
    status: "active",
  };
}

/**
 * Normalize the requested location filter.
 *
 * "All" (or empty) means "no location filter" — every advertisement is
 * returned. Anything else is treated as a single city name.
 */
function normalizeLocationFilter(location) {
  const value = typeof location === "string" ? location.trim() : "";

  if (!value || value.toLowerCase() === "all") {
    return "";
  }

  return value;
}

/**
 * Client-side location match, used when the API cannot filter server-side
 * (for example while older rows still store location as an array).
 *
 * Accepts plain text ("Noida"), JS arrays (["Noida"]) and JSON-encoded
 * arrays ('["Noida"]'). Matching is case-insensitive and substring-based
 * so legacy values such as "Noida sector 18" still surface under "Noida".
 */
function rowMatchesLocation(row, city) {
  if (!city) return true;

  const needle = city.toLowerCase();
  const raw = row?.location;
  let values = [];

  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();

    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);

        values = Array.isArray(parsed) ? parsed : [trimmed];
      } catch {
        values = [trimmed];
      }
    } else {
      values = [trimmed];
    }
  }

  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(needle)
  );
}

export async function getPublicAdvertisements(options = {}) {
  const locationFilter = normalizeLocationFilter(options?.location);

  if (!isSupabaseConfigured || !supabase) {
    return {
      data: demoAds.filter((ad) => rowMatchesLocation(ad, locationFilter)),
      error: new Error(
        "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file."
      ),
      source: "demo",
    };
  }

  try {
    let request = supabase
      .from(LIVE_TABLE)
      .select("*")
      .order("created_at", { ascending: false });

    // Server-side filtering: advRec.location is a plain text column holding
    // one of the supported city names.
    if (locationFilter) {
      request = request.eq("location", locationFilter);
    }

    const { data, error } = await request;

    if (error) {
      // The filtered query was rejected (e.g. the column is still an array
      // type in the current database). Retry once without the filter and
      // narrow the rows client-side so the filter keeps working.
      if (locationFilter) {
        const fallback = await supabase
          .from(LIVE_TABLE)
          .select("*")
          .order("created_at", { ascending: false });

        if (fallback.error) {
          return {
            data: [],
            error: fallback.error,
            source: "supabase",
          };
        }

        return {
          data: (fallback.data ?? [])
            .filter((row) => rowMatchesLocation(row, locationFilter))
            .map(normalizeAdvertisement),
          error: null,
          source: "supabase",
        };
      }

      return {
        data: [],
        error,
        source: "supabase",
      };
    }

    return {
      data: (data ?? []).map(normalizeAdvertisement),
      error: null,
      source: "supabase",
    };
  } catch (error) {
    return {
      data: [],
      error,
      source: "supabase",
    };
  }
}

export async function createAdvertisement() {
  throw new Error(
    "Advertisement creation is not enabled yet. " +
    "The current advRec RLS policies only allow public SELECT."
  );
}
