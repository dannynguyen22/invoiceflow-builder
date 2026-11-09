// File admission: extension, size and content sniffing (magic bytes) before any parsing.
import { LIMITS } from "@/config/limits";
import type { SupportedMime } from "@/domain/types";
import type { ExtractionErrorCode } from "./errors";

export type FileKind = "xml" | "pdf" | "image";

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

export function kindFromName(name: string): FileKind | null {
  const ext = extensionOf(name);
  if (!(LIMITS.acceptedExtensions as readonly string[]).includes(ext)) return null;
  if (ext === ".xml") return "xml";
  if (ext === ".pdf") return "pdf";
  return "image";
}

/** Detect the real type from the first bytes; never trust the extension alone. */
export function sniff(bytes: Uint8Array): { kind: FileKind; mime: SupportedMime } | null {
  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { kind: "pdf", mime: "application/pdf" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { kind: "image", mime: "image/png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", mime: "image/jpeg" };
  // XML: optional UTF-8 BOM + whitespace, then "<".
  let i = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  if (b[i] === 0x3c) return { kind: "xml", mime: "application/xml" };
  return null;
}

/** Synchronous pre-checks on name + size. */
export function precheck(file: { name: string; size: number }): ExtractionErrorCode | null {
  if (!kindFromName(file.name)) return "unsupported_type";
  if (file.size > LIMITS.maxFileSizeMB * 1024 * 1024) return "too_large";
  return null;
}

/** Content check: the sniffed type must match the extension's kind. */
export function verifyContent(name: string, head: Uint8Array): { kind: FileKind; mime: SupportedMime } | ExtractionErrorCode {
  const expected = kindFromName(name);
  const got = sniff(head);
  if (!expected) return "unsupported_type";
  if (!got || got.kind !== expected) return "type_mismatch";
  return got;
}
