
import { supabase } from "../lib/supabase";

export const DEFAULT_DURATION_DAYS = 30;

const MAX_AD_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_AD_IMAGES = 5;
const ALLOWED_AD_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function uploadAdvertisementImages(files, userId) {
  if (!files?.length) return [];
  if (!supabase || !userId) throw new Error("Please sign in before uploading images.");
  if (files.length > MAX_AD_IMAGES) throw new Error(`You can upload up to ${MAX_AD_IMAGES} images.`);

  const extensionByType = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const uploadedUrls = [];

  for (const file of files) {
    if (!ALLOWED_AD_IMAGE_TYPES.includes(file.type)) {
      throw new Error(`${file.name}: use JPG, PNG, or WEBP images.`);
    }
    if (file.size > MAX_AD_IMAGE_SIZE) {
      throw new Error(`${file.name}: maximum image size is 5 MB.`);
    }
    const path = `${userId}/${crypto.randomUUID()}.${extensionByType[file.type]}`;
    const { error: uploadError } = await supabase.storage
      .from("ad-images")
      .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
    if (uploadError) throw new Error(`Could not upload ${file.name}: ${uploadError.message}`);
    const { data } = supabase.storage.from("ad-images").getPublicUrl(path);
    if (!data?.publicUrl) throw new Error(`Could not create a URL for ${file.name}.`);
    uploadedUrls.push(data.publicUrl);
  }
  return uploadedUrls;
}

export const PLAN_CONFIG = {
  T1: {
    tier: "T1",
    name: "Featured Partner",
    description: "Premium featured placement with images, rating and reviews.",
    features: ["Featured placement", "Image gallery", "Rating and reviews"],
    requiresImages: true,
    includesReviews: true,
  },
  T2: {
    tier: "T2",
    name: "Local Favorites",
    description: "Highlight your business in the local favorites section.",
    features: ["Local favorites placement", "Image gallery", "Website link"],
    requiresImages: true,
    includesReviews: false,
  },
  T3: {
    tier: "T3",
    name: "Around the Corner",
    description: "A simple listing for people exploring nearby places.",
    features: ["Nearby listing", "Location details", "No images required"],
    requiresImages: false,
    includesReviews: false,
  },
};

export async function getPlanPrices() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const { data, error } = await supabase
    .from("ad_plan_prices")
    .select("tier, price");

  if (error) throw error;

  const prices = {};

  for (const row of data ?? []) {
    const tier = String(row.tier ?? "").trim().toUpperCase();

    if (PLAN_CONFIG[tier]) {
      prices[tier] = Number(row.price);
    }
  }

  return prices;
}

export async function uploadPaymentProof(file, userId) {
  if (!file) return null;

  if (!supabase || !userId) {
    throw new Error("Please sign in again before uploading payment proof.");
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error("Use a JPG, PNG, WEBP, or PDF payment proof.");
  }

  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Payment proof must be 8 MB or smaller.");
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "bin";
  const fileId = crypto.randomUUID();
  const path = `${userId}/${fileId}.${extension}`;

  const { error } = await supabase.storage
    .from("payment-proofs")
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) throw error;

  // The bucket is private. Store the object path, not a public URL.
  return path;
}

export async function submitPlanAdvertisement({ tier, form, userId }) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  if (!userId) {
    throw new Error("Please sign in before submitting an advertisement.");
  }

  if (!PLAN_CONFIG[tier]) {
    throw new Error("Invalid plan selected.");
  }

  const splitLines = (value) =>
    String(value ?? "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);

const locations = splitLines(form.locations);

const imageFiles = tier === "T3"
  ? []
  : Array.from(form.imageFiles ?? []);

if (
  PLAN_CONFIG[tier].requiresImages &&
  imageFiles.length === 0
) {
  throw new Error("Upload at least one advertisement image.");
}

if (tier === "T3" && imageFiles.length > 0) {
  throw new Error("T3 advertisements cannot contain images.");
}

const imageUrls = tier === "T3"
  ? []
  : await uploadAdvertisementImages(imageFiles, userId);

  if (!form.companyName.trim()) {
    throw new Error("Company name is required.");
  }

  if (!form.headline.trim()) {
    throw new Error("Headline is required.");
  }

  if (!locations.length) {
    throw new Error("Enter at least one location.");
  }

  if (!form.address.trim()) {
    throw new Error("Address is required.");
  }

  if (!form.paymentReference.trim()) {
    throw new Error("Payment reference is required.");
  }

  

  let website = form.website.trim() || null;

  if (website) {
    let parsed;

    try {
      parsed = new URL(website);
    } catch {
      throw new Error("Enter a valid website URL including https://.");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Website must use HTTP or HTTPS.");
    }
  }

  let paymentProofPath = null;

  if (form.paymentProof) {
    paymentProofPath = await uploadPaymentProof(
      form.paymentProof,
      userId
    );
  }

  const payload = {
    tier,
    company_name: form.companyName.trim(),
    headline: form.headline.trim(),
    category: form.category,
    image_urls: tier === "T3" ? [] : imageUrls,
    locations,
    address: form.address.trim(),
    website,
    rating:
      tier === "T1" && form.rating !== ""
        ? Number(form.rating)
        : null,
    reviews: tier === "T1" ? splitLines(form.reviews) : [],
    payment_reference: form.paymentReference.trim(),
    payment_proof_path: paymentProofPath,
  };

  console.log("Submitting advertisement:", {
  tier,
  category: form.category,
  userId,
});

  const { data, error } = await supabase.rpc(
    "submit_advertisement",
    { p_payload: payload }
  );

  if (error) throw error;

  return data;
}
