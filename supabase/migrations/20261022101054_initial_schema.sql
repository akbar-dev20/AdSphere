


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."handle_new_company"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
    INSERT INTO public.company (id, name, email)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data ->> 'company_name',
        NEW.email
    );

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_company"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_advrec_amount"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF (SELECT auth.role()) = 'authenticated' THEN
        IF TG_OP = 'INSERT' AND NEW.amount <> 0 THEN
            RAISE EXCEPTION
                'Advertisement amount must be set by the payment system';
        END IF;

        IF TG_OP = 'UPDATE'
           AND NEW.amount IS DISTINCT FROM OLD.amount THEN
            RAISE EXCEPTION
                'Advertisement amount cannot be changed by the company';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."protect_advrec_amount"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_ad_slot"("p_category" "text", "p_tier" "text", "p_amount" numeric, "p_duration_days" integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_company_id uuid := auth.uid();
  v_capacity integer;
  v_occupied integer;
  v_subscription_id uuid;
begin
  if v_company_id is null then
    raise exception 'Please sign in before selecting an advertisement plan.';
  end if;

  if p_category not in ('Eat', 'Shopping', 'Play', 'Stay', 'Services') then
    raise exception 'Invalid service category.';
  end if;

  if p_tier not in ('T1', 'T2', 'T3') then
    raise exception 'Invalid advertisement tier.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'The plan price has not been configured.';
  end if;

  if p_duration_days is null
     or p_duration_days < 1
     or p_duration_days > 3650 then
    raise exception 'Subscription duration must be between 1 and 3650 days.';
  end if;

  v_capacity := case p_tier
    when 'T1' then 2
    when 'T2' then 4
    else 8
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_category),
    pg_catalog.hashtext(p_tier)
  );

  -- Expired reservations no longer consume capacity.
  update public.ad_subscriptions
  set status = 'expired'
  where category = p_category
    and tier = p_tier
    and status = 'active'
    and expires_at <= now();

  select count(*)::integer
  into v_occupied
  from public.ad_subscriptions s
  where s.category = p_category
    and s.tier = p_tier
    and (
      (s.status = 'active' and s.expires_at > now())
      or (
        s.status in ('pending_payment', 'pending_review')
        and s.reservation_until > now()
      )
    );

  if v_occupied >= v_capacity then
    raise exception 'SLOT_UNAVAILABLE: No slots remain for % / %.',
      p_category, p_tier;
  end if;

  insert into public.ad_subscriptions (
    company_id,
    category,
    tier,
    amount,
    duration_days,
    status,
    reservation_until
  )
  values (
    v_company_id,
    p_category,
    p_tier,
    p_amount,
    p_duration_days,
    'pending_payment',
    now() + interval '30 minutes'
  )
  returning id into v_subscription_id;

  return v_subscription_id;
end;
$$;


ALTER FUNCTION "public"."reserve_ad_slot"("p_category" "text", "p_tier" "text", "p_amount" numeric, "p_duration_days" integer) OWNER TO "postgres";


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


ALTER FUNCTION "public"."ad_supported_location"("p_candidates" "text"[]) OWNER TO "postgres";


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

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ad_payment_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ad_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "payment_reference" "text" NOT NULL,
    "payment_proof_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ad_payment_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ad_plan_prices" (
    "tier" "text" NOT NULL,
    "price" numeric(12,2) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ad_plan_prices_price_check" CHECK (("price" > (0)::numeric)),
    CONSTRAINT "ad_plan_prices_tier_check" CHECK (("tier" = ANY (ARRAY['T1'::"text", 'T2'::"text", 'T3'::"text"])))
);


ALTER TABLE "public"."ad_plan_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ad_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "tier" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "duration_days" integer NOT NULL,
    "status" "text" DEFAULT 'pending_payment'::"text" NOT NULL,
    "ad_details" "jsonb",
    "payment_reference" "text",
    "payment_proof_url" "text",
    "admin_notes" "text",
    "reservation_until" timestamp with time zone DEFAULT ("now"() + '00:30:00'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "submitted_at" timestamp with time zone,
    "starts_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    CONSTRAINT "ad_subscriptions_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "ad_subscriptions_category_check" CHECK (("category" = ANY (ARRAY['Eat'::"text", 'Shop'::"text", 'Shopping'::"text", 'Play'::"text", 'Stay'::"text", 'Services'::"text"]))),
    CONSTRAINT "ad_subscriptions_duration_days_check" CHECK ((("duration_days" >= 1) AND ("duration_days" <= 3650))),
    CONSTRAINT "ad_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['pending_payment'::"text", 'pending_review'::"text", 'active'::"text", 'rejected'::"text", 'cancelled'::"text", 'expired'::"text"]))),
    CONSTRAINT "ad_subscriptions_tier_check" CHECK (("tier" = ANY (ARRAY['T1'::"text", 'T2'::"text", 'T3'::"text"])))
);


