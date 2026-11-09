# InvoiceFlow — Implementation Status

_Last updated: 2026-11-09 (review-fix pass). Audited against the InvoiceFlow PRD & Engineering Execution Plan (MVP v1)._

This document tracks verified implementation status. "Verified" means confirmed by reading the
code and/or running tests/build — not by self-report.

## Verification snapshot (2026-11-09, initial audit)

## Verification snapshot (2026-11-09, initial audit)

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npx tsc --noEmit` | ✅ clean |
| Tests | `npm test` | ⚠️ 102/104 pass; 2 i18n tests failed due to a test-env `localStorage` gap (not product code) |
| Production build | `npm run build` | ✅ succeeds |
| Dependency audit | `npm audit` | ⚠️ 9 vulns (7 moderate, 2 high), all in dev deps (eslint toolchain, vite, zod). Not fixing with `--force` per constraints. |

## Verification snapshot (2026-11-09, after build-out)

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npx tsc --noEmit` | ✅ clean |
| Tests | `npm test` | ✅ 122/122 pass (12 files) |
| Production build | `npm run build` | ✅ succeeds |
| Lint (changed files) | `npx eslint <changed>` | ✅ clean |
| Privacy/network audit | grep for outbound fetch in `src/extraction` | ✅ none; OCR/PDF assets self-hosted under `/ocr`, `/pdfjs` (versions match installed pdfjs-dist 6.5.438 / tesseract.js 7.0.0) |
| Dependency audit | `npm audit` | ⚠️ 9 vulns (7 moderate, 2 high), all dev-only; `--force` not run per constraints |

