import type { FieldDefinition, FieldGroup, FieldId } from "./types";

// Available field registry (PRD §05). IDs are stable; labels come from i18n.
export const FIELD_REGISTRY: readonly FieldDefinition[] = [
  { id: "invoice_number", group: "invoice", valueType: "identifier", labelKey: "fields.invoice_number" },
  { id: "invoice_date", group: "invoice", valueType: "date", labelKey: "fields.invoice_date" },
  { id: "invoice_series", group: "invoice", valueType: "identifier", labelKey: "fields.invoice_series" },
  { id: "seller_name", group: "seller", valueType: "text", labelKey: "fields.seller_name" },
  { id: "seller_tax_id", group: "seller", valueType: "tax_id", labelKey: "fields.seller_tax_id" },
  { id: "seller_address", group: "seller", valueType: "text", labelKey: "fields.seller_address" },
  { id: "buyer_name", group: "buyer", valueType: "text", labelKey: "fields.buyer_name" },
  { id: "buyer_tax_id", group: "buyer", valueType: "tax_id", labelKey: "fields.buyer_tax_id" },
  { id: "subtotal", group: "amounts", valueType: "amount", labelKey: "fields.subtotal" },
  { id: "vat_amount", group: "amounts", valueType: "amount", labelKey: "fields.vat_amount" },
  { id: "total_amount", group: "amounts", valueType: "amount", labelKey: "fields.total_amount" },
  { id: "currency", group: "amounts", valueType: "currency", labelKey: "fields.currency" },
  { id: "source_filename", group: "metadata", valueType: "text", labelKey: "fields.source_filename" },
  { id: "notes", group: "metadata", valueType: "text", labelKey: "fields.notes" },
  { id: "review_status", group: "metadata", valueType: "status", labelKey: "fields.review_status" },
] as const;

export const FIELD_GROUPS: readonly FieldGroup[] = ["invoice", "seller", "buyer", "amounts", "metadata"];

const byId = new Map(FIELD_REGISTRY.map((f) => [f.id, f]));
export function getField(id: FieldId): FieldDefinition {
  const f = byId.get(id);
  if (!f) throw new Error(`Unknown field id: ${id}`);
  return f;
}
export function fieldsInGroup(group: FieldGroup): FieldDefinition[] {
  return FIELD_REGISTRY.filter((f) => f.group === group);
}
