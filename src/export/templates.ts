// Guest-friendly export templates, persisted locally (PRD §05, §10). No backend, no account needed:
// a template stores the chosen format/delimiter/BOM and the column field order + custom headers, so a
// returning guest reloads their preferred export shape. Signed-in users can additionally sync templates
// to their account (Supabase + row-level security); that code lives in src/cloud and needs a Supabase
// project (see docs/CLOUD_SETUP.md).
import type { EditorColumn, FieldId } from "@/domain/types";

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

/**
 * Export-time column order from a template: columns whose field the template lists come first, in
 * the template's order; the rest keep their current order after them. Editor columns are never
 * changed (export is a separate view).
 */
export function orderColumnsByTemplate(
  columns: readonly EditorColumn[],
  fieldOrder: readonly FieldId[],
): EditorColumn[] {
  const placed = new Set<string>();
  const out: EditorColumn[] = [];
  for (const f of fieldOrder)
    for (const c of columns)
      if (c.fieldId === f && !placed.has(c.id)) {
        placed.add(c.id);
        out.push(c);
      }
  for (const c of columns) if (!placed.has(c.id)) out.push(c);
  return out;
}

/** Custom header text of a template, keyed by column id (only for columns present). */
export function headerOverridesFor(
  columns: readonly EditorColumn[],
  headers: Partial<Record<FieldId, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of columns) {
    const h = headers[c.fieldId]?.trim();
    if (h) out[c.id] = h;
  }
  return out;
}
