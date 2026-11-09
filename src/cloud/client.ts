// Lazily created Supabase browser client. The SDK is loaded (and any network contact made) only when
// a session already exists in this browser, when returning from the OAuth redirect, or when the user
// presses "Sign in". Guests never download it and never contact a backend.
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTH_STORAGE_KEY, type CloudConfig } from "./config";

let pending: Promise<SupabaseClient> | null = null;

export function getSupabaseClient(config: CloudConfig): Promise<SupabaseClient> {
  pending ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(config.url, config.publishableKey, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: AUTH_STORAGE_KEY,
      },
    }),
  );
  return pending;
}

/** True when this browser already holds a session or is returning from the OAuth redirect. */
export function shouldRestoreSession(): boolean {
  try {
    if (window.localStorage.getItem(AUTH_STORAGE_KEY)) return true;
    const q = new URLSearchParams(window.location.search);
    return q.has("code") || q.has("error_description");
  } catch {
    return false;
  }
}
