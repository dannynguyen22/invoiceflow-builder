// One list of saved export templates, from two places:
//  - this device (localStorage; always available, works as a guest), and
//  - the signed-in user's account (Supabase, protected by row-level security).
// Nothing is uploaded unless the user signed in AND chose to sync that template.
import { useCallback, useEffect, useState } from "react";
import type { FieldId } from "@/domain/types";
import {
  deleteTemplate,
  listTemplates,
  saveTemplate,
  type SavedExportTemplate,
} from "@/export/templates";
import { useAuth } from "./auth";
import { CloudError, type CloudErrorCode } from "./gateway";
import { templateInputSchema, type TemplateInput } from "./schema";

export type TemplateLocation = "device" | "account";
export type TemplateEntry = SavedExportTemplate & { location: TemplateLocation };

export interface NewTemplate {
  name: string;
  format: SavedExportTemplate["format"];
  fieldOrder: FieldId[];
  headers: SavedExportTemplate["headers"];
}

const byRecent = (a: TemplateEntry, b: TemplateEntry) => b.updatedAt.localeCompare(a.updatedAt);

export function useTemplates(active: boolean) {
  const { status, gateway } = useAuth();
  const [device, setDevice] = useState<SavedExportTemplate[]>([]);
  const [account, setAccount] = useState<SavedExportTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<CloudErrorCode | null>(null);

  const fail = (e: unknown) => setError(e instanceof CloudError ? e.code : "unknown");

  const refresh = useCallback(async () => {
    setDevice(listTemplates());
    if (!gateway) {
      setAccount([]);
      return;
    }
    setLoading(true);
    try {
      setAccount(await gateway.list());
      setError(null);
    } catch (e) {
      setAccount([]);
      fail(e);
    } finally {
      setLoading(false);
    }
  }, [gateway]);

  // Cloud data is fetched only while the template UI is open.
  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh, status]);

  const entries: TemplateEntry[] = [
    ...device.map((t) => ({ ...t, location: "device" as const })),
    ...account.map((t) => ({ ...t, location: "account" as const })),
  ].sort(byRecent);

  /** Save to this device, or to the account (requires sign-in). Returns false on failure. */
  const save = useCallback(
    async (tpl: NewTemplate, target: TemplateLocation): Promise<boolean> => {
      const parsed = templateInputSchema.safeParse(tpl);
      if (!parsed.success) {
        setError("invalid");
        return false;
      }
      const input: TemplateInput = parsed.data;
      try {
        if (target === "account") {
          if (!gateway) throw new CloudError("not_signed_in");
          await gateway.save(input);
        } else {
          saveTemplate({
            name: input.name,
            format: input.format,
            fieldOrder: input.fieldOrder,
            headers: input.headers as SavedExportTemplate["headers"],
          });
        }
        setError(null);
        await refresh();
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },
    [gateway, refresh],
  );

  const remove = useCallback(
    async (entry: TemplateEntry): Promise<boolean> => {
      try {
        if (entry.location === "account") {
          if (!gateway) throw new CloudError("not_signed_in");
          await gateway.remove(entry.id);
        } else deleteTemplate(entry.id);
        setError(null);
        await refresh();
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },
    [gateway, refresh],
  );

  /** Explicit user action: copy a device template to the account. */
  const copyToAccount = useCallback(
    (entry: TemplateEntry) =>
      save(
        {
          name: entry.name,
          format: entry.format,
          fieldOrder: entry.fieldOrder,
          headers: entry.headers,
        },
        "account",
      ),
    [save],
  );

  return {
    entries,
    loading,
    error,
    canSync: !!gateway,
    save,
    remove,
    copyToAccount,
    refresh,
    clearError: () => setError(null),
  };
}
