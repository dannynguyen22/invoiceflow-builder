// Validation for template payloads, both before upload and for rows read back from the backend
// (never trust remote data). Mirrors the CHECK constraints in docs/cloud-sync/schema.sql.
import { z } from "zod";
import { FIELD_REGISTRY } from "@/domain/fields";
import type { FieldId } from "@/domain/types";
import type { SavedExportTemplate } from "@/export/templates";

const FIELD_IDS = FIELD_REGISTRY.map((f) => f.id) as [FieldId, ...FieldId[]];
export const MAX_TEMPLATE_NAME = 80;
export const MAX_HEADER_LENGTH = 120;

/** Control characters are stripped from names/headers (they only cause trouble in files and UI). */
const clean = (s: string) =>
  [...s]
    .filter((c) => c.charCodeAt(0) > 0x1f && c.charCodeAt(0) !== 0x7f)
    .join("")
    .trim();

const formatSchema = z.object({
  type: z.enum(["csv", "xlsx"]),
  delimiter: z.enum([",", ";", "\t"]),
  utf8Bom: z.boolean(),
});

export const templateInputSchema = z.object({
  name: z.string().transform(clean).pipe(z.string().min(1).max(MAX_TEMPLATE_NAME)),
  format: formatSchema,
  fieldOrder: z
    .array(z.enum(FIELD_IDS))
    .min(1)
    .max(40)
    .refine((a) => new Set(a).size === a.length, "duplicate fields"),
  headers: z
    .record(z.string(), z.string().transform(clean).pipe(z.string().max(MAX_HEADER_LENGTH)))
    .superRefine((h, ctx) => {
      for (const k of Object.keys(h))
        if (!(FIELD_IDS as string[]).includes(k))
          ctx.addIssue({ code: "custom", message: `unknown field ${k}` });
    })
    .default({}),
});
export type TemplateInput = z.infer<typeof templateInputSchema>;

const remoteRowSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  format: formatSchema,
  field_order: z.array(z.enum(FIELD_IDS)),
  headers: z.record(z.string(), z.string()).nullish(),
  updated_at: z.string(),
});

/** A row from the backend → template, or null when it does not satisfy the contract. */
export function parseRemoteTemplate(row: unknown): SavedExportTemplate | null {
  const r = remoteRowSchema.safeParse(row);
  if (!r.success) return null;
  const input = templateInputSchema.safeParse({
    name: r.data.name,
    format: r.data.format,
    fieldOrder: r.data.field_order,
    headers: r.data.headers ?? {},
  });
  if (!input.success) return null;
  return {
    id: r.data.id,
    name: input.data.name,
    format: input.data.format,
    fieldOrder: input.data.fieldOrder,
    headers: input.data.headers as SavedExportTemplate["headers"],
    updatedAt: r.data.updated_at,
  };
}
