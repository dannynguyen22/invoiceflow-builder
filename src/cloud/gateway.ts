// Template storage in the user's Supabase account. Authorization is NOT decided here: the database
// enforces per-user access with row-level security (docs/cloud-sync/schema.sql). This layer
//  - never sends user_id (the database assigns auth.uid(), so it cannot be spoofed),
//  - validates what it sends and what it receives,
//  - maps backend failures to a small set of user-facing error codes.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SavedExportTemplate } from "@/export/templates";
import { parseRemoteTemplate, templateInputSchema, type TemplateInput } from "./schema";

export type CloudErrorCode =
  "not_signed_in" | "network" | "denied" | "invalid" | "limit" | "unknown";
export class CloudError extends Error {
  constructor(readonly code: CloudErrorCode) {
    super(code);
    this.name = "CloudError";
  }
}

export interface TemplateGateway {
  list(): Promise<SavedExportTemplate[]>;
  save(input: TemplateInput): Promise<SavedExportTemplate>;
  remove(id: string): Promise<void>;
}

const TABLE = "export_templates";
const COLUMNS = "id,name,format,field_order,headers,updated_at";

interface PgError {
  code?: string;
  message?: string;
  status?: number;
}

function toCloudError(e: unknown): CloudError {
  if (e instanceof CloudError) return e;
  const err = (e ?? {}) as PgError;
  if (err.code === "42501" || err.status === 403) return new CloudError("denied");
  if (err.code === "PGRST301" || err.code === "PGRST303" || err.status === 401)
    return new CloudError("not_signed_in");
  if (err.code === "23514")
    return new CloudError(/limit/i.test(err.message ?? "") ? "limit" : "invalid");
  if (err.code === "23502" || err.code === "22P02") return new CloudError("invalid");
  if (e instanceof TypeError || /fetch|network/i.test(err.message ?? ""))
    return new CloudError("network");
  return new CloudError("unknown");
}

export function createSupabaseGateway(client: SupabaseClient): TemplateGateway {
  return {
    async list() {
      const { data, error } = await client
        .from(TABLE)
        .select(COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw toCloudError(error);
      // Rows that fail validation are dropped, not displayed.
      return (data ?? []).map(parseRemoteTemplate).filter((t): t is SavedExportTemplate => !!t);
    },
    async save(input) {
      const parsed = templateInputSchema.safeParse(input);
      if (!parsed.success) throw new CloudError("invalid");
      const { name, format, fieldOrder, headers } = parsed.data;
      const { data, error } = await client
        .from(TABLE)
        .upsert({ name, format, field_order: fieldOrder, headers }, { onConflict: "user_id,name" })
        .select(COLUMNS)
        .single();
      if (error) throw toCloudError(error);
      const t = parseRemoteTemplate(data);
      if (!t) throw new CloudError("unknown");
      return t;
    },
    async remove(id) {
      const { error } = await client.from(TABLE).delete().eq("id", id);
      if (error) throw toCloudError(error);
    },
  };
}
