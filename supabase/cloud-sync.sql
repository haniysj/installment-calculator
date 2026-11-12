-- حاسبة التقسيط الذكية — الحفظ السحابي
-- Tables live in schema "installments" (not exposed to the API). The app only calls the public.ic_* functions.
-- Idempotent: safe to run more than once.

create schema if not exists installments;
revoke all on schema installments from public, anon, authenticated;

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

alter table installments.accounts enable row level security;
alter table installments.sessions enable row level security;
alter table installments.plans enable row level security;
revoke all on all tables in schema installments from public, anon, authenticated;

-- ── helpers ─────────────────────────────────────────────
create or replace function installments.norm_username(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

create or replace function installments.new_session(p_account uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into installments.sessions(token_hash, account_id)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_account);
  return v_token;
end $$;

create or replace function installments.account_for(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update installments.sessions set last_seen = now()
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  returning account_id into v_id;
  if v_id is null then raise exception 'IC_SESSION'; end if;
  return v_id;
end $$;

revoke all on all functions in schema installments from public, anon, authenticated;

-- ── public API ──────────────────────────────────────────
create or replace function public.ic_register(p_username text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user text := installments.norm_username(p_username); v_id uuid;
begin
  if char_length(v_user) < 3 or char_length(v_user) > 40 then raise exception 'IC_USERNAME'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then raise exception 'IC_PIN_FORMAT'; end if;
  if exists (select 1 from installments.accounts where username = v_user) then raise exception 'IC_TAKEN'; end if;
  insert into installments.accounts(username, pin_hash)
  values (v_user, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
  returning id into v_id;
  return jsonb_build_object('token', installments.new_session(v_id), 'username', v_user);
end $$;

create or replace function public.ic_login(p_username text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user text := installments.norm_username(p_username); a installments.accounts;
begin
  select * into a from installments.accounts where username = v_user for update;
  if not found then raise exception 'IC_INVALID'; end if;
  if a.locked_until is not null and a.locked_until > now() then
    raise exception 'IC_LOCKED:%', ceil(extract(epoch from (a.locked_until - now())) / 60)::int;
  end if;
  if a.pin_hash <> extensions.crypt(coalesce(p_pin, ''), a.pin_hash) then
    update installments.accounts
       set failed_attempts = case when a.failed_attempts + 1 >= 5 then 0 else a.failed_attempts + 1 end,
           locked_until = case when a.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
     where id = a.id;
    -- the failed attempt must be kept, so return an error object instead of raising (a raise would roll it back)
    return jsonb_build_object('error', case when a.failed_attempts + 1 >= 5 then 'IC_LOCKED:15' else 'IC_INVALID' end);
  end if;
  update installments.accounts set failed_attempts = 0, locked_until = null where id = a.id;
  return jsonb_build_object('token', installments.new_session(a.id), 'username', a.username);
end $$;

-- Two-way sync. p_changes: [{id, data, deleted, updatedAt}]. A change is kept only if it is newer than the stored copy.
-- Returns every plan changed on the server after p_since, and the new cursor.
create or replace function public.ic_sync(p_token text, p_changes jsonb, p_since bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
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

create or replace function public.ic_logout(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from installments.sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

revoke all on function public.ic_register(text, text), public.ic_login(text, text), public.ic_sync(text, jsonb, bigint), public.ic_logout(text) from public;
grant execute on function public.ic_register(text, text), public.ic_login(text, text), public.ic_sync(text, jsonb, bigint), public.ic_logout(text) to anon, authenticated;

notify pgrst, 'reload schema';
-- ✅ نهاية ملف الحفظ السحابي
