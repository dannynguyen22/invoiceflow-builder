// Guest-friendly export templates, persisted locally (PRD §05, §10). No backend, no account needed:
// a template stores the chosen format/delimiter/BOM and the column field order + custom headers, so a
// returning guest reloads their preferred export shape. Signed-in sync (Supabase RLS) is deferred — it
// requires Lovable-managed auth/DB and external credentials (see docs/IMPLEMENTATION_STATUS.md).
import type { FieldId } from "@/domain/types";

export interface SavedExportTemplate {
  id: string;
  name: string;
  format: { type: "csv" | "xlsx"; delimiter: "," | ";" | "\t"; utf8Bom: boolean };
  /** Ordered field ids; headers keyed by fieldId when the user customised them. */
  fieldOrder: FieldId[];
  headers: Partial<Record<FieldId, string>>;
  updatedAt: string;
}

const KEY = "invoiceflow.exportTemplates";

function read(): SavedExportTemplate[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedExportTemplate[]) : [];
  } catch {
    return [];
  }
}

function write(list: SavedExportTemplate[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

export function listTemplates(): SavedExportTemplate[] {
  return read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveTemplate(
  tpl: Omit<SavedExportTemplate, "id" | "updatedAt"> & { id?: string },
): SavedExportTemplate {
  const list = read();
  const id = tpl.id ?? `tpl-${Date.now().toString(36)}`;
  const record: SavedExportTemplate = { ...tpl, id, updatedAt: new Date().toISOString() };
  const next = [record, ...list.filter((t) => t.id !== id && t.name !== tpl.name)];
  write(next);
  return record;
}

export function deleteTemplate(id: string): void {
  write(read().filter((t) => t.id !== id));
}
