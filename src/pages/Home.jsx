
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  MapPin,
  Search,
  Sparkles,
  Star,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

import CategoryNav from "../components/CategoryNav";
import LocationFilter from "../components/LocationFilter";
import {
  FeaturedCard,
  LocalFavoriteCard,
  CornerCard,
} from "../components/AdvertisementCard";
import AdDetailsModal from "../components/AdDetailsModal";
import { getPublicAdvertisements } from "../services/advertisements";

/**
 * Convert image data into a consistent array of URLs.
 *
 * Supports:
 * - images: ["https://..."]
 * - images: '["https://..."]'
 * - images: "https://..."
 * - image_url: "https://..."
 */
function getImageUrls(ad) {
  const candidates = [
    ad?.images,
    ad?.image_url,
    ad?.image,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    let value = candidate;

    if (typeof value === "string") {
      const trimmed = value.trim();

      if (!trimmed) continue;

      // Handle a JSON-encoded array.
      if (trimmed.startsWith("[")) {
        try {
          value = JSON.parse(trimmed);
        } catch {
          value = trimmed;
        }
      } else {
        value = trimmed;
      }
    }

    const values = Array.isArray(value) ? value : [value];

    const urls = values
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => {
        if (!item) return false;

        try {
          const url = new URL(item);
          return url.protocol === "https:" || url.protocol === "http:";
        } catch {
          return false;
        }
      });

    if (urls.length > 0) {
      return [...new Set(urls)];
    }
  }

  return [];
}

/**
 * Treat Shop and Shopping as the same category for filtering.
 * Preserve the original category field for existing components.
 */
function normalizeCategory(category) {
  const value = String(category ?? "").trim().toLowerCase();

  if (value === "shop" || value === "shopping") {
    return "shop";
  }

  return value;
}

/**
 * Normalize the database result for the existing card components.
 *
 * Important:
 * image_url is a STRING, not an array.
 * images remains an ARRAY of image URLs.
 */
function normalizeAdvertisement(ad) {
  const tier = String(ad.tier ?? "T3").trim().toUpperCase();

const images =
  tier === "T3" ? [] : getImageUrls(ad);

  const locationValue = Array.isArray(ad.location)
    ? ad.location.filter(Boolean).join(", ")
    : String(ad.location ?? "");

  const reviewsValue = Array.isArray(ad.reviews)
    ? ad.reviews.join(" · ")
    : Array.isArray(ad.review)
      ? ad.review.join(" · ")
      : ad.reviews ?? ad.review ?? "";

  return {
    ...ad,

    // Keep both forms for compatibility with the existing components.
    images,
    image_url: images[0] ?? "",
    image: images[0] ?? "",

    location: locationValue,
    reviews: reviewsValue,

    // Some components may use description while others use review.
    description:
      ad.description ??
      (typeof reviewsValue === "string" ? reviewsValue : ""),

    website_url: ad.website_url ?? ad.website ?? "",

    tier: tier || "T3",
  };
}

/**
 * Client-side visibility check only.
 * Database/RLS rules must remain the source of truth for public visibility.
 */
function eligible(ad) {
  const status = String(ad.status ?? "").toLowerCase();

  if (
    ["expired", "inactive", "rejected", "deleted", "cancelled"].includes(
      status
    )
  ) {
    return false;
  }

  // Also account for a subscription expiry field if the service provides it.
  if (ad.subscription_expiry) {
    const expiry = new Date(ad.subscription_expiry);

    if (!Number.isNaN(expiry.getTime()) && expiry <= new Date()) {
      return false;
    }
  }

  return true;
}

