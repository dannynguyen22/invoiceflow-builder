<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

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
