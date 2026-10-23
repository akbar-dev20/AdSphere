-- Migration: advrec_location_city_check
-- Created:   2026-10-23
--
-- Purpose:
--   1. Convert public."advRec".location from text[] to text.
--      The first array entry becomes the stored city.
--   2. Normalise legacy free-form location values onto the supported city
--      list (Noida, Mumbai, Delhi, Bangalore, Pune).
--   3. Enforce the supported city list with a CHECK constraint
--      (advRec_location_check).
--   4. Recreate submit_ad_direct and submit_advertisement so submitted
--      locations are validated against the supported cities and a single
--      text value is stored.
--
-- Every step is guarded, so this migration is safe to re-run.

-- ---------------------------------------------------------------------------
-- Helper: pick the first supported city from the submitted locations.
-- Matching is case-insensitive; the canonical city name is returned.
-- Returns NULL when none of the candidates is a supported city.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."ad_supported_location"("p_candidates" "text"[]) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_candidate text;
  v_city text;
BEGIN
  IF p_candidates IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_candidate IN SELECT unnest(p_candidates) LOOP
    v_city := CASE lower(btrim(coalesce(v_candidate, '')))
      WHEN 'noida' THEN 'Noida'
      WHEN 'mumbai' THEN 'Mumbai'
      WHEN 'delhi' THEN 'Delhi'
      WHEN 'new delhi' THEN 'Delhi'
      WHEN 'bangalore' THEN 'Bangalore'
      WHEN 'bengaluru' THEN 'Bangalore'
      WHEN 'pune' THEN 'Pune'
      ELSE NULL
    END;

    IF v_city IS NOT NULL THEN
      RETURN v_city;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Column type conversion: text[] -> text
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'advRec'
      AND column_name  = 'location'
      AND udt_name     = '_text'
  ) THEN
    -- Legacy rows with an empty array have no city; default them to
    -- 'Noida' (the most common legacy value) so NOT NULL is preserved.
    UPDATE public."advRec"
    SET location = ARRAY['Noida']::text[]
    WHERE cardinality(location) = 0;

    -- The array default '{}'::text[] cannot be cast to text: drop it first.
    ALTER TABLE public."advRec" ALTER COLUMN location DROP DEFAULT;

    -- Keep the first submitted location as the stored city.
    ALTER TABLE public."advRec"
      ALTER COLUMN location TYPE text USING btrim(location[1]);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Normalise legacy free-form values onto the supported city list
-- ---------------------------------------------------------------------------
-- e.g. 'Noida sector 18' -> 'Noida', 'Chanakyapuri, New Delhi' -> 'Delhi'
UPDATE public."advRec"
SET location = CASE
  WHEN location ILIKE '%noida%' THEN 'Noida'
  WHEN location ILIKE '%mumbai%' OR location ILIKE '%bombay%' THEN 'Mumbai'
  WHEN location ILIKE '%bengaluru%' OR location ILIKE '%bangalore%' THEN 'Bangalore'
  WHEN location ILIKE '%delhi%' THEN 'Delhi'
  WHEN location ILIKE '%pune%' THEN 'Pune'
  ELSE location
END
WHERE location <> ALL (ARRAY['Noida','Mumbai','Delhi','Bangalore','Pune']::text[]);

-- National Capital Region localities (Gurgaon, Gurugram, Faridabad,
-- Ghaziabad) map to their nearest supported city: Delhi.
-- NOTE: "Gurugram" does NOT contain the substring "gurga" (g-u-r-u-g...),
-- so both city spellings are matched explicitly.
UPDATE public."advRec"
SET location = 'Delhi'
WHERE location <> ALL (ARRAY['Noida','Mumbai','Delhi','Bangalore','Pune']::text[])
  AND (
    location ILIKE '%gurgaon%'
    OR location ILIKE '%gurugram%'
    OR location ILIKE '%faridabad%'
    OR location ILIKE '%ghaziabad%'
  );

