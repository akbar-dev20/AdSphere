
import { ArrowUpRight, MapPin, ImageOff, Star } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Extract a display-ready rating and review count from an advertisement.
 *
 * Handles every shape the data can arrive in:
 * - rating: 4.8 | "4.8" | null
 * - review_count: 12
 * - reviews: ["Great coffee", ...] | "Great coffee · Lovely staff" | ""
 */
function getRatingInfo(ad) {
  const ratingValue = Number(ad?.rating);
  const rating =
    Number.isFinite(ratingValue) && ratingValue > 0 ? ratingValue : null;

  let count = Number(ad?.review_count);

  if (!Number.isFinite(count) || count < 0) {
    const reviews = ad?.reviews;

    if (Array.isArray(reviews)) {
      count = reviews.filter(Boolean).length;
    } else if (typeof reviews === "string" && reviews.trim()) {
      count = 1;
    } else {
      count = 0;
    }
  }

  return { rating, count };
}

function getImageList(ad) {
  if (String(ad?.tier ?? "").trim().toUpperCase() === "T3") {
  return [];
}
  let images = [];

  // Prefer the URL already normalized by Home.jsx.
  if (ad?.image_url) {
    images.push(ad.image_url);
  }

  // Fall back to the original Supabase images column.
  if (Array.isArray(ad?.images)) {
    images.push(...ad.images);
  } else if (typeof ad?.images === "string") {
    const raw = ad.images.trim();

    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          images.push(...parsed);
        }
      } catch {
        images.push(raw);
      }
    } else if (raw) {
      images.push(raw);
    }
  }

  // Accept only absolute HTTP(S) image URLs and remove duplicates.
  return [...new Set(images.filter((value) => {
    if (typeof value !== "string" || !value.trim()) return false;

    try {
      const url = new URL(value.trim());
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }).map((url) => url.trim()))];
}

function AdvertisementImage({
  ad,
  className = "",
  alt = "",
  placeholderText,
}) {
  const imageList = getImageList(ad);
  const [imageIndex, setImageIndex] = useState(0);

  // Reset when this component is reused for another ad or image list.
  const imageKey = imageList.join("|");

  useEffect(() => {
    setImageIndex(0);
  }, [ad?.id, imageKey]);

  const currentImage = imageList[imageIndex];

  if (!currentImage) {
    return (
      <div className="image-placeholder">
        <ImageOff size={28} />
        {placeholderText && <span>{placeholderText}</span>}
      </div>
    );
  }

  return (
    <img
      key={`${ad?.id ?? "ad"}-${currentImage}`}
      src={currentImage}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => {
        console.error(
          "[AdSphere] Failed to load advertisement image:",
          currentImage
        );

        setImageIndex((previousIndex) => previousIndex + 1);
      }}
    />
  );
}

export function FeaturedCard({ ad, index, onDetails }) {
  const { rating, count } = getRatingInfo(ad);

  return (
    <article className="featured-card">
      <div className="featured-image-wrap">
        <AdvertisementImage
          ad={ad}
          className="featured-image"
          alt={ad.name || "Featured business"}
          placeholderText={`Discover ${ad.name || "local businesses"}`}
        />

        <div className="image-shade" />

        {rating !== null && (
          <span className="featured-rating" title={`${rating} out of 5`}>
            <Star size={14} fill="currentColor" />
            {rating.toFixed(1)}
            {count > 0 && <small>({count})</small>}
          </span>
        )}

        <span className="featured-badge">
          {ad.badge || "FEATURED PARTNER"} ·{" "}
          {String(index + 1).padStart(2, "0")}
        </span>

        <div className="featured-copy">
          <p>{ad.description || "A local favorite worth discovering."}</p>
          <h3>{ad.name}</h3>

          <span>
            <MapPin size={16} />
            {ad.location || "Around you"}
          </span>
        </div>
      </div>

      <div className="featured-card-bottom">
        <div>
          <span className="eyebrow">
            {ad.category}
            {ad.subcategory ? ` · ${ad.subcategory}` : ""}
          </span>

          <h4>{ad.name}</h4>
          <p>{ad.description || "Discover something great nearby."}</p>

          {rating !== null && (
            <span className="card-rating">
              <Star size={15} fill="currentColor" />
              <strong>{rating.toFixed(1)}</strong>
              {count > 0 && (
                <span className="rating-count">
                  {count} {count === 1 ? "review" : "reviews"}
                </span>
              )}
            </span>
          )}
        </div>

        <button
          type="button"
          className="button button-gradient"
          onClick={() => onDetails(ad)}
        >
          View details <ArrowUpRight size={17} />
        </button>
      </div>
    </article>
  );
}

export function LocalFavoriteCard({ ad, index, onDetails }) {
  return (
    <article className="favorite-card">
      <div className="favorite-image-wrap">
        <AdvertisementImage
          ad={ad}
          alt={ad.name || "Local business"}
          placeholderText={ad.name}
        />

        <span className="number-badge">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>

      <div className="favorite-body">
        <span className="eyebrow">
          {ad.category} · LOCAL FAVORITE
        </span>

        <h3>{ad.name}</h3>

        <p>
          {ad.description || "A memorable place, thoughtfully close by."}
        </p>

        <div className="card-actions">
          <button
            type="button"
            className="button button-dark"
            onClick={() => onDetails(ad)}
          >
            View details <ArrowUpRight size={17} />
          </button>

          {ad.website_url && (
            <a
              className="button button-light"
              href={ad.website_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Visit website
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function CornerCard({ ad, index, onDetails }) {
  return (
    <article className="corner-card">
      <button
        type="button"
        className="corner-media"
        onClick={() => onDetails(ad)}
        aria-label={`View ${ad.name}`}
      >
        <AdvertisementImage
          ad={ad}
          alt={ad.name || "Nearby business"}
          placeholderText={null}
        />

        <span className="corner-number">
          {String(index + 1).padStart(2, "0")}
        </span>
      </button>

      <div className="corner-body">
        <span className="eyebrow">{ad.category}</span>
        <h3>{ad.name}</h3>

        <button
          type="button"
          className="text-link"
          onClick={() => onDetails(ad)}
        >
          View details <ArrowUpRight size={16} />
        </button>
      </div>
    </article>
  );
}
