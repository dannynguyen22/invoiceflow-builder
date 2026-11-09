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
