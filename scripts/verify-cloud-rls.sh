#!/usr/bin/env bash
# Verifies docs/cloud-sync/schema.sql (row-level security + constraints) on a throwaway local
# Postgres cluster. Needs the Postgres server binaries (initdb, pg_ctl, psql) on PATH, e.g.
# `brew install postgresql@18`. Touches nothing outside a temp directory. No credentials involved.
set -euo pipefail
cd "$(dirname "$0")/.."
for bin in initdb pg_ctl psql; do
  command -v "$bin" >/dev/null || { echo "missing $bin on PATH"; exit 2; }
done
DIR="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
cleanup() { pg_ctl -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
initdb -D "$DIR/data" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
pg_ctl -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
PSQL=(psql -X -q -h "$DIR" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1)

# Minimal stand-in for what Supabase provides: roles, auth.users and auth.uid() reading the JWT subject.
"${PSQL[@]}" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on auth.users to authenticated;
SQL
SCHEMA="${SCHEMA_FILE:-docs/cloud-sync/schema.sql}"
"${PSQL[@]}" -o /dev/null -f "$SCHEMA" 2>/dev/null
"${PSQL[@]}" -o /dev/null -f "$SCHEMA" 2>/dev/null   # idempotent: a second run must succeed
"${PSQL[@]}" -o /dev/null -f docs/cloud-sync/rls-test.sql