## Verification snapshot (2026-11-09, review-fix pass: learning, protection, cloud, browser review)

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npx tsc --noEmit` | ✅ clean |
| Tests | `npm test` | ✅ 190/190 pass (17 files; +67 new) |
| Production build | `npm run build` | ✅ succeeds; Supabase SDK is a lazy chunk (guests never download it) |
| Database security | `./scripts/verify-cloud-rls.sh` (throwaway local Postgres 18) | ✅ `RLS_TESTS_PASSED`; test fails if RLS is weakened (checked by mutation) |
| Real-browser review (Chrome via Playwright) | upload → extract → learn → batch → protect → export → sign-in menu, at 1920×1080 and 1366×768, vi + en | ✅ no horizontal overflow, no page errors, **zero third-party requests** after self-hosting the font |
| Signed-in flow | Playwright with a **mock** Supabase (no real credentials) | ✅ session restore, account menu, template save/list/copy/delete, sign-out; **no invoice content in any backend request** |
| Dependency audit | `npm audit` | ⚠ unchanged: 9 vulns (7 moderate, 2 high), dev-only; `--force` not run |
| Lint (files touched by this pass) | `npx eslint <files>` | ✅ no errors (2 `react-refresh` warnings in `src/cloud/auth.tsx`). Repo-wide `eslint .` still reports pre-existing Prettier errors in untouched files (e.g. `CellPicker.tsx`, `DocumentPreview.tsx`, `LanguageSwitcher.tsx`, `engine.ts`). |

## Review-fix pass (this change set)

### 1. Smart Auto-fill now learns from the example (`src/editor/learning.ts`, `smart.ts`)
Before: "similar layout" meant "same extraction source type" and values came only from the generic label matcher.
Now, from the one example cell, the app learns and uses:
* **nearby label** (incl. unknown multi-word labels, shown in full, e.g. "Số định danh"), same line or label-above-value;
* **relative geometry** (offset from the label in page widths / line heights) and **page zone**;
* **section** (seller vs buyer block), so a repeated "Mã số thuế:" resolves to the right one;
* **value shape** (digit/letter/punctuation pattern) and field validity;
* **layout signature** (printed labels + their positions, page shape/count; XML: element paths) → real `layoutSimilarity`, threshold 60 %;
* **supplier** (cells, else reliable extracted tax id/name) and the **XML element path**;
* typed examples are located in the document by value; if they cannot be located nothing is guessed.
The deterministic registry matcher is a cross-check and fallback: it is trusted only if the user's example agreed with it; a position-only guess never displaces a reliable label-based candidate; ambiguous or weak evidence is graded "review" (not pre-selected). Values are always built from the target document's own tokens.

### 2. Protected data (`protectionOf`, `ApplyOptions.overrideProtected`)
Verified/confirmed, hand-typed and document-assigned (OCR-drop) cells are never changed by Auto-fill or Batch Correction by default. Override requires `{ confirmed: true, documentIds }`, is checked by the engine on the **live** cell (stale plans cannot overwrite a cell verified after planning), clears verification, and undoes in one step. Batch Correction also derives its error signature from the flaw the cell had **before** the user fixed it, and learns from that fix.

### 3. UX
Both dialogs show: what was learned; scope with explanation and in/out-of-scope counts; per-row before → after, reasons (localized, machine-readable codes), source page + printed line (or XML path); groups "ready" (pre-selected) / "needs review" (not pre-selected) / "protected" (hidden until an override switch is turned on, never pre-selected, explicit confirmation dialog). Rows that already hold the proposed value are counted, not listed.

### 4. Account + cloud templates (`src/cloud`, `docs/cloud-sync`, `docs/CLOUD_SETUP.md`)
Optional Google sign-in (Supabase Auth, PKCE) and templates synced to the user's account; guests unchanged. Per-user access is enforced by Postgres RLS (`export_templates`, RLS forced, `anon` revoked, owner immutable, 100-row cap, CHECK constraints); the client never sends `user_id`, validates everything sent/received, and refuses service-role keys. Templates now also **apply** their stored column order/headers at export time. Nothing is uploaded unless the user signs in and chooses to sync. Lovable block in `AGENTS.md` reviewed (findings in `docs/CLOUD_SETUP.md`), left untouched; project rules added below it.

### 5. Browser review: findings and fixes
| Finding | Fix |
|---|---|
| Google Fonts requested on every page load (IP/UA leak, contradicts local-first) | Self-hosted `@fontsource/be-vietnam-pro` (vietnamese + latin); 0 third-party requests |
| Learned label shown as "danh" instead of "Số định danh" | Label extension for unknown multi-word labels (display) |
| Rows listing "0000077 → 0000077" | New `unchanged` outcome, counted not listed |
| Long reason lists made rows heavy | First 4 reasons + "+N lý do khác" toggle |
| Candidate panel clipped at 1366×768 (header fixed, list scrolled separately) | Whole panel scrolls; default split 55/45 for new users |
| Stale toast covered the dialog's primary button at 1366 | Toasts dismissed when a dialog opens |
| Dialog/Sheet close label hard-coded "Close" | Localized (`common.close`) |
| English plural glitches ("1 pages", "Fill 1 cells") in new strings | Count-neutral wording |
| "Sign out" revoked sessions on all devices (Supabase default `global`) | `scope: "local"` |
| Message "you chose differently from the automatic suggestion" shown when the matcher simply had no suggestion | Neutral wording |
Checked and fine: Vietnamese wording and diacritics in dialogs/menus, popovers, dialogs, resizing panels, XLSX export (leading zeros kept, protected hand-typed value preserved), OCR of an image scan (needs-review flagged), keyboard Esc/undo.

## Remaining blockers and limits (this pass)
* **Real Google sign-in is unverified**: needs *your* Supabase project + Google OAuth client (steps in `docs/CLOUD_SETUP.md`). Everything around it is tested with mocks and a real local Postgres, but the OAuth round-trip itself has not been exercised.
* Signing in **redirects and reloads the page**, which discards in-memory invoices; the app asks first when invoices are loaded. A popup flow would avoid this (not built).
* Applying the SQL to your Supabase project is a manual step (kept under `docs/` because `AGENTS.md` tells agents not to add migrations).
* Not tested: Safari/Firefox, touch devices, screen-reader walkthrough, files near the 20 MB limit, batches of 20 mixed files under load.
* Mixed date formats in the grid/export (`20/10/2026` from PDF text vs `2026-10-03` from XML) were noticed but are pre-existing and out of scope.
* Matching thresholds (matched ≥ 0.75, review ≥ 0.40, layout ≥ 0.60) are heuristics tuned on synthetic and sample invoices; they need real-invoice beta feedback.

## MVP acceptance checklist (PRD §14)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Header replacement preserves value + OCR provenance; undo restores header | ✅ | `engine.replaceColumnField`; `editor-engine.test.ts` |
| 2 | Add column preserves data, never invents values | ✅ | `engine.addColumn` fills only reliable candidates; `editor-engine.test.ts` |
| 3 | OCR token drop blocks cross-document mapping | ✅ | `engine.assignToken` cross_document guard; tests |
| 4 | Single click shows ranked candidates from correct invoice; double click edits | ✅ | `CellPicker`/`CandidatePanel`; `cell-picker.test.tsx` |
| 5 | Auto-fill finds distinct per-document values, abstains on uncertainty | ✅ | `smart.planAutoFill` (own candidate per doc, review bucket); `smart.test.ts` |
| 6 | Batch correction previews affected rows, reverses in one undo | ✅ | `smart.planBatchCorrection`/`applyBatchCorrection`; `smart.test.ts` |
| 7 | Source preview highlights correct page/region for selected cell | ✅ | `DocumentPreview`; `document-preview.test.tsx` |
| 8 | Tax IDs / invoice numbers retain leading zeros in CSV and XLSX | ✅ | XLSX inline strings + CSV text; `export.test.ts` |
| 9 | Google user A cannot read user B templates; guest can export without login | 🟡 | Guest export ✅. RLS ✅ verified on real Postgres (`scripts/verify-cloud-rls.sh`). Real Google round-trip ⏳ needs your Supabase/Google credentials (`docs/CLOUD_SETUP.md`) |
| 10 | Switching vi/en translates all app text but does not rename custom export headers | ✅ | i18n parity test; `buildExportColumns` keeps `headerOverrides` |
| 11 | Local-mode network audit shows no invoice content transmitted | ✅ | no outbound fetch in extraction; self-hosted assets |
| 12 | Corrupt/unsupported files fail gracefully; partial batch succeeds | ✅ | `extraction/files.ts` precheck + `errors.ts`; `extraction.test.ts` |

## Detailed findings (initial audit)

| Phase | PRD scope | Status |
|-------|-----------|--------|
| 0 — Foundation | routes, i18n vi/en, design system, field registry, fixtures, tests | ✅ Complete |
| 1 — Interactive editor | grid, fields panel, add/replace/reorder, candidate picker, manual edit, preview, undo | ✅ Complete |
| 2 — Real extraction | XML parser, PDF.js text, OCR worker, bbox overlays, raw store, per-file status | ✅ Complete |
| 3 — Matching/review | exact/fuzzy aliases, ranking, validation, exception-first filters, source linking | ✅ Complete — matching, source linking, **Needs-Review filter**, **VAT/duplicate checks** done |
| 4 — Smart operations | Smart Auto-fill, scope matching, Batch Correction, preview, atomic undo | ✅ Complete — engine + preview dialogs, per-row own values, protection, atomic undo |
| 5 — Account/export | Google sign-in, RLS templates, CSV/XLSX, UTF-8 BOM, identifiers as strings | 🟡 CSV/XLSX, local + **cloud-synced templates** (code, RLS schema, UI, mock-tested) done; live Google sign-in awaits your credentials |
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
- 2026-11-09: Added **local saved export templates** (`src/export/templates.ts`): guest-friendly,
  localStorage-persisted format/delimiter/BOM + column order; save/apply/delete in the export dialog.
  No invoice content stored. 1 new test. 122 tests pass, build + typecheck + lint clean.

## Known blockers / deferred (documented per task constraints)

### Google OAuth + Supabase-RLS template sync (PRD §10, Phase 5) — IMPLEMENTED, awaiting credentials
Built in the review-fix pass (see above and `docs/CLOUD_SETUP.md`). The earlier blocker ("AGENTS.md reserves the database for Lovable") was resolved by keeping the schema under `docs/cloud-sync/` for manual application to the project's own Supabase instance, and by reviewing the Lovable block (not edited). What still needs you: create the Supabase project, apply the SQL, create the Google OAuth client, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

### Dependency audit — not auto-fixed
`npm audit` reports 9 vulns (7 moderate, 2 high) entirely in dev dependencies (eslint toolchain, vite dev
server, zod). Per task constraints `npm audit fix --force` was NOT run (it would pull breaking major versions
of vite/zod outside the stated ranges). None affect the shipped client bundle's runtime behaviour; the vite
advisories concern the local dev server only.
- 2026-11-09: Phase 6 QA pass. Behavioral review (semantic_reviewer) surfaced two issues, both fixed:
  (a) CSV formula guard corrupted negative amounts — now plain numbers bypass the guard;
  (b) smart ops now defensively enforce candidate token-ownership. Privacy/network audit: no outbound
  invoice-content requests; OCR/PDF assets self-hosted, versions match installed packages. Added
  acceptance-checklist + verification snapshot above. 123 tests pass, build + typecheck + lint clean.
- 2026-11-09: Review-fix pass. (1) Auto-fill learns label / relative geometry / section / shape / layout signature / XML path from the example (`src/editor/learning.ts`); real layout similarity replaces the source-type check. (2) Verified, hand-typed and document-assigned cells are protected in Auto-fill and Batch Correction; overrides need an explicit confirmed list, enforced in the engine. (3) New previews with reasons, sources, before/after, safe default selection, protected group behind a switch + confirmation. (4) Optional Google sign-in + RLS-protected cloud templates (`src/cloud`, `docs/cloud-sync`, `docs/CLOUD_SETUP.md`, `scripts/verify-cloud-rls.sh`); templates apply stored column order/headers. (5) Real-browser review at 1920×1080 and 1366×768 → fixes listed above (self-hosted font, panel scrolling, toast overlap, localized close labels, English wording, local-only sign-out). 190 tests, tsc, build, RLS script pass.
