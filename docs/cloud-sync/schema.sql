-- InvoiceFlow cloud-synced export templates — Supabase (Postgres) schema with row-level security.
--
-- Apply once in YOUR Supabase project (SQL editor, or `supabase db push` after moving this file to
-- supabase/migrations/). It is intentionally kept under docs/ so that it is reviewed before use; see
-- docs/CLOUD_SETUP.md. Safe to re-run.
--
-- What is stored: template name, file format options (csv/xlsx, delimiter, BOM), the ordered list of
-- field ids and optional custom headers. NEVER invoice content: no values, filenames or images.
--
-- Access model: every row belongs to exactly one auth user (user_id). The browser only holds the
-- project's public (publishable/anon) key; what a request may do is decided here, by RLS, from the
-- signed JWT (auth.uid()). The client never sends user_id.

create table if not exists public.export_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  format      jsonb not null,
  field_order text[] not null,
  headers     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint export_templates_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint export_templates_unique_name unique (user_id, name),
  constraint export_templates_format_shape check (
    jsonb_typeof(format) = 'object'
    and format ->> 'type' in ('csv', 'xlsx')
    and format ->> 'delimiter' in (',', ';', E'\t')
    and jsonb_typeof(format -> 'utf8Bom') = 'boolean'
  ),
  constraint export_templates_fields_len check (cardinality(field_order) between 1 and 40),
  constraint export_templates_headers_shape check (
    jsonb_typeof(headers) = 'object' and octet_length(headers::text) <= 8192
  )
);

create index if not exists export_templates_user_idx on public.export_templates (user_id, updated_at desc);

-- ---------------------------------------------------------------- row-level security
alter table public.export_templates enable row level security;
alter table public.export_templates force row level security;

-- Nobody but a signed-in user touches this table; anonymous (not logged in) gets nothing.
revoke all on public.export_templates from anon, public;
grant select, insert, update, delete on public.export_templates to authenticated;

drop policy if exists export_templates_select_own on public.export_templates;
create policy export_templates_select_own on public.export_templates
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists export_templates_insert_own on public.export_templates;
create policy export_templates_insert_own on public.export_templates
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists export_templates_update_own on public.export_templates;
create policy export_templates_update_own on public.export_templates
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists export_templates_delete_own on public.export_templates;
create policy export_templates_delete_own on public.export_templates
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- guard rails
-- Per-user cap, so one account cannot fill the table. Replacing a template by name is always allowed.
create or replace function public.export_templates_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    if (select count(*) from public.export_templates where user_id = new.user_id) >= 100
       and not exists (select 1 from public.export_templates
                       where user_id = new.user_id and name = new.name) then
      raise exception 'template limit reached (100 per user)' using errcode = 'check_violation';
    end if;
  else
    -- Ownership and creation time are immutable.
    if new.user_id is distinct from old.user_id then
      raise exception 'user_id is immutable' using errcode = 'insufficient_privilege';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists export_templates_guard_trg on public.export_templates;
create trigger export_templates_guard_trg
  before insert or update on public.export_templates
  for each row execute function public.export_templates_guard();
