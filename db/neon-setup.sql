-- حاسبة التقسيط الذكية — الحفظ السحابي على Neon
-- Only the Vercel function (api/ic.js) talks to this database; the connection string never reaches the phone.
-- Idempotent: safe to run more than once.

create extension if not exists pgcrypto;
create schema if not exists installments;

create sequence if not exists installments.change_seq;

create table if not exists installments.accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists installments.sessions (
  token_hash text primary key,
  account_id uuid not null references installments.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists installments.plans (
  account_id uuid not null references installments.accounts(id) on delete cascade,
  plan_id text not null,
  data jsonb,
  deleted boolean not null default false,
  client_updated_at text not null,
  server_seq bigint not null default nextval('installments.change_seq'),
  saved_at timestamptz not null default now(),
  primary key (account_id, plan_id)
);
create index if not exists plans_account_seq on installments.plans (account_id, server_seq);

create or replace function installments.norm_username(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

create or replace function installments.new_session(p_account uuid) returns text
language plpgsql set search_path = '' as $$
declare v_token text := encode(public.gen_random_bytes(32), 'hex');
begin
  insert into installments.sessions(token_hash, account_id)
  values (encode(public.digest(v_token, 'sha256'), 'hex'), p_account);
  return v_token;
end $$;

create or replace function installments.account_for(p_token text) returns uuid
language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  update installments.sessions set last_seen = now()
   where token_hash = encode(public.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  returning account_id into v_id;
  if v_id is null then raise exception 'IC_SESSION'; end if;
  return v_id;
end $$;

-- ── v2: one account per app, unlocked by a secret code only (no username) ──
alter table installments.accounts add column if not exists lock_level int not null default 0;
create unique index if not exists accounts_single_owner on installments.accounts ((true));
drop function if exists installments.ic_register(text, text);
drop function if exists installments.ic_login(text, text);

create or replace function installments.ic_status() returns jsonb
language sql set search_path = '' as $$
  select jsonb_build_object('exists', exists (select 1 from installments.accounts))
$$;

-- First time only: choose the secret code (6–8 digits).
create or replace function installments.ic_setup(p_pin text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  if p_pin is null or p_pin !~ '^[0-9]{6,8}$' then raise exception 'IC_PIN_FORMAT'; end if;
  if exists (select 1 from installments.accounts) then raise exception 'IC_EXISTS'; end if;
  insert into installments.accounts(username, pin_hash)
  values ('owner', public.crypt(p_pin, public.gen_salt('bf', 10)))
  returning id into v_id;
  return jsonb_build_object('token', installments.new_session(v_id));
end $$;

-- Unlock on any device. 5 wrong codes lock it: 15 min, then 30, 60 … up to 24 h.
create or replace function installments.ic_unlock(p_pin text) returns jsonb
language plpgsql set search_path = '' as $$
declare a installments.accounts; v_mins int;
begin
  select * into a from installments.accounts limit 1 for update;
  if not found then raise exception 'IC_NO_ACCOUNT'; end if;
  if a.locked_until is not null and a.locked_until > now() then
    raise exception 'IC_LOCKED:%', ceil(extract(epoch from (a.locked_until - now())) / 60)::int;
  end if;
  if a.pin_hash <> public.crypt(coalesce(p_pin, ''), a.pin_hash) then
    if a.failed_attempts + 1 >= 5 then
      v_mins := least(1440, 15 * power(2, a.lock_level)::int);
      update installments.accounts set failed_attempts = 0, lock_level = a.lock_level + 1,
             locked_until = now() + make_interval(mins => v_mins) where id = a.id;
      return jsonb_build_object('error', 'IC_LOCKED:' || v_mins);
    end if;
    update installments.accounts set failed_attempts = a.failed_attempts + 1 where id = a.id;
    return jsonb_build_object('error', 'IC_INVALID', 'left', 4 - a.failed_attempts);
  end if;
  update installments.accounts set failed_attempts = 0, lock_level = 0, locked_until = null where id = a.id;
  return jsonb_build_object('token', installments.new_session(a.id));
end $$;

-- Two-way sync. p_changes: [{id, data, deleted, updatedAt}]; a change is kept only if newer than the stored copy.
create or replace function installments.ic_sync(p_token text, p_changes jsonb, p_since bigint) returns jsonb
language plpgsql set search_path = '' as $$
declare v_acc uuid := installments.account_for(p_token); c jsonb; v_cursor bigint; v_rows jsonb;
begin
  if p_changes is not null and jsonb_typeof(p_changes) <> 'array' then raise exception 'IC_BAD_INPUT'; end if;
  if jsonb_array_length(coalesce(p_changes, '[]'::jsonb)) > 500 then raise exception 'IC_TOO_MANY'; end if;
  for c in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    if coalesce(c->>'id', '') = '' or coalesce(c->>'updatedAt', '') = '' then raise exception 'IC_BAD_INPUT'; end if;
    if pg_column_size(c->'data') > 2000000 then raise exception 'IC_TOO_BIG'; end if;
    insert into installments.plans as t (account_id, plan_id, data, deleted, client_updated_at)
    values (v_acc, c->>'id', case when coalesce((c->>'deleted')::boolean, false) then null else c->'data' end,
            coalesce((c->>'deleted')::boolean, false), c->>'updatedAt')
    on conflict (account_id, plan_id) do update
      set data = excluded.data, deleted = excluded.deleted, client_updated_at = excluded.client_updated_at,
          server_seq = nextval('installments.change_seq'), saved_at = now()
      where t.client_updated_at < excluded.client_updated_at;
  end loop;
  select coalesce(max(server_seq), 0) into v_cursor from installments.plans where account_id = v_acc;
  select coalesce(jsonb_agg(jsonb_build_object('id', plan_id, 'data', data, 'deleted', deleted, 'updatedAt', client_updated_at) order by server_seq), '[]'::jsonb)
    into v_rows from installments.plans where account_id = v_acc and server_seq > coalesce(p_since, 0);
  return jsonb_build_object('cursor', v_cursor, 'plans', v_rows);
end $$;

create or replace function installments.ic_logout(p_token text) returns void
language sql set search_path = '' as $$
  delete from installments.sessions where token_hash = encode(public.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;
-- ✅ نهاية ملف الإعداد
