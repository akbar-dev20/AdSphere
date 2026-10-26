
import { createClient } from "@supabase/supabase-js";

/**
 * Read and sanitize a Vite env var.
 *
 * Secrets pasted into GitHub Actions (or .env files) often carry stray
 * whitespace or surrounding quotes. createClient would accept them and the
 * failure would only surface later as a network/401 error, so we clean the
 * value up front and reject obviously malformed ones.
 */
function readEnv(name) {
  const raw = import.meta.env[name];
  if (typeof raw !== "string") return "";

  let value = raw.trim();

  // Strip one layer of matching quotes, a common paste mistake.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  return value;
}

const url = readEnv("VITE_SUPABASE_URL");
const anonKey = readEnv("VITE_SUPABASE_ANON_KEY");

/**
 * Validate the configured URL/Key pair.
 *
 * Returns an empty string when the pair looks usable, otherwise a
 * human-readable reason the configuration is broken. This is exported so the
 * UI (and tests) can distinguish "not configured" from "misconfigured".
 */
export function supabaseConfigError() {
  if (!url && !anonKey) {
    return "Supabase is not configured: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing.";
  }
  if (!url || !anonKey) {
    return "Supabase is misconfigured: set BOTH VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "Supabase is misconfigured: VITE_SUPABASE_URL must start with https://";
    }
  } catch {
    return "Supabase is misconfigured: VITE_SUPABASE_URL is not a valid URL.";
  }
  if (!anonKey.startsWith("eyJ")) {
    return "Supabase is misconfigured: VITE_SUPABASE_ANON_KEY does not look like a Supabase JWT (anon/publishable key).";
  }
  return "";
}

const configError = supabaseConfigError();

export const isSupabaseConfigured = configError === "";

// Surface the exact reason in the console so a broken deploy is diagnosable
// from the browser instead of failing with a generic fetch error.
if (configError) {
  console.error(`[AdSphere] ${configError}`);
}

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
