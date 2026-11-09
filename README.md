# InvoiceFlow Builder

InvoiceFlow is a fully bilingual (Vietnamese default, English) invoice extraction
and correction tool. It reads invoices from XML, PDF, and image (OCR) sources,
interprets them into structured records through a deterministic, explainable
matching pipeline, lets you correct and verify fields in an interactive editor,
and exports to CSV/XLSX. An optional cloud layer (Supabase Auth + Google) syncs
saved export templates per user.

The product requirements live in the *InvoiceFlow PRD & Engineering Plan* and the
current state is tracked in `docs/IMPLEMENTATION_STATUS.md` and `roadmap.md`.

## Tech stack

- **Vite + TanStack Start** (React 19, SSR). The Vite config is self-contained in
  `vite.config.ts` → `config/vite-tanstack.ts`.
- **TanStack Router / Query**, Tailwind CSS v4, Radix UI.
- **Nitro** for the production server bundle, targeting **Cloudflare Workers**
  (`cloudflare-module` preset) by default.
- **Vitest** + Testing Library for tests.
- Extraction: PDF.js and Tesseract.js, self-hosted under `public/pdfjs` and
  `public/ocr` (no third-party CDN for invoice data).

This project uses **bun** (`bun.lock` is the tracked lockfile).

## Development

Install [bun](https://bun.sh) and [Node.js](https://nodejs.org) (Node is used by
the toolchain). Then:

```sh
git clone <this-repository-url>
cd invoiceflow-builder
bun install
bun run dev
```

The dev server runs on http://localhost:8080.

### Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start the dev server (SSR, HMR) on port 8080. |
| `bun run build` | Production build → `.output/` (Cloudflare Workers via Nitro). |
| `bun run preview` | Preview the production build locally. |
| `bun run test` | Run the full test suite once. |
| `bun run test:watch` | Run tests in watch mode. |
| `bun run lint` | ESLint. |
| `bun run format` | Prettier. |
| `bunx tsc --noEmit` | TypeScript type check. |

## Environment variables

Cloud sign-in and template sync are optional. Copy `.env.example` to `.env.local`
(git-ignored) and fill in **your** Supabase project's public values:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Only `VITE_*` (public, browser-bundled) values belong here. Never put a
`service_role` / secret key in any `VITE_*` variable — the app refuses to start
cloud features if it detects one. Leave these empty to run guest-only. See
`docs/CLOUD_SETUP.md` for the full setup and the row-level-security schema in
`docs/cloud-sync/`.

## Deployment

`bun run build` produces `.output/` with Nitro's `cloudflare-module` preset and
generates `.output/server/wrangler.json`. Deploy with Wrangler:

```sh
bunx wrangler deploy        # from the generated config, or
bunx nitro deploy --prebuilt
```

To target a different platform, set `NITRO_PRESET` (or use Vercel/Netlify/
Cloudflare Pages auto-detection) before building, or pass
`defineConfig({ nitro: { preset: "..." } })` in `vite.config.ts`.
