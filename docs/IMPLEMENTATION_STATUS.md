# InvoiceFlow — Implementation Status

_Last updated: 2026-11-09. Audited against the InvoiceFlow PRD & Engineering Execution Plan (MVP v1)._

This document tracks verified implementation status. "Verified" means confirmed by reading the
code and/or running tests/build — not by self-report.

## Verification snapshot (2026-11-09, initial audit)

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npx tsc --noEmit` | ✅ clean |
| Tests | `npm test` | ⚠️ 102/104 pass; 2 i18n tests failed due to a test-env `localStorage` gap (not product code) |
| Production build | `npm run build` | ✅ succeeds |
| Dependency audit | `npm audit` | ⚠️ 9 vulns (7 moderate, 2 high), all in dev deps (eslint toolchain, vite, zod). Not fixing with `--force` per constraints. |

## Phase status

| Phase | PRD scope | Status |
|-------|-----------|--------|
| 0 — Foundation | routes, i18n vi/en, design system, field registry, fixtures, tests | ✅ Complete |
| 1 — Interactive editor | grid, fields panel, add/replace/reorder, candidate picker, manual edit, preview, undo | ✅ Complete |
| 2 — Real extraction | XML parser, PDF.js text, OCR worker, bbox overlays, raw store, per-file status | ✅ Complete |
| 3 — Matching/review | exact/fuzzy aliases, ranking, validation, exception-first filters, source linking | ✅ Complete — matching, source linking, **Needs-Review filter**, **VAT/duplicate checks** done |
| 4 — Smart operations | Smart Auto-fill, scope matching, Batch Correction, preview, atomic undo | ✅ Complete — engine + preview dialogs, per-row own values, protection, atomic undo |
| 5 — Account/export | Google sign-in, RLS templates, CSV/XLSX, UTF-8 BOM, identifiers as strings | 🟡 CSV/XLSX export done; auth/templates intentionally deferred (guest-only MVP, see note) |
| 6 — QA/beta | security/network audit, perf, i18n coverage, a11y, acceptance matrix | 🟡 In progress |

## Detailed findings (initial audit)

### Solid / complete
- **Three-layer domain model** (`src/domain/types.ts`): raw extraction (A, immutable), interpreted
  cells (B), export view (C). Layers A/B active; C (`ExportColumn`) was declared but unused — now wired by export.
- **Editor engine** (`src/editor/engine.ts`): pure command layer with `replace_field`, `add_column`,
  `reorder_columns`, `set_value`, `verify`; atomic undo/redo; ownership validation (cross-document
  blocked in the engine, not just UI); "selected ≠ verified" semantics.
- **Matching** (`src/extraction/matching.ts`): deterministic, no-AI, no-network. Lines → label/value
  segments → exact/fuzzy label → section (seller/buyer) → format-checked value → spatial fallback →
  shape-only alternatives → ranked candidates with provenance/reasons.
- **Extraction** (`src/extraction/*`): XML (entity-expansion refused), PDF.js text + coords, Tesseract
  OCR in worker, self-hosted assets under `public/`, per-file status/progress.
- **Review UI**: candidate picker (inline popover + docked panel), source highlighting on preview,
  undo/redo UI + keyboard shortcuts.
- **i18n**: complete vi/en dictionaries, vi default, parity test enforces identical keys.
- **Landing**: headline, CTAs, how-it-works, formats, privacy, FAQ, language switcher (header).

### Gaps being addressed in this build-out
1. **CSV/XLSX export** (Phase 5) — the single largest gap. No serialization, no download, no BOM,
   no formula-injection guard, no export dialog.
2. **Smart Auto-fill** (Phase 4) — learn-from-example, per-row own-value matching, scopes, preview.
3. **Batch Correction** (Phase 4) — same-error-signature detection, preview, atomic undo.
4. **Needs-Review filter** (Phase 3) — exception-first review has styling but no filter/jump control.
5. **VAT-arithmetic validation** (Phase 3) — subtotal + VAT = total consistency check.
6. **Test-env `localStorage`** — 2 i18n tests fail because jsdom lacks a backed localStorage in this runner.

## Change log
- 2026-11-09: Initial audit recorded.
- 2026-11-09: Fixed test-env `localStorage` (all 104 base tests pass). Implemented Phase 5 **CSV/XLSX export**
  (`src/export/*`): dependency-free XLSX writer (in-repo ZIP + CRC-32, inline-string cells so leading zeros
  survive and formulas can't execute), CSV with UTF-8 BOM / delimiter / RFC-4180 escaping / formula-injection
  guard, scope filter (all / validated), export validation dialog wired into the editor toolbar. Added
  cross-field **VAT-arithmetic / duplicate-invoice checks** (`src/domain/invoice-checks.ts`). 12 new export
  tests (incl. CRC-32 verified against the standard value, real XLSX opened with system unzip). 116 tests pass,
  build + typecheck clean.
- 2026-11-09: Implemented Phase 4 **Smart Auto-fill** and **Batch Correction** (`src/editor/smart.ts`):
  learn-from-example, per-row OWN-value matching (never copies the example value), scopes
  (same supplier / similar layout / entire batch), preview dialogs with matched/review/not-found counts
  and before/after per row, confirmed/manual cells protected, single atomic `auto_fill` / `batch_correction`
  op (one undo). Added **Needs-Review filter** toolbar toggle + count (exception-first review, Phase 3).
  5 new smart-ops tests (own-value, scope, protection, atomic undo). Changed files lint-clean & formatted.
  121 tests pass, build + typecheck clean.
