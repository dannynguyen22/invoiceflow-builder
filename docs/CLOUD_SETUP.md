# Cloud sign-in and template sync — setup

Google sign-in and cloud-synced export templates are **optional**. Without the two environment
variables below the app runs as a guest exactly as before: no SDK is downloaded, no backend is
contacted, templates stay in this browser's `localStorage`.

No credentials are included in this repository. You create the Supabase project and Google OAuth
client yourself and put the **public** values in the environment.

## What is stored in the cloud (and what is not)

| Stored (table `public.export_templates`) | Never stored or sent |
|---|---|
| template name, file format (csv/xlsx), delimiter, UTF-8 BOM flag | invoice files, images, extracted values |
| ordered list of field ids, optional custom header text | file names, tax ids, amounts, any cell content |

Invoices are still processed entirely in the browser (PDF.js / Tesseract / XML). Signing in adds one
thing: your templates can follow you across devices.

## Architecture

```
Browser (publishable key only)  ──HTTPS + user JWT──▶  Supabase Auth (Google, PKCE)
        │                                              Supabase Postgres + Row Level Security
        └─ src/cloud/*                                 docs/cloud-sync/schema.sql
```

* **Auth:** Supabase Auth with the Google provider, PKCE flow. The session lives in this browser under
  the `invoiceflow.auth` localStorage key.
* **Per-user access control is enforced by the database, not the UI.** `export_templates` has RLS
  enabled *and forced*; every policy is `user_id = auth.uid()`. The `anon` role has no privileges.
  The client never sends `user_id`; the column defaults to `auth.uid()` and cannot be changed.
* **Guard rails in the schema:** CHECK constraints (name 1–80 chars, format shape, 1–40 fields,
  headers ≤ 8 KB), unique `(user_id, name)`, a 100-templates-per-user cap, immutable owner.
* **Client:** `src/cloud/schema.ts` validates everything sent and everything received (invalid remote
  rows are dropped). `src/cloud/config.ts` refuses a `service_role` / `sb_secret_…` key, so an admin key
  cannot be bundled into the browser by mistake.
* **No secret in the repo or the bundle.** The Google client secret lives only in the Supabase
  dashboard. `.env*` files are git-ignored except `.env.example`.

## Setup steps

1. **Supabase project.** Create one at <https://supabase.com/dashboard>.
2. **Apply the schema.** Open *SQL Editor*, paste `docs/cloud-sync/schema.sql`, run it. It is
   idempotent. (If you use the Supabase CLI, move the file to `supabase/migrations/<timestamp>_export_templates.sql`;
   it is kept under `docs/` so it can be reviewed first and because `AGENTS.md` asks agents not to add
   migrations on their own.)
3. **Google OAuth client.** Google Cloud Console → *APIs & Services → Credentials → Create credentials →
   OAuth client ID → Web application*.
   * Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
   * Keep the Client ID and Client secret for the next step.
4. **Enable Google in Supabase.** *Authentication → Providers → Google*: paste Client ID and secret, enable.
5. **Redirect URLs.** *Authentication → URL Configuration*: set *Site URL* to your production origin and add
   to *Redirect URLs*: `https://<your-domain>/workspace` and, for development,
   `http://localhost:<dev-port>/workspace`.
6. **Environment variables** (build-time, public values only; see `.env.example`):
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<publishable / anon key from Project Settings → API>
   ```
   For local development put them in `.env.local` (git-ignored). For the deployed build set them in
   whatever builds the app. **Never** use the `service_role`/secret key here.
7. Rebuild and restart. The header shows **Đăng nhập / Sign in** and the export dialog offers
   *Đồng bộ với tài khoản*.

## Verify

* **Database security (no credentials needed):** `./scripts/verify-cloud-rls.sh` starts a throwaway local
  Postgres, applies the schema twice, and runs `docs/cloud-sync/rls-test.sql`: user B cannot read, update,
  delete or take over user A's templates; `anon` has no access; constraints and the 100-row cap hold.
  Prints `RLS_TESTS_PASSED`. Requires the Postgres server binaries (`brew install postgresql@18`).
* **App logic:** `npm test` (`src/test/cloud*.test.ts*`) covers configuration safety, payload validation,
  the gateway (no `user_id` sent, error mapping), guest-vs-signed-in template lists and SSR/hydration.
* **Manual, needs your credentials:** sign in with two different Google accounts, save a template with
  sync on in each, and confirm each account lists only its own.

## Behaviour to know about

* Signing in **redirects through Google and reloads the page**. Opened invoices exist only in memory, so
  the app asks for confirmation first when invoices are loaded.
* Signing out removes account templates from the screen; templates saved on this device remain.
* If the backend is unreachable the app falls back to guest mode and device templates keep working.
* Nothing is uploaded automatically. A device template reaches the account only when the user saves with
  sync on or presses *Đưa lên tài khoản*.

## Supabase project ownership

This project uses **your own** Supabase project, not a managed backend. The schema
and row-level-security policies live in `docs/cloud-sync/schema.sql` and are applied
manually (see above / `scripts/verify-cloud-rls.sh`). There is no external platform
that owns the database, secrets, or migrations — manage them directly here. If you
prefer a standard Supabase CLI layout, move the schema into `supabase/migrations/`.

## Not verified here

Real Google sign-in and a live Supabase project (no credentials available). The SQL/RLS and the
client logic are tested as described above.
