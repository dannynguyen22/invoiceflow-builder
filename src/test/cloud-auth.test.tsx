import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/cloud/auth";
import type { CloudConfig } from "@/cloud/config";

const wrap =
  (config: CloudConfig | null) =>
  ({ children }: { children: ReactNode }) =>
    createElement(AuthProvider, { config, children });

describe("AuthProvider", () => {
  it("without configuration: disabled, no gateway, signIn is a no-op", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: wrap(null) });
    expect(result.current).toMatchObject({
      status: "disabled",
      user: null,
      gateway: null,
      problem: "missing",
    });
    await act(async () => result.current.signIn());
    expect(result.current.status).toBe("disabled");
  });

  it("configured but no stored session: becomes a guest without loading the SDK or any request", async () => {
    window.localStorage.clear();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useAuth(), {
      wrapper: wrap({ url: "https://x.supabase.co", publishableKey: "sb_publishable_x" }),
    });
    await waitFor(() => expect(result.current.status).toBe("guest"));
    expect(result.current.gateway).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("server render and first client render agree (loading, then resolved after mount)", () => {
    const Probe = () => createElement("span", null, useAuth().status);
    const html = (config: CloudConfig | null) =>
      renderToString(createElement(AuthProvider, { config, children: createElement(Probe) }));
    expect(html({ url: "https://x.supabase.co", publishableKey: "sb_publishable_x" })).toContain(
      "loading",
    );
    expect(html(null)).toContain("disabled");
  });

  it("throws when used outside the provider", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow();
    err.mockRestore();
  });
});
