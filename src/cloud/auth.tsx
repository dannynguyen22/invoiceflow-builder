// Optional Google sign-in (Supabase Auth, PKCE). Guests are a first-class mode: nothing in the app
// requires an account, and with no configuration the whole cloud layer stays inert.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient, shouldRestoreSession } from "./client";
import { readCloudConfig, type CloudConfig, type CloudConfigProblem } from "./config";
import { createSupabaseGateway, type TemplateGateway } from "./gateway";

export interface CloudUser {
  id: string;
  email: string;
  name: string;
}
export type AuthStatus = "disabled" | "loading" | "guest" | "signed_in";

interface AuthValue {
  status: AuthStatus;
  user: CloudUser | null;
  /** Why the cloud layer is off, when it is. */
  problem: CloudConfigProblem | null;
  /** Present only while signed in. */
  gateway: TemplateGateway | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function userFromSession(session: Session | null): CloudUser | null {
  const u = session?.user;
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const name = [meta["full_name"], meta["name"]].find((v) => typeof v === "string" && v.trim());
  const email = u.email ?? "";
  return { id: u.id, email, name: (name as string | undefined)?.trim() || email };
}

export function AuthProvider({
  children,
  config: configOverride,
}: {
  children: ReactNode;
  /** Tests inject a config; the app reads it from the environment. */
  config?: CloudConfig | null;
}) {
  const resolved = useMemo(
    () =>
      configOverride !== undefined
        ? { config: configOverride, problem: configOverride ? null : ("missing" as const) }
        : readCloudConfig(),
    [configOverride],
  );
  const { config, problem } = resolved;
  // Same initial value on server and client, so hydration never mismatches.
  const [status, setStatus] = useState<AuthStatus>(config ? "loading" : "disabled");
  const [user, setUser] = useState<CloudUser | null>(null);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const clientRef = useRef<SupabaseClient | null>(null);

  useEffect(() => {
    if (!config) return;
    if (!shouldRestoreSession()) {
      setStatus("guest");
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const c = await getSupabaseClient(config);
        if (cancelled) return;
        clientRef.current = c;
        setClient(c);
        const { data: sub } = c.auth.onAuthStateChange((_event, session) => {
          // Only state updates here: calling the SDK inside this callback can deadlock it.
          const next = userFromSession(session);
          setUser(next);
          setStatus(next ? "signed_in" : "guest");
        });
        unsubscribe = () => sub.subscription.unsubscribe();
        const { data } = await c.auth.getSession();
        if (cancelled) return;
        const next = userFromSession(data.session);
        setUser(next);
        setStatus(next ? "signed_in" : "guest");
      } catch {
        if (!cancelled) setStatus("guest"); // backend unreachable → keep working as a guest
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [config]);

  const signIn = useCallback(async () => {
    if (!config) return;
    const c = clientRef.current ?? (await getSupabaseClient(config));
    clientRef.current = c;
    setClient(c);
    const { error } = await c.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/workspace` },
    });
    if (error) throw error;
  }, [config]);

  const signOut = useCallback(async () => {
    const c = clientRef.current;
    setUser(null);
    setStatus("guest");
    await c?.auth.signOut({ scope: "local" }); // this browser only, not every device
  }, []);

  const gateway = useMemo(
    () => (status === "signed_in" && client ? createSupabaseGateway(client) : null),
    [status, client],
  );
  const value = useMemo<AuthValue>(
    () => ({ status, user, problem, gateway, signIn, signOut }),
    [status, user, problem, gateway, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
