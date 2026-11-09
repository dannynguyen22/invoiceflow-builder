// Cloud layer: configuration safety, payload validation, gateway behaviour and merged template list.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readCloudConfig } from "@/cloud/config";
import { CloudError, createSupabaseGateway, type TemplateGateway } from "@/cloud/gateway";
import { parseRemoteTemplate, templateInputSchema } from "@/cloud/schema";
import { useTemplates } from "@/cloud/useTemplates";
import { headerOverridesFor, listTemplates, orderColumnsByTemplate } from "@/export/templates";
import type { EditorColumn } from "@/domain/types";

const auth = vi.hoisted(() => ({ gateway: null as unknown }));
vi.mock("@/cloud/auth", () => ({
  useAuth: () => ({ status: auth.gateway ? "signed_in" : "guest", gateway: auth.gateway }),
}));

const b64 = (o: object) =>
  btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (role: string) => `${b64({ alg: "HS256" })}.${b64({ role })}.sig`;

describe("cloud configuration", () => {
  it("is off without configuration (guest-only, no backend contact)", () => {
    expect(readCloudConfig({})).toEqual({ config: null, problem: "missing" });
    expect(readCloudConfig({ VITE_SUPABASE_URL: "https://x.supabase.co" }).problem).toBe("missing");
  });
  it("accepts a public key over https and normalizes the URL", () => {
    const r = readCloudConfig({
      VITE_SUPABASE_URL: "https://x.supabase.co/",
      VITE_SUPABASE_PUBLISHABLE_KEY: jwt("anon"),
    });
    expect(r.config?.url).toBe("https://x.supabase.co");
  });
  it("accepts new-style publishable keys and local http only for localhost", () => {
    expect(
      readCloudConfig({
        VITE_SUPABASE_URL: "http://localhost:54321",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc",
      }).config,
    ).not.toBeNull();
    expect(
      readCloudConfig({
        VITE_SUPABASE_URL: "http://example.com",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc",
      }).problem,
    ).toBe("invalid_url");
    expect(
      readCloudConfig({ VITE_SUPABASE_URL: "not a url", VITE_SUPABASE_PUBLISHABLE_KEY: "k" })
        .problem,
    ).toBe("invalid_url");
  });
  it("refuses secret / service-role keys so they can never ship to the browser", () => {
    expect(
      readCloudConfig({
        VITE_SUPABASE_URL: "https://x.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: jwt("service_role"),
      }).problem,
    ).toBe("secret_key");
    expect(
      readCloudConfig({
        VITE_SUPABASE_URL: "https://x.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc",
      }).problem,
    ).toBe("secret_key");
  });
});

