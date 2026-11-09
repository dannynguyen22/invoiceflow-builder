# InvoiceFlow — agent guide

This project is an independent Vite + TanStack Start application (SSR, deployed to
Cloudflare Workers via Nitro). It is no longer connected to Lovable; there is no
external editor that syncs commits, no managed database, and no AI gateway. Manage
the schema, secrets, and dependencies directly in this repository.

## Build & deploy configuration
- The Vite config lives in `vite.config.ts` and delegates to the self-maintained
  helper in `config/vite-tanstack.ts` (plugin order, SSR wiring, env injection,
  Cloudflare Nitro target). This replaced the former
  `@lovable.dev/vite-tanstack-config` package — keep the config here, in-repo.
- Production builds output to `.output/` with Nitro's `cloudflare-module` preset;
  `.output/server/wrangler.json` drives the Cloudflare Workers deploy.
- Never set `ssr.external` / `resolve.external` (the Worker has no runtime module
  resolution) and never add response compression (the edge compresses already).
- This project uses `bun` and tracks `bun.lock`; `package-lock.json` is ignored.

## Project rules (InvoiceFlow)
- The PRD (InvoiceFlow PRD & Engineering Plan v1) is the source of truth; build phase by phase and stop for approval after each.
- All user-facing copy lives in src/i18n/{vi,en}.json and is read via useI18n().t; why: full bilingual coverage, enforced by src/test/i18n.test.ts.
- Route head() metadata uses translate("vi", ...) because SSR always renders the default locale.
- Domain contracts live in src/domain (types, field registry, fixtures); field IDs are stable identity, labels are i18n only.
- Keep raw extraction, interpreted records and export view as separate layers; never mutate raw tokens.
- src/domain/fixtures.ts is synthetic dev/test data and must always be labelled as such in the UI.
- All editor mutations go through pure commands in src/editor/engine.ts that record CorrectionOperations (before/after cells + columns) for undo/redo; why: atomic, testable edits independent of rendering.
- Column field (EditorColumn.fieldId), per-cell interpretation (Cell.fieldId) and export config (ExportColumn) are distinct; header replacement only changes the column and flags mismatched cells.
- Drag-and-drop uses typed payloads from src/editor/dnd.ts; every drag gesture has a click/menu alternative. Never put a Radix menu trigger on a native drag source (its pointerdown blocks dragging).
- Engine commands validate invariants themselves (token ownership, duplicates, verify-only-when-clean), never relying on UI filtering.
- Cell.verified is set only by the explicit verify command; any value or field change clears it; why: "value selected" ≠ "value checked".
- Extraction lives in src/extraction (files sniffing, xml, pdf via PDF.js, ocr via Tesseract.js, session store); parsers are dynamic-imported so SSR never loads them.
- OCR and PDF.js assets are self-hosted under public/ocr and public/pdfjs (copied from node_modules, keep versions matched to the installed packages); why: no invoice-related request may hit a third-party CDN.
- XML input is refused if it contains DOCTYPE/ENTITY and is matched by localName; why: no entity expansion, namespace-agnostic.
- PDF/OCR field matching is deterministic in src/extraction/matching.ts (lines → label segments → exact/fuzzy labels → seller/buyer section → format-checked values → line-below fallback → shape-only alternatives); why: explainable, testable, no AI; tests replay real pipeline output saved in src/test/samples/real-extraction.json.
- Editor panel sizes persist via react-resizable-panels useDefaultLayout (localStorage) and panels render only after hydration; why: avoids SSR layout mismatch.
- Optional cloud layer lives in src/cloud (Supabase Auth + Google, PKCE; templates in table export_templates). The browser holds only the public key; per-user access is enforced by row-level security in docs/cloud-sync/schema.sql, never by UI filtering. The client never sends user_id, never stores invoice content, and refuses service-role keys. Setup: docs/CLOUD_SETUP.md; run scripts/verify-cloud-rls.sh after any schema change.
- Smart Auto-fill/Batch Correction: protected cells (verified, hand-typed, document-assigned) change only through an explicit `overrideProtected: { confirmed: true, documentIds }`; the UI must show a confirmation before passing it. Learning (label, relative geometry, section, shape, layout signature, XML path) lives in src/editor/learning.ts; proposals always carry reasons and a source reference.
