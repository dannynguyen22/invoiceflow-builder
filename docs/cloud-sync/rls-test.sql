-- Behavioural test of docs/cloud-sync/schema.sql. Run by scripts/verify-cloud-rls.sh against a
-- throwaway local Postgres with a minimal stand-in for Supabase's `auth` schema. Any failed
-- assertion aborts with an exception; success prints RLS_TESTS_PASSED.
\set ON_ERROR_STOP on

create or replace function pg_temp.expect_error(sql text, needle text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm ilike '%' || needle || '%' then return; end if;
    raise exception 'wrong error for [%]: got "%", wanted "%"', sql, sqlerrm, needle;
  end;
  raise exception 'expected failure but succeeded: %', sql;
end $$;

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

-- ---- user A creates templates (user_id is NOT supplied: it defaults to auth.uid())
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) as _ \gset
insert into public.export_templates (name, format, field_order)
values ('Kế toán A', '{"type":"xlsx","delimiter":",","utf8Bom":true}', array['invoice_number','total_amount']);
insert into public.export_templates (name, format, field_order, headers)
values ('Mẫu CSV', '{"type":"csv","delimiter":";","utf8Bom":true}', array['invoice_date'], '{"invoice_date":"Ngày"}');
do $$ begin
  if (select count(*) from public.export_templates) <> 2 then raise exception 'A should see own 2 rows'; end if;
  if (select user_id from public.export_templates where name = 'Kế toán A') <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'user_id must default to auth.uid()'; end if;
end $$;

-- ---- user B sees none of A's rows and cannot modify or delete them
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false) as _ \gset
do $$
declare n int;
begin
  if (select count(*) from public.export_templates) <> 0 then raise exception 'B must not read A rows'; end if;
  update public.export_templates set name = 'hijacked' where name = 'Kế toán A';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B must not update A rows'; end if;
  delete from public.export_templates where name = 'Kế toán A';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B must not delete A rows'; end if;
end $$;

-- B cannot insert a row owned by A, nor reassign ownership
select pg_temp.expect_error(
  $q$insert into public.export_templates (user_id, name, format, field_order)
     values ('11111111-1111-1111-1111-111111111111','x','{"type":"csv","delimiter":",","utf8Bom":false}', array['notes'])$q$,
  'row-level security');
insert into public.export_templates (name, format, field_order)
values ('Của B', '{"type":"csv","delimiter":",","utf8Bom":false}', array['notes']);
select pg_temp.expect_error(
  $q$update public.export_templates set user_id = '11111111-1111-1111-1111-111111111111' where name = 'Của B'$q$,
  'immutable');

-- Same name under different users is fine; per-user uniqueness holds.
insert into public.export_templates (name, format, field_order)
values ('Kế toán A', '{"type":"csv","delimiter":",","utf8Bom":false}', array['notes']);
select pg_temp.expect_error(
  $q$insert into public.export_templates (name, format, field_order)
     values ('Kế toán A','{"type":"csv","delimiter":",","utf8Bom":false}', array['notes'])$q$,
  'unique');

-- ---- anonymous (not logged in) has no access at all
reset role;
set role anon;
select pg_temp.expect_error('select * from public.export_templates', 'permission denied') \gset
select pg_temp.expect_error($q$insert into public.export_templates (name, format, field_order)
  values ('anon','{"type":"csv","delimiter":",","utf8Bom":false}', array['notes'])$q$, 'permission denied');

-- ---- constraints
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) as _ \gset
select pg_temp.expect_error($q$insert into public.export_templates (name, format, field_order)
  values ('', '{"type":"csv","delimiter":",","utf8Bom":false}', array['notes'])$q$, 'name_len');
select pg_temp.expect_error($q$insert into public.export_templates (name, format, field_order)
  values (repeat('x',81), '{"type":"csv","delimiter":",","utf8Bom":false}', array['notes'])$q$, 'name_len');
select pg_temp.expect_error($q$insert into public.export_templates (name, format, field_order)
  values ('bad type', '{"type":"exe","delimiter":",","utf8Bom":false}', array['notes'])$q$, 'format_shape');
select pg_temp.expect_error($q$insert into public.export_templates (name, format, field_order)
  values ('no fields', '{"type":"csv","delimiter":",","utf8Bom":false}', array[]::text[])$q$, 'fields_len');
select pg_temp.expect_error($q$insert into public.export_templates (name, format, field_order, headers)
  values ('big', '{"type":"csv","delimiter":",","utf8Bom":false}', array['notes'], jsonb_build_object('h', repeat('y', 9000)))$q$, 'headers_shape');

-- ---- ownership/created_at are immutable, updated_at moves, name is trimmed, upsert replaces by name
do $$
declare before_ts timestamptz; after_ts timestamptz; uid uuid;
begin
  select updated_at, user_id into before_ts, uid from public.export_templates where name = 'Mẫu CSV';
  perform pg_sleep(0.01);
  update public.export_templates set name = '  Mẫu CSV  ' where name = 'Mẫu CSV';
  select updated_at into after_ts from public.export_templates where name = 'Mẫu CSV';
  if after_ts <= before_ts then raise exception 'updated_at must advance'; end if;
  if (select user_id from public.export_templates where name = 'Mẫu CSV') <> uid then raise exception 'owner changed'; end if;
end $$;
insert into public.export_templates (name, format, field_order)
values ('Mẫu CSV', '{"type":"xlsx","delimiter":",","utf8Bom":true}', array['seller_name'])
on conflict (user_id, name) do update set format = excluded.format, field_order = excluded.field_order;
do $$ begin
  if (select format ->> 'type' from public.export_templates where name = 'Mẫu CSV') <> 'xlsx' then
    raise exception 'upsert by (user_id,name) must replace'; end if;
end $$;

-- ---- per-user cap of 100 (replacing by name still allowed at the cap)
do $$
declare i int;
begin
  for i in 1..98 loop
    insert into public.export_templates (name, format, field_order)
    values ('bulk ' || i, '{"type":"csv","delimiter":",","utf8Bom":false}', array['notes']);
  end loop;
end $$;
do $$ begin
  if (select count(*) from public.export_templates) <> 100 then
    raise exception 'expected 100 rows for A, got %', (select count(*) from public.export_templates); end if;
end $$;
select pg_temp.expect_error($q$insert into public.export_templates (name, format, field_order)
  values ('one too many','{"type":"csv","delimiter":",","utf8Bom":false}', array['notes'])$q$, 'limit');
insert into public.export_templates (name, format, field_order)
values ('bulk 1', '{"type":"xlsx","delimiter":",","utf8Bom":true}', array['notes'])
on conflict (user_id, name) do update set format = excluded.format;

\echo RLS_TESTS_PASSED
