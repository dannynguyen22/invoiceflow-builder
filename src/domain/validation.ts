import { getField } from "./fields";
import type { FieldId } from "./types";

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True when `value` is a plausible value for `fieldId`. Empty values are handled separately (missing). */
export function isValueCompatible(fieldId: FieldId, raw: string): boolean {
  const value = raw.trim();
  if (!value) return true;
  switch (getField(fieldId).valueType) {
    case "tax_id":
      return /^\d{10}(-\d{3})?$/.test(value);
    case "identifier":
      return /^[0-9A-Za-z/-]{1,20}$/.test(value);
    case "date": {
      let m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return validDate(+m[1]!, +m[2]!, +m[3]!);
      m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return validDate(+m[3]!, +m[2]!, +m[1]!);
      return false;
    }
    case "amount":
      return /^-?\d[\d.,\s]*$/.test(value);
    case "currency":
      return /^[A-Z]{3}$/.test(value);
    case "text":
      // A bare long number is almost never a name/address/note.
      return !/^[\d.,\s-]+$/.test(value) || fieldId === "notes";
    default:
      return true;
  }
}