ALTER TABLE "public"."ad_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."advRec" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "images" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "location" "text" NOT NULL,
    "review" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "rating" numeric(2,1),
    "category" "text" NOT NULL,
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "website" "text",
    "label" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "address" "text",
    "subscription_expiry" timestamp with time zone,
    "payment_status" "text",
    "owner_id" "uuid",
    "tier" "text",
    "subscription_id" "uuid",
    CONSTRAINT "advRec_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "advRec_category_check" CHECK (("category" = ANY (ARRAY['Eat'::"text", 'Shop'::"text", 'Shopping'::"text", 'Play'::"text", 'Stay'::"text", 'Services'::"text"]))),
    CONSTRAINT "advRec_payment_status_check" CHECK ((("payment_status" IS NULL) OR ("payment_status" = ANY (ARRAY['paid'::"text", 'not_paid'::"text"])))),
    CONSTRAINT "advRec_rating_check" CHECK ((("rating" IS NULL) OR (("rating" >= (0)::numeric) AND ("rating" <= (5)::numeric)))),
    CONSTRAINT "advRec_location_check" CHECK (("location" = ANY (ARRAY['Noida'::"text", 'Mumbai'::"text", 'Delhi'::"text", 'Bangalore'::"text", 'Pune'::"text"])))
);


ALTER TABLE "public"."advRec" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company" (
    "id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "company_name_check" CHECK (("char_length"(TRIM(BOTH FROM "name")) > 0))
);


ALTER TABLE "public"."company" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ad_payment_records"
    ADD CONSTRAINT "ad_payment_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ad_plan_prices"
    ADD CONSTRAINT "ad_plan_prices_pkey" PRIMARY KEY ("tier");



ALTER TABLE ONLY "public"."ad_subscriptions"
    ADD CONSTRAINT "ad_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."advRec"
    ADD CONSTRAINT "advRec_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company"
    ADD CONSTRAINT "company_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."company"
    ADD CONSTRAINT "company_pkey" PRIMARY KEY ("id");



CREATE INDEX "ad_subscriptions_capacity_idx" ON "public"."ad_subscriptions" USING "btree" ("category", "tier", "status", "expires_at");



CREATE INDEX "ad_subscriptions_company_idx" ON "public"."ad_subscriptions" USING "btree" ("company_id", "created_at" DESC);



CREATE UNIQUE INDEX "advrec_subscription_unique_idx" ON "public"."advRec" USING "btree" ("subscription_id") WHERE ("subscription_id" IS NOT NULL);



ALTER TABLE ONLY "public"."ad_payment_records"
    ADD CONSTRAINT "ad_payment_records_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "public"."advRec"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ad_payment_records"
    ADD CONSTRAINT "ad_payment_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ad_subscriptions"
    ADD CONSTRAINT "ad_subscriptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."advRec"
    ADD CONSTRAINT "advRec_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."advRec"
    ADD CONSTRAINT "advRec_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."company"
    ADD CONSTRAINT "company_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can read plan prices" ON "public"."ad_plan_prices" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Companies can view their own ad payment records" ON "public"."ad_payment_records" FOR SELECT TO "authenticated" USING (("company_id" = "auth"."uid"()));



CREATE POLICY "Companies view own subscriptions" ON "public"."ad_subscriptions" FOR SELECT TO "authenticated" USING (("company_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Company can read own profile" ON "public"."company" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Company can update own profile" ON "public"."company" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Public can view current advertisements" ON "public"."advRec" FOR SELECT TO "authenticated", "anon" USING ((("subscription_expiry" IS NULL) OR ("subscription_expiry" > "now"())));



ALTER TABLE "public"."ad_payment_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ad_plan_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ad_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."advRec" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_company"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_company"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_company"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_advrec_amount"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_advrec_amount"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_advrec_amount"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_ad_slot"("p_category" "text", "p_tier" "text", "p_amount" numeric, "p_duration_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_ad_slot"("p_category" "text", "p_tier" "text", "p_amount" numeric, "p_duration_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."reserve_ad_slot"("p_category" "text", "p_tier" "text", "p_amount" numeric, "p_duration_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_ad_slot"("p_category" "text", "p_tier" "text", "p_amount" numeric, "p_duration_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_ad_direct"("p_category" "text", "p_tier" "text", "p_duration_days" integer, "p_ad_details" "jsonb", "p_payment_reference" "text", "p_payment_proof_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_ad_direct"("p_category" "text", "p_tier" "text", "p_duration_days" integer, "p_ad_details" "jsonb", "p_payment_reference" "text", "p_payment_proof_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_ad_direct"("p_category" "text", "p_tier" "text", "p_duration_days" integer, "p_ad_details" "jsonb", "p_payment_reference" "text", "p_payment_proof_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_ad_direct"("p_category" "text", "p_tier" "text", "p_duration_days" integer, "p_ad_details" "jsonb", "p_payment_reference" "text", "p_payment_proof_url" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_advertisement"("p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_advertisement"("p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_advertisement"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_advertisement"("p_payload" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."ad_payment_records" TO "service_role";
GRANT SELECT ON TABLE "public"."ad_payment_records" TO "authenticated";



GRANT ALL ON TABLE "public"."ad_plan_prices" TO "service_role";
GRANT SELECT ON TABLE "public"."ad_plan_prices" TO "anon";
GRANT SELECT ON TABLE "public"."ad_plan_prices" TO "authenticated";



GRANT ALL ON TABLE "public"."ad_subscriptions" TO "service_role";
GRANT SELECT ON TABLE "public"."ad_subscriptions" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."advRec" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."advRec" TO "authenticated";
GRANT ALL ON TABLE "public"."advRec" TO "service_role";



GRANT ALL ON TABLE "public"."company" TO "anon";
GRANT ALL ON TABLE "public"."company" TO "authenticated";
GRANT ALL ON TABLE "public"."company" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







