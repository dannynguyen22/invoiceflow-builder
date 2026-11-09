// Cloud (optional sign-in + template sync) configuration. Read from build-time public env vars only.
// With no configuration the app is fully functional as a guest and never contacts any backend.
//
// Only the project's PUBLIC key belongs in the browser. Anything that looks like a secret/service-role
// key is refused outright, so a misconfigured deployment cannot ship an admin key to every visitor.

export interface CloudConfig {
  url: string;
  publishableKey: string;
}
export type CloudConfigProblem = "missing" | "invalid_url" | "secret_key";
export type CloudConfigResult =
  { config: CloudConfig; problem: null } | { config: null; problem: CloudConfigProblem };

/** Key under which the Supabase session is stored in this browser. */
export const AUTH_STORAGE_KEY = "invoiceflow.auth";

function jwtRole(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

export function readCloudConfig(
  env: Record<string, unknown> = import.meta.env as Record<string, unknown>,
): CloudConfigResult {
  const url = typeof env["VITE_SUPABASE_URL"] === "string" ? env["VITE_SUPABASE_URL"].trim() : "";
  const key =
    typeof env["VITE_SUPABASE_PUBLISHABLE_KEY"] === "string"
      ? env["VITE_SUPABASE_PUBLISHABLE_KEY"].trim()
      : "";
  if (!url || !key) return { config: null, problem: "missing" };
  try {
    const u = new URL(url);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:"))
      return { config: null, problem: "invalid_url" };
  } catch {
    return { config: null, problem: "invalid_url" };
  }
  if (key.startsWith("sb_secret_") || jwtRole(key) === "service_role")
    return { config: null, problem: "secret_key" };
  return { config: { url: url.replace(/\/+$/, ""), publishableKey: key }, problem: null };
}