describe("template validation", () => {
  const ok = {
    name: "  Kế toán  ",
    format: { type: "csv", delimiter: ";", utf8Bom: true },
    fieldOrder: ["invoice_number", "total_amount"],
    headers: { invoice_number: "Số HĐ" },
  };
  it("trims names, strips control characters, keeps Vietnamese", () => {
    const r = templateInputSchema.parse({ ...ok, name: "  Kế\u0000 toán\n  " });
    expect(r.name).toBe("Kế toán");
  });
  it.each([
    ["empty name", { name: "   " }],
    ["name too long", { name: "x".repeat(81) }],
    ["unknown format", { format: { type: "exe", delimiter: ",", utf8Bom: false } }],
    ["unknown field id", { fieldOrder: ["not_a_field"] }],
    ["duplicate fields", { fieldOrder: ["notes", "notes"] }],
    ["no fields", { fieldOrder: [] }],
    ["header for unknown field", { headers: { bogus: "x" } }],
    ["header too long", { headers: { notes: "y".repeat(121) } }],
  ])("rejects %s", (_n, patch) => {
    expect(templateInputSchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
  it("drops remote rows that violate the contract instead of showing them", () => {
    const row = {
      id: "1",
      name: "A",
      format: { type: "csv", delimiter: ",", utf8Bom: false },
      field_order: ["notes"],
      headers: null,
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(parseRemoteTemplate(row)?.name).toBe("A");
    expect(parseRemoteTemplate({ ...row, field_order: ["<script>"] })).toBeNull();
    expect(parseRemoteTemplate({ ...row, format: { type: "csv" } })).toBeNull();
    expect(parseRemoteTemplate("nope")).toBeNull();
  });
});

/** Records the calls the gateway makes against a PostgREST-like client. */
function fakeClient(result: { data?: unknown; error?: unknown }) {
  const calls: { op: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "order", "limit", "upsert", "delete", "eq", "single"])
    chain[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return chain;
    };
  chain["then"] = (res: (v: unknown) => unknown) =>
    res({ data: result.data ?? null, error: result.error ?? null });
  const client = {
    from: (t: string) => (calls.push({ op: "from", args: [t] }), chain),
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("cloud gateway", () => {
  const input = templateInputSchema.parse({
    name: "T",
    format: { type: "xlsx", delimiter: ",", utf8Bom: true },
    fieldOrder: ["notes"],
    headers: {},
  });
  const row = {
    id: "r1",
    name: "T",
    format: input.format,
    field_order: ["notes"],
    headers: {},
    updated_at: "2026-01-02T00:00:00Z",
  };

  it("never sends user_id (the database assigns it) and upserts by (user_id, name)", async () => {
    const { client, calls } = fakeClient({ data: row });
    await createSupabaseGateway(client).save(input);
    const upsert = calls.find((c) => c.op === "upsert")!;
    expect(Object.keys(upsert.args[0] as object).sort()).toEqual([
      "field_order",
      "format",
      "headers",
      "name",
    ]);
    expect(upsert.args[1]).toEqual({ onConflict: "user_id,name" });
  });
  it("rejects an invalid payload before any request", async () => {
    const { client, calls } = fakeClient({ data: row });
    await expect(createSupabaseGateway(client).save({ ...input, name: "" })).rejects.toMatchObject({
      code: "invalid",
    });
    expect(calls).toHaveLength(0);
  });
  it("lists only valid rows", async () => {
    const { client } = fakeClient({ data: [row, { ...row, id: "bad", field_order: ["zzz"] }] });
    const list = await createSupabaseGateway(client).list();
    expect(list.map((t) => t.id)).toEqual(["r1"]);
  });
  it.each([
    [{ code: "42501" }, "denied"],
    [{ code: "PGRST301" }, "not_signed_in"],
    [{ code: "23514", message: "template limit reached" }, "limit"],
    [{ code: "23514", message: "violates check" }, "invalid"],
    [new TypeError("Failed to fetch"), "network"],
    [{ code: "XX000" }, "unknown"],
  ])("maps backend error %j to %s", async (error, code) => {
    const { client } = fakeClient({ error });
    await expect(createSupabaseGateway(client).remove("x")).rejects.toEqual(
      new CloudError(code as never),
    );
  });
});

describe("export-time template application", () => {
  const cols: EditorColumn[] = [
    { id: "c1", fieldId: "invoice_number" },
    { id: "c2", fieldId: "seller_name" },
    { id: "c3", fieldId: "total_amount" },
  ];
  it("orders listed fields first, keeps the rest, never mutates the editor columns", () => {
    const copy = [...cols];
    expect(
      orderColumnsByTemplate(cols, ["total_amount", "invoice_number"]).map((c) => c.id),
    ).toEqual(["c3", "c1", "c2"]);
    expect(orderColumnsByTemplate(cols, ["notes"]).map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(cols).toEqual(copy);
  });
  it("maps custom headers by field to column ids", () => {
    expect(headerOverridesFor(cols, { total_amount: " Tổng ", notes: "x" })).toEqual({
      c3: "Tổng",
    });
  });
});

describe("useTemplates (device + account)", () => {
  beforeEach(() => window.localStorage.clear());
  const fmt = { type: "csv" as const, delimiter: ";" as const, utf8Bom: true };
  const memoryGateway = (): TemplateGateway & {
    rows: Map<string, import("@/export/templates").SavedExportTemplate>;
  } => {
    const rows = new Map<string, import("@/export/templates").SavedExportTemplate>();
    return {
      rows,
      list: async () => [...rows.values()],
      save: async (i) => {
        const r = {
          id: `acc-${rows.size + 1}`,
          name: i.name,
          format: i.format,
          fieldOrder: i.fieldOrder,
          headers: i.headers as never,
          updatedAt: new Date().toISOString(),
        };
        rows.set(r.name, r);
        return r;
      },
      remove: async (id) => void [...rows].forEach(([k, v]) => v.id === id && rows.delete(k)),
    };
  };
  function setup(gateway: TemplateGateway | null) {
    auth.gateway = gateway;
    return renderHook(() => useTemplates(true));
  }

  it("as a guest, saves only to this device and never needs a gateway", async () => {
    const { result } = setup(null);
    await act(
      async () =>
        void (await result.current.save(
          { name: "G", format: fmt, fieldOrder: ["notes"], headers: {} },
          "device",
        )),
    );
    await waitFor(() =>
      expect(result.current.entries.map((e) => [e.name, e.location])).toEqual([["G", "device"]]),
    );
    expect(result.current.canSync).toBe(false);
    await act(
      async () =>
        void (await result.current.save(
          { name: "A", format: fmt, fieldOrder: ["notes"], headers: {} },
          "account",
        )),
    );
    expect(result.current.error).toBe("not_signed_in");
    expect(listTemplates().map((t) => t.name)).toEqual(["G"]);
  });

  it("signed in: lists both places, uploads only on explicit request", async () => {
    const gw = memoryGateway();
    const { result } = setup(gw);
    await act(
      async () =>
        void (await result.current.save(
          { name: "Local", format: fmt, fieldOrder: ["notes"], headers: {} },
          "device",
        )),
    );
    expect(gw.rows.size).toBe(0); // saving on the device never uploads
    await act(
      async () =>
        void (await result.current.save(
          { name: "Cloud", format: fmt, fieldOrder: ["notes"], headers: {} },
          "account",
        )),
    );
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    const local = result.current.entries.find((e) => e.location === "device")!;
    await act(async () => void (await result.current.copyToAccount(local)));
    expect([...gw.rows.keys()].sort()).toEqual(["Cloud", "Local"]);
    const acct = result.current.entries.find(
      (e) => e.location === "account" && e.name === "Cloud",
    )!;
    await act(async () => void (await result.current.remove(acct)));
    expect([...gw.rows.keys()]).toEqual(["Local"]);
    expect(listTemplates().map((t) => t.name)).toEqual(["Local"]);
  });

  it("a failing backend reports an error code and leaves device templates usable", async () => {
    const gw: TemplateGateway = {
      list: async () => {
        throw new CloudError("network");
      },
      save: async () => {
        throw new CloudError("network");
      },
      remove: async () => {},
    };
    const { result } = setup(gw);
    await waitFor(() => expect(result.current.error).toBe("network"));
    await act(
      async () =>
        void (await result.current.save(
          { name: "Still", format: fmt, fieldOrder: ["notes"], headers: {} },
          "device",
        )),
    );
    await waitFor(() => expect(result.current.entries.map((e) => e.name)).toContain("Still"));
  });
});