-- ---------------------------------------------------------------------------
-- 3. CHECK constraint: only supported cities are accepted
-- ---------------------------------------------------------------------------
ALTER TABLE public."advRec" ALTER COLUMN location SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public."advRec"'::regclass
      -- lower() guards against identifier case-folding: an unquoted
      -- constraint name would have been stored as 'advrec_location_check'.
      AND lower(conname) = 'advrec_location_check'
  ) THEN
    ALTER TABLE public."advRec"
      ADD CONSTRAINT "advRec_location_check"
      CHECK (
        location = ANY (ARRAY[
          'Noida'::text,
          'Mumbai'::text,
          'Delhi'::text,
          'Bangalore'::text,
          'Pune'::text
        ])
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. submit_ad_direct: validate the submitted location against the
--    supported cities and store a single text value.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."submit_ad_direct"("p_category" "text", "p_tier" "text", "p_duration_days" integer, "p_ad_details" "jsonb", "p_payment_reference" "text", "p_payment_proof_url" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_company_name text;
  v_label text;
  v_images text[] := ARRAY[]::text[];
  v_locations text[] := ARRAY[]::text[];
  v_location text;
  v_reviews text[] := ARRAY[]::text[];
  v_rating numeric;
  v_website text;
  v_address text;
  v_amount numeric;
  v_ad_id uuid;
  v_item jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Please sign in first.';
  END IF;

  IF p_category IS NULL OR p_category NOT IN ('Eat', 'Shopping', 'Play', 'Stay', 'Services') THEN
    RAISE EXCEPTION 'INVALID_CATEGORY';
  END IF;
  IF p_tier IS NULL OR p_tier NOT IN ('T1', 'T2', 'T3') THEN
    RAISE EXCEPTION 'INVALID_TIER';
  END IF;
  IF p_duration_days IS NULL OR p_duration_days < 1 OR p_duration_days > 3650 THEN
    RAISE EXCEPTION 'INVALID_DURATION';
  END IF;
  IF p_ad_details IS NULL OR jsonb_typeof(p_ad_details) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_AD_DETAILS';
  END IF;
  IF p_payment_reference IS NULL OR char_length(trim(p_payment_reference)) < 3 THEN
    RAISE EXCEPTION 'PAYMENT_REFERENCE_REQUIRED';
  END IF;
  IF p_payment_proof_url IS NOT NULL AND trim(p_payment_proof_url) <> ''
     AND p_payment_proof_url !~* '^https?://' THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_PROOF_URL';
  END IF;

  SELECT trim(coalesce(p_ad_details->>'company_name', '')),
         trim(coalesce(p_ad_details->>'label', '')),
         nullif(trim(coalesce(p_ad_details->>'website', '')), ''),
         nullif(trim(coalesce(p_ad_details->>'address', '')), '')
    INTO v_company_name, v_label, v_website, v_address;

  IF v_company_name = '' OR v_label = '' THEN
    RAISE EXCEPTION 'COMPANY_NAME_AND_HEADLINE_REQUIRED';
  END IF;
  IF v_address IS NULL THEN
    RAISE EXCEPTION 'BUSINESS_ADDRESS_REQUIRED';
  END IF;

  -- The submitted location must be a single supported city:
  -- Noida, Mumbai, Delhi, Bangalore, Pune.
  -- Preferred payload key: 'location' (single text, matching the column
  -- type). 'locations' (array) is still accepted for compatibility.
  v_location := NULL;

  IF jsonb_typeof(p_ad_details->'location') = 'string' THEN
    v_location := public.ad_supported_location(
      ARRAY[p_ad_details->>'location']
    );
  ELSIF jsonb_typeof(coalesce(p_ad_details->'locations', '[]'::jsonb)) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_ad_details->'locations', '[]'::jsonb)) LOOP
      IF jsonb_typeof(v_item) = 'string' AND trim(v_item #>> '{}') <> '' THEN
        v_locations := array_append(v_locations, trim(v_item #>> '{}'));
      END IF;
    END LOOP;
    v_location := public.ad_supported_location(v_locations);
  END IF;

  IF v_location IS NULL THEN
    RAISE EXCEPTION 'INVALID_SERVICE_LOCATION: Supported cities are Noida, Mumbai, Delhi, Bangalore and Pune.';
  END IF;

  IF p_tier IN ('T1', 'T2') THEN
    IF jsonb_typeof(p_ad_details->'images') = 'array' THEN
      FOR v_item IN SELECT value FROM jsonb_array_elements(p_ad_details->'images') LOOP
        IF jsonb_typeof(v_item) = 'string' AND trim(v_item #>> '{}') <> '' THEN
          IF trim(v_item #>> '{}') !~* '^https?://' THEN
            RAISE EXCEPTION 'INVALID_IMAGE_URL';
          END IF;
          v_images := array_append(v_images, trim(v_item #>> '{}'));
        END IF;
      END LOOP;
    END IF;
    IF cardinality(v_images) = 0 THEN
      RAISE EXCEPTION 'IMAGE_URL_REQUIRED_FOR_T1_T2';
    END IF;
    IF v_website IS NULL OR v_website !~* '^https?://' THEN
      RAISE EXCEPTION 'WEBSITE_REQUIRED_FOR_T1_T2';
    END IF;
  END IF;

  IF p_tier = 'T1' THEN
    BEGIN
      v_rating := (p_ad_details->>'rating')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'VALID_RATING_REQUIRED_FOR_T1';
    END;
    IF v_rating IS NULL OR v_rating < 0 OR v_rating > 5 THEN
      RAISE EXCEPTION 'VALID_RATING_REQUIRED_FOR_T1';
    END IF;
    IF jsonb_typeof(p_ad_details->'reviews') = 'array' THEN
      FOR v_item IN SELECT value FROM jsonb_array_elements(p_ad_details->'reviews') LOOP
        IF jsonb_typeof(v_item) = 'string' AND trim(v_item #>> '{}') <> '' THEN
          v_reviews := array_append(v_reviews, trim(v_item #>> '{}'));
        END IF;
      END LOOP;
    END IF;
    IF cardinality(v_reviews) = 0 THEN
      RAISE EXCEPTION 'REVIEW_REQUIRED_FOR_T1';
    END IF;
  END IF;

  SELECT price INTO v_amount FROM public.ad_plan_prices WHERE tier = p_tier;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'PLAN_PRICE_NOT_CONFIGURED';
  END IF;

  -- The company row is expected to be created during company registration.
  IF NOT EXISTS (SELECT 1 FROM public.company WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'COMPANY_PROFILE_REQUIRED: Complete company registration first.';
  END IF;

  INSERT INTO public."advRec" (
    company_id, owner_id, name, images, location, review, rating, category,
    amount, website, label, address, subscription_expiry, payment_status,
    tier
  ) VALUES (
    v_user_id,
    v_user_id,
    v_company_name,
    v_images,
    v_location,
    v_reviews,
    v_rating,
    p_category,
    v_amount,
    v_website,
    v_label,
    v_address,
    now() + make_interval(days => p_duration_days),
    'not_paid',
    p_tier
  ) RETURNING id INTO v_ad_id;

  INSERT INTO public.ad_payment_records (
    ad_id, company_id, payment_reference, payment_proof_url
  ) VALUES (
    v_ad_id, v_user_id, trim(p_payment_reference),
    nullif(trim(coalesce(p_payment_proof_url, '')), '')
  );

  RETURN v_ad_id;
END;
$$;


ALTER FUNCTION "public"."submit_ad_direct"("p_category" "text", "p_tier" "text", "p_duration_days" integer, "p_ad_details" "jsonb", "p_payment_reference" "text", "p_payment_proof_url" "text") OWNER TO "postgres";

-- ---------------------------------------------------------------------------
-- 5. submit_advertisement: validate the submitted location against the
--    supported cities and store a single text value.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."submit_advertisement"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tier text;
  v_category text;
  v_price numeric;
  v_duration integer := 30;
  v_company_name text;
  v_headline text;
  v_images text[] := array[]::text[];
  v_locations text[] := array[]::text[];
  v_location text;
  v_reviews text[] := array[]::text[];
  v_address text;
  v_website text;
  v_rating numeric;
  v_payment_reference text;
  v_payment_proof_path text;
  v_subscription_id uuid;
  v_ad_id uuid;
  v_now timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to submit an advertisement.'
      USING errcode = '42501';
  END IF;

  v_tier := upper(trim(coalesce(p_payload->>'tier', '')));

  IF v_tier NOT IN ('T1', 'T2', 'T3') THEN
    RAISE EXCEPTION 'Invalid advertisement tier.'
      USING errcode = '22023';
  END IF;

  v_company_name := trim(coalesce(p_payload->>'company_name', ''));
  v_headline := trim(coalesce(p_payload->>'headline', ''));
  v_category := trim(coalesce(p_payload->>'category', ''));
  v_address := trim(coalesce(p_payload->>'address', ''));
  v_website := nullif(trim(coalesce(p_payload->>'website', '')), '');
  v_payment_reference := trim(coalesce(p_payload->>'payment_reference', ''));
  v_payment_proof_path := nullif(
    trim(coalesce(p_payload->>'payment_proof_path', '')),
    ''
  );

  IF v_company_name = '' OR v_headline = '' OR v_address = ''
     OR v_payment_reference = '' THEN
    RAISE EXCEPTION
      'Company name, headline, address and payment reference are required.'
      USING errcode = '22023';
  END IF;


v_category := CASE
  WHEN lower(trim(v_category)) IN ('shop', 'shopping')
    THEN 'Shopping'
  ELSE trim(v_category)
END;

IF v_category NOT IN ('Eat', 'Shopping', 'Play', 'Stay', 'Services') THEN
  RAISE EXCEPTION 'Choose a valid business category.'
    USING errcode = '22023';
END IF;


  -- A single supported city is required; it is resolved and validated
  -- below against Noida, Mumbai, Delhi, Bangalore and Pune.

  SELECT price
  INTO v_price
  FROM public.ad_plan_prices
  WHERE upper(tier) = v_tier;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'The selected plan price is not configured.'
      USING errcode = '22023';
  END IF;

  IF jsonb_typeof(coalesce(p_payload->'image_urls', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Image URLs must be provided as an array.'
      USING errcode = '22023';
  END IF;

  SELECT coalesce(array_agg(trim(value)), array[]::text[])
  INTO v_images
  FROM jsonb_array_elements_text(
    coalesce(p_payload->'image_urls', '[]'::jsonb)
  ) AS x(value)
  WHERE trim(value) <> '';

  IF v_tier IN ('T1', 'T2')
     AND coalesce(array_length(v_images, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one image URL is required for T1 and T2.'
      USING errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_images) AS u
    WHERE u !~* '^https?://'
  ) THEN
    RAISE EXCEPTION 'Image URLs must use HTTP or HTTPS.'
      USING errcode = '22023';
  END IF;

  -- The submitted location must be a single supported city:
  -- Noida, Mumbai, Delhi, Bangalore, Pune.
  -- Preferred payload key: 'location' (single text, matching the column
  -- type). 'locations' (array) is still accepted for compatibility.
  v_location := NULL;

  IF jsonb_typeof(p_payload->'location') = 'string' THEN
    v_location := public.ad_supported_location(
      ARRAY[p_payload->>'location']
    );
  ELSIF jsonb_typeof(coalesce(p_payload->'locations', '[]'::jsonb)) = 'array' THEN
    SELECT coalesce(array_agg(value), array[]::text[])
    INTO v_locations
    FROM jsonb_array_elements_text(
      coalesce(p_payload->'locations', '[]'::jsonb)
    ) AS x(value);
    v_location := public.ad_supported_location(v_locations);
  END IF;

  IF v_location IS NULL THEN
    RAISE EXCEPTION 'Choose one of the supported cities: Noida, Mumbai, Delhi, Bangalore or Pune.'
      USING errcode = '22023';
  END IF;

  IF v_tier = 'T1'
     AND jsonb_typeof(coalesce(p_payload->'reviews', '[]'::jsonb)) = 'array' THEN
    SELECT coalesce(array_agg(value), array[]::text[])
    INTO v_reviews
    FROM jsonb_array_elements_text(
      coalesce(p_payload->'reviews', '[]'::jsonb)
    ) AS x(value);
  END IF;

  IF v_tier = 'T1' AND nullif(p_payload->>'rating', '') IS NOT NULL THEN
    v_rating := (p_payload->>'rating')::numeric;

    IF v_rating < 0 OR v_rating > 5 THEN
      RAISE EXCEPTION 'Rating must be between 0 and 5.'
        USING errcode = '22023';
    END IF;
  END IF;

  -- T3 advertisements cannot contain images, reviews, or ratings.
  IF v_tier = 'T3' THEN
    v_images := array[]::text[];
    v_reviews := array[]::text[];
    v_rating := NULL;
  END IF;

  -- Create or update the company profile.
  INSERT INTO public.company (id, name, email)
  VALUES (
    v_user_id,
    v_company_name,
    coalesce(auth.jwt()->>'email', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name,
    email = CASE
      WHEN excluded.email <> '' THEN excluded.email
      ELSE company.email
    END;

  -- Create the subscription for manual payment review.
  INSERT INTO public.ad_subscriptions (
    company_id,
    category,
    tier,
    amount,
    duration_days,
    status,
    ad_details,
    payment_reference,
    payment_proof_url,
    reservation_until,
    created_at,
    submitted_at,
    starts_at,
    expires_at
  )
  VALUES (
    v_user_id,
    v_category,
    v_tier,
    v_price,
    v_duration,
    'pending_review',
    jsonb_build_object(
      'company_name', v_company_name,
      'headline', v_headline,
      'images', to_jsonb(v_images),
      'location', v_location,
      'address', v_address,
      'website', v_website,
      'rating', v_rating,
      'reviews', to_jsonb(v_reviews),
      'category', v_category
    ),
    v_payment_reference,
    v_payment_proof_path,
    v_now + make_interval(days => v_duration),
    v_now,
    v_now,
    v_now,
    v_now + make_interval(days => v_duration)
  )
  RETURNING id INTO v_subscription_id;

  -- Create the advertisement record.
  INSERT INTO public."advRec" (
    company_id,
    name,
    images,
    location,
    review,
    rating,
    category,
    amount,
    website,
    label,
    created_at,
    address,
    subscription_expiry,
    payment_status,
    owner_id,
    tier,
    subscription_id
  )
  VALUES (
    v_user_id,
    v_company_name,
    v_images,
    v_location,
    v_reviews,
    v_rating,
    v_category,
    v_price,
    v_website,
    v_headline,
    v_now,
    v_address,
    v_now + make_interval(days => v_duration),
    'not_paid',
    v_user_id,
    v_tier,
    v_subscription_id
  )
  RETURNING id INTO v_ad_id;

  RETURN jsonb_build_object(
    'advertisement_id', v_ad_id,
    'subscription_id', v_subscription_id,
    'tier', v_tier,
    'amount', v_price,
    'duration_days', v_duration,
    'payment_status', 'not_paid'
  );
END;
$$;


ALTER FUNCTION "public"."submit_advertisement"("p_payload" "jsonb") OWNER TO "postgres";