function EmptyTier({ title }) {
  return (
    <div className="empty-state">
      <Sparkles size={22} />
      <p>{title}</p>
      <span>Try another category or search term.</span>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ads, setAds] = useState([]);
  const [category, setCategory] = useState("All");
  const [locationFilter, setLocationFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [selectedAd, setSelectedAd] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [source, setSource] = useState("demo");

  const loadAds = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const result = await getPublicAdvertisements({
        location: locationFilter,
      });

      if (result?.error) {
        setAds([]);
        setSource(result.source ?? "supabase");
        setError(
          `Could not load advertisements: ${
            result.error.message ?? "Unknown error"
          }`
        );
        return;
      }

      const rows = Array.isArray(result?.data) ? result.data : [];

      const normalizedAds = rows.map(normalizeAdvertisement);

      // Keep the newest records first.
      normalizedAds.sort((a, b) => {
        const dateA = new Date(a.created_at ?? 0).getTime();
        const dateB = new Date(b.created_at ?? 0).getTime();

        return (
          (Number.isNaN(dateB) ? 0 : dateB) -
          (Number.isNaN(dateA) ? 0 : dateA)
        );
      });

      setAds(normalizedAds);
      setSource(result?.source ?? "supabase");

      // Helpful diagnostic: inspect image URLs in the browser console.
      console.debug(
        "[AdSphere] Advertisements loaded:",
        normalizedAds.map((ad) => ({
          id: ad.id,
          name: ad.name,
          tier: ad.tier,
          category: ad.category,
          image_url: ad.image_url,
          images: ad.images,
        }))
      );
    } catch (err) {
      console.error("[AdSphere] Failed to load advertisements:", err);

      setAds([]);
      setError(
        `Could not load advertisements: ${
          err?.message ?? "Unexpected error"
        }`
      );
    } finally {
      setLoading(false);
    }
  }, [locationFilter]);

  useEffect(() => {
    loadAds();
  }, [loadAds]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return ads.filter((ad) => {
      const matchesCategory =
        category === "All" ||
        normalizeCategory(ad.category) === normalizeCategory(category);

      const searchableValues = [
        ad.name,
        ad.category,
        ad.subcategory,
        ad.description,
        ad.location,
        ad.address,
        ad.website,
      ];

      const matchesQuery =
        !needle ||
        searchableValues.some((value) =>
          String(value ?? "").toLowerCase().includes(needle)
        );

      return eligible(ad) && matchesCategory && matchesQuery;
    });
  }, [ads, category, query]);

  const tierAds = useCallback(
    (tier) =>
      filtered.filter(
        (ad) => String(ad.tier ?? "T3").toUpperCase() === tier
      ),
    [filtered]
  );

  const t1 = tierAds("T1");
  const t2 = tierAds("T2");
  const t3 = tierAds("T3");

  /**
   * Auth-aware "Advertise with AdSphere" CTA.
   *
   * The context session can be briefly stale while Supabase restores it from
   * storage, so the click handler re-checks the live session before deciding
   * where to send the user. Falls back to the context user when Supabase is
   * not configured (demo mode), where `user` is always null anyway.
   */
  const handleAdvertiseClick = async () => {
    let currentUser = user;

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (!error && data?.session?.user) {
          currentUser = data.session.user;
        }
      } catch (err) {
        console.error("[AdSphere] Could not verify session:", err);
      }
    }

    navigate(currentUser ? "/dashboard" : "/login");
  };

  return (
    <main>
      <section className="hero">
        <div className="hero-orb orb-one" />
        <div className="hero-orb orb-two" />

        <div className="container hero-inner">
          <span className="hero-kicker">
            <Sparkles size={16} />
            YOUR NEIGHBORHOOD, REIMAGINED
          </span>

          <h1>
            Discover. Explore. <span>Connect.</span>
          </h1>

          <p>Find businesses, offers and experiences around you.</p>

          <form
            className="search-bar"
            onSubmit={(event) => {
              event.preventDefault();

              document
                .getElementById("discover-results")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            <Search size={21} />

            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search businesses, places, or experiences…"
              aria-label="Search businesses"
            />

            <button className="button button-gradient" type="submit">
              Explore <ArrowUpRight size={17} />
            </button>
          </form>

          <div className="hero-meta">
            <span>
              <MapPin size={15} />
              Local discoveries
            </span>

            <span>
              <Star size={15} fill="currentColor" />
              Independent favorites
            </span>
          </div>
        </div>
      </section>

      <div className="container discovery-wrap" id="discover-results">
        <div className="location-filter-row">
          <span className="location-filter-label">
            <MapPin size={15} />
            Filter by location
          </span>

          <LocationFilter
            value={locationFilter}
            onChange={setLocationFilter}
          />
        </div>

        <div className="category-row">
          <div>
            <span className="section-kicker">FIND YOUR NEXT FAVORITE</span>
            <h2>Explore by interest</h2>
          </div>

          <CategoryNav value={category} onChange={setCategory} />
        </div>

        {source === "demo" && (
          <div className="preview-notice">
            <Sparkles size={16} />
            Preview mode — sample advertisements are shown. Configure
            Supabase and map your real columns to display live records.
          </div>
        )}

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>

            <button
              className="button button-light"
              type="button"
              onClick={loadAds}
            >
              Try again
            </button>
          </div>
        )}

        {loading ? (
          <div className="loading-grid">
            {[1, 2, 3].map((number) => (
              <div className="skeleton" key={number} />
            ))}
          </div>
        ) : (
          <>
            <section className="listing-section featured-section">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">HANDPICKED FOR YOU</span>
                  <h2>Featured Partner</h2>
                </div>

                <span className="spot-count">
                  {t1.length}
                  <small>SPOTS</small>
                </span>
              </div>

              {t1.length > 0 ? (
                <div className="featured-grid">
                  {t1.slice(0, 3).map((ad, index) => (
                    <FeaturedCard
                      key={ad.id}
                      ad={ad}
                      index={index}
                      onDetails={setSelectedAd}
                    />
                  ))}
                </div>
              ) : (
                <EmptyTier title="No featured partners yet" />
              )}
            </section>

            <section className="listing-section favorites-section">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">WORTH A LOOK</span>
                  <h2>More local favorites</h2>
                </div>

                <span className="spot-count">
                  {t2.length}
                  <small>SPOTS</small>
                </span>
              </div>

              {t2.length > 0 ? (
                <div className="favorites-grid">
                  {t2.slice(0, 4).map((ad, index) => (
                    <LocalFavoriteCard
                      key={ad.id}
                      ad={ad}
                      index={index}
                      onDetails={setSelectedAd}
                    />
                  ))}
                </div>
              ) : (
                <EmptyTier title="More local favorites are coming soon" />
              )}
            </section>

            <section className="listing-section corner-section">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">DISCOVER</span>
                  <h2>Around the corner</h2>
                </div>

                <span className="spot-count">
                  {t3.length}
                  <small>SPOTS</small>
                </span>
              </div>

              {t3.length > 0 ? (
                <div className="corner-grid">
                  {t3.slice(0, 8).map((ad, index) => (
                    <CornerCard
                      key={ad.id}
                      ad={ad}
                      index={index}
                      onDetails={setSelectedAd}
                    />
                  ))}
                </div>
              ) : (
                <EmptyTier title="No nearby listings match this search" />
              )}
            </section>
          </>
        )}

        <section className="advertise-cta">
          <div>
            <span className="section-kicker">HAVE A BUSINESS?</span>
            <h2>Good things deserve to be discovered.</h2>
            <p>
              Put your business in front of people looking for their next
              favorite place.
            </p>
          </div>
          <button
            type="button"
            className="button button-dark"
            onClick={handleAdvertiseClick}
          >
            Advertise with AdSphere <ArrowUpRight size={18} />
          </button>
        </section>
      </div>

      <AdDetailsModal
        ad={selectedAd}
        onClose={() => setSelectedAd(null)}
      />
    </main>
  );
}
