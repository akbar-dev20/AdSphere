
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Sparkles,
  X,
  UploadCloud,
  CreditCard,
  ExternalLink,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  DEFAULT_DURATION_DAYS,
  getPlanPrices,
  PLAN_CONFIG,
  SUPPORTED_CITIES,
  submitPlanAdvertisement,
} from "../services/subscriptions";

const emptyForm = {
  companyName: "",
  headline: "",
  category: "Eat",
  imageFiles: [],
  location: "Noida",
  address: "",
  website: "",
  rating: "",
  reviews: "",
  paymentReference: "",
  paymentProof: null,
};

const categories = ["Eat", "Shop", "Play", "Stay", "Services"];

const money = (value) =>
  Number.isFinite(Number(value))
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }).format(Number(value))
    : "Price unavailable";

function Field({ label, required = false, hint, children }) {
  return (
    <label className="ad-form-field">
      <span>
        {label}
        {required && <b> *</b>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function AdvertisementForm({ tier, price, onClose, onSubmitted }) {
  const { user } = useAuth();
  const plan = PLAN_CONFIG[tier];

  const [form, setForm] = useState({ ...emptyForm });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [imagePreviews, setImagePreviews] = useState([]);

  useEffect(() => {
    const previews = (form.imageFiles ?? []).map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setImagePreviews(previews);
    return () => previews.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [form.imageFiles]);

  function handleImageSelection(event) {
    const selectedFiles = Array.from(event.target.files ?? []);
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    setError("");

    setForm((current) => {
      const combined = [...(current.imageFiles ?? []), ...selectedFiles];
      if (combined.length > 5) {
        setError("You can upload up to 5 images.");
        return current;
      }
      const invalid = combined.find((file) =>
        !allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024
      );
      if (invalid) {
        setError(`${invalid.name}: use JPG, PNG, or WEBP images up to 5 MB each.`);
        return current;
      }
      return { ...current, imageFiles: combined };
    });
    event.target.value = "";
  }

  function removeImage(index) {
    setForm((current) => ({
      ...current,
      imageFiles: (current.imageFiles ?? []).filter((_, i) => i !== index),
    }));
  }

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");

    try {
      if (!user?.id) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      if (
        !form.companyName.trim() ||
        !form.headline.trim() ||
        !form.location.trim() ||
        !form.address.trim() ||
        !form.paymentReference.trim()
      ) {
        throw new Error("Complete all required fields.");
      }

      if (plan.requiresImages && !form.imageFiles.length) {
        throw new Error("Upload at least one advertisement image.");
      }
      if (tier === "T3" && form.imageFiles.length) {
        throw new Error("T3 advertisements cannot contain images.");
      }

      if (
        tier === "T1" &&
        form.rating !== "" &&
        (Number(form.rating) < 0 || Number(form.rating) > 5)
      ) {
        throw new Error("Rating must be between 0 and 5.");
      }

      const result = await submitPlanAdvertisement({
        tier,
        form,
        userId: user.id,
      });

      setSuccess(
        `Advertisement submitted successfully. Subscription ID: ${
          result?.subscription_id ?? "created"
        }.`
      );

      onSubmitted?.();
    } catch (err) {
      setError(err.message || "Could not submit the advertisement.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="ad-form-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <section
        className="ad-form-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ad-form-title"
      >
        <header className="ad-form-header">
          <div>
            <span className="section-kicker">
              ADSPHERE · {tier} PLAN
            </span>
            <h2 id="ad-form-title">{plan.name}</h2>
            <p>
              Complete your business details and payment reference.
            </p>
          </div>

          <button
            className="ad-form-close"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close form"
          >
            <X />
          </button>
        </header>

        <div className="ad-form-price">
          <span>Plan price</span>
          <strong>{money(price)}</strong>
          <small>
            {DEFAULT_DURATION_DAYS}-day listing. Payment verification is
            manual until a payment gateway is integrated.
          </small>
        </div>

        <form className="ad-form-body" onSubmit={submit}>
          <div className="ad-form-section-title">
            <span>01</span>
            <div>
              <strong>Business details</strong>
              <small>
                Tell nearby customers about your business.
              </small>
            </div>
          </div>

          <div className="ad-form-grid">
            <Field label="Company name" required>
              <input
                value={form.companyName}
                onChange={(e) => update("companyName", e.target.value)}
                required
                maxLength={150}
                placeholder="e.g. Juniper Table"
              />
            </Field>

            <Field label="Category" required>
              <select
                value={form.category}
                onChange={(e) => update("category", e.target.value)}
                required
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </Field>

            <div className="ad-form-full">
              <Field
                label="Headline"
                required
                hint="A short description displayed on your advertisement card."
              >
                <input
                  value={form.headline}
                  onChange={(e) => update("headline", e.target.value)}
                  required
                  maxLength={240}
                  placeholder="Seasonal plates. Zero pretense."
                />
              </Field>
            </div>

            {plan.requiresImages && (
              <div className="ad-form-full">
                <Field
                  label="Advertisement images"
                  required
                  hint="Upload up to 5 JPG, PNG, or WEBP images. Maximum 5 MB per image."
                >
                  <div className="ad-image-uploader">
                    <label className="ad-image-picker">
                      <UploadCloud size={24} />
                      <strong>Choose advertisement images</strong>
                      <span>
                        {form.imageFiles.length
                          ? `${form.imageFiles.length} image(s) selected`
                          : "Click to browse your device"}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        onChange={handleImageSelection}
                        disabled={busy}
                      />
                    </label>
                    {imagePreviews.length > 0 && (
                      <div className="ad-image-preview-grid">
                        {imagePreviews.map(({ file, url }, index) => (
                          <div className="ad-image-preview" key={`${file.name}-${file.lastModified}-${index}`}>
                            <img src={url} alt={`Advertisement preview ${index + 1}`} />
                            <button type="button" onClick={() => removeImage(index)} disabled={busy} aria-label={`Remove ${file.name}`}>
                              <X size={16} />
                            </button>
                            <span>{file.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>
              </div>
            )}

            <div className="ad-form-full">
              <Field
                label="Location"
                required
                hint="Choose the city where your business is located."
              >
                <select
                  value={form.location}
                  onChange={(e) => update("location", e.target.value)}
                  required
                >
                  {SUPPORTED_CITIES.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="ad-form-full">
              <Field
                label={
                  tier === "T3"
                    ? "Address / Google Maps link"
                    : "Address"
                }
                required
              >
                <textarea
                  value={form.address}
                  onChange={(e) => update("address", e.target.value)}
                  required
                  rows={2}
                  placeholder={
                    tier === "T3"
                      ? "Full address or Google Maps URL"
                      : "Street, area, city, PIN code"
                  }
                />
              </Field>
            </div>

            {tier !== "T3" && (
              <div className="ad-form-full">
                <Field label="Website" hint="Optional. Include https://.">
                  <input
                    type="url"
                    value={form.website}
                    onChange={(e) => update("website", e.target.value)}
                    placeholder="https://yourbusiness.com"
                  />
                </Field>
              </div>
            )}

            {plan.includesReviews && (
              <>
                <Field label="Rating" hint="Optional rating from 0 to 5.">
                  <input
                    type="number"
                    min="0"
                    max="5"
                    step="0.1"
                    value={form.rating}
                    onChange={(e) => update("rating", e.target.value)}
                    placeholder="4.9"
                  />
                </Field>

                <Field
                  label="Reviews"
                  hint="Optional; enter one review per line."
                >
                  <textarea
                    rows={3}
                    value={form.reviews}
                    onChange={(e) => update("reviews", e.target.value)}
                    placeholder={
                      "Warm, genuinely local, and worth the stop.\nThe team made everything incredibly easy."
                    }
                  />
                </Field>
              </>
            )}
          </div>

          <div className="ad-form-section-title ad-form-section-payment">
            <span>02</span>
            <div>
              <strong>Payment details</strong>
              <small>
                The payment reference is recorded for manual reconciliation.
              </small>
            </div>
          </div>

          <div className="ad-form-grid">
            <div className="ad-form-full">
              <Field
                label="Payment reference"
                required
                hint="Transaction ID, UTR, or payment reference number."
              >
                <input
                  value={form.paymentReference}
                  onChange={(e) =>
                    update("paymentReference", e.target.value)
                  }
                  required
                  maxLength={200}
                  placeholder="Enter transaction reference"
                />
              </Field>
            </div>

            <div className="ad-form-full">
              <Field
                label="Payment proof (optional)"
                hint="JPG, PNG, WEBP, or PDF. Maximum size 8 MB."
              >
                <span className="proof-upload">
                  <UploadCloud size={20} />
                  <span>
                    {form.paymentProof?.name ||
                      "Choose payment receipt or screenshot"}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) =>
                      update("paymentProof", e.target.files?.[0] || null)
                    }
                  />
                </span>
              </Field>
            </div>
          </div>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          {success && (
            <div className="form-success" role="status">
              {success}
            </div>
          )}

          <div className="ad-form-actions">
            <button
              type="button"
              className="button button-light"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>

            <button
              className="button button-gradient"
              type="submit"
              disabled={busy || Boolean(success)}
            >
              {busy ? "Submitting…" : success ? "Submitted" : "Submit advertisement"}
            </button>
          </div>

          <p className="ad-form-disclaimer">
            <CreditCard size={15} />
            This form does not collect card details or verify payment automatically.
          </p>
        </form>
      </section>
    </div>
  );
}

export default function Plans() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [prices, setPrices] = useState({});
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceError, setPriceError] = useState("");
  const [selectedTier, setSelectedTier] = useState(null);
  const [notice, setNotice] = useState("");

  const tiers = useMemo(
    () =>
      ["T1", "T2", "T3"].map((tier) => ({
        ...PLAN_CONFIG[tier],
        price: prices[tier],
      })),
    [prices]
  );

  useEffect(() => {
    let alive = true;

    getPlanPrices()
      .then((data) => {
        if (alive) {
          setPrices(data);
          setPriceError("");
        }
      })
      .catch((error) => {
        if (alive) {
          setPriceError(error.message || "Could not load plan prices.");
        }
      })
      .finally(() => {
        if (alive) setPriceLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const tier = new URLSearchParams(location.search)
      .get("plan")
      ?.toUpperCase();

    if (!tier || !PLAN_CONFIG[tier] || authLoading) return;

    if (!user) {
      navigate("/login", {
        replace: true,
        state: {
          from: `${location.pathname}${location.search}`,
        },
      });
      return;
    }

    setSelectedTier(tier);
  }, [
    location.pathname,
    location.search,
    user,
    authLoading,
    navigate,
  ]);

  function choosePlan(tier) {
    setNotice("");

    if (authLoading) return;

    if (!user) {
      navigate("/login", {
        state: { from: `/plans?plan=${tier}` },
      });
      return;
    }

    setSelectedTier(tier);
  }

  return (
    <main className="inner-page">
      <div className="container">
        <div className="page-intro">
          <span className="section-kicker">GROW WITH ADSPHERE</span>
          <h1>Choose your visibility.</h1>
          <p>
            Choose a placement and complete the matching business form.
            Prices are loaded from your existing Supabase table.
          </p>
        </div>

        {priceError && (
          <div className="form-error" role="alert">
            Unable to load current plan prices: {priceError}
          </div>
        )}

        <div className="plans-grid">
          {tiers.map((plan, index) => (
            <article
              className={`plan-card ${index === 0 ? "plan-featured" : ""}`}
              key={plan.tier}
            >
              {index === 0 && (
                <span className="plan-ribbon">FEATURED</span>
              )}

              <span className="plan-icon">
                <Sparkles />
              </span>

              <span className="plan-tier-label">{plan.tier}</span>
              <h2>{plan.name}</h2>
              <p>{plan.description}</p>

              <div className="plan-price">
                {priceLoading
                  ? "Loading…"
                  : plan.price === undefined
                    ? "Price unavailable"
                    : money(plan.price)}
              </div>

              <span className="muted">
                {DEFAULT_DURATION_DAYS}-day placement
              </span>

              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <Check size={17} />
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                className={`button ${
                  index === 0 ? "button-gradient" : "button-dark"
                }`}
                type="button"
                disabled={
                  priceLoading ||
                  plan.price === undefined ||
                  authLoading
                }
                onClick={() => choosePlan(plan.tier)}
              >
                Choose {plan.tier}
                <ExternalLink size={15} />
              </button>
            </article>
          ))}
        </div>

        <p className="notice-text">
          Payment gateway integration will be added later. Payment references
          are recorded but are not automatically verified.
        </p>

        {notice && <p className="form-success">{notice}</p>}
      </div>

      {selectedTier && (
        <AdvertisementForm
          key={selectedTier}
          tier={selectedTier}
          price={prices[selectedTier]}
          onClose={() => {
            setSelectedTier(null);
            navigate("/plans", { replace: true });
          }}
          onSubmitted={() => setNotice("Your advertisement has been submitted.")}
        />
      )}
    </main>
  );
}
