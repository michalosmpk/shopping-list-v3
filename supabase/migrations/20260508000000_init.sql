-- =====================================================================
-- shopping-list-v3 — initial schema
--
-- Multi-user shopping lists with optional guest share links. The BFF
-- (Express server) talks to this database via the service-role key, so
-- the application code (not Postgres RLS) is the source of authority.
-- We still enable RLS as defence-in-depth: if anyone ever connects with
-- the anon key, they see nothing.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- profiles
--
-- One row per `auth.users` entry. `name` is what the user types into
-- the login form (the BFF translates it to a synthetic email under the
-- hood). `is_admin` gates user-management endpoints.
-- ---------------------------------------------------------------------
create table public.profiles (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  name         text        not null unique,              -- lowercased, [a-z0-9._-]
  display_name text        not null,                     -- shown in UI, preserves case
  is_admin     boolean     not null default false,
  created_at   timestamptz not null default now()
);

create index profiles_is_admin_idx on public.profiles (is_admin) where is_admin;

-- ---------------------------------------------------------------------
-- lists
--
-- `updated_at_ms` is the client's wall-clock timestamp at the moment of
-- the last edit (ms since epoch). Sync is last-writer-wins on this
-- column. Soft-deletes flow through the `deleted` flag so other clients
-- can drop their local copies.
--
-- Sharing: a list optionally has a stable `share_token` that appears in
-- the public URL (/share/<token>). `share_password_hash` is a bcrypt
-- digest of the guest password. `share_enabled` lets the owner pause a
-- share without losing the configured token/password.
-- ---------------------------------------------------------------------
create table public.lists (
  id                   uuid    primary key,
  owner_id             uuid    not null references auth.users(id) on delete cascade,
  name                 text    not null default 'Untitled list',
  position             integer not null default 0,
  share_token          text,
  share_password_hash  text,
  share_enabled        boolean not null default false,
  updated_at_ms        bigint  not null,
  deleted              boolean not null default false
);

create index lists_owner_idx on public.lists (owner_id);
create unique index lists_share_token_uniq
  on public.lists (share_token)
  where share_token is not null;

-- ---------------------------------------------------------------------
-- items
--
-- One row per item inside a list. Same sync model as `lists`.
-- ---------------------------------------------------------------------
create table public.items (
  id            uuid    primary key,
  list_id       uuid    not null references public.lists(id) on delete cascade,
  name          text    not null default '',
  quantity      text    not null default '',
  checked       boolean not null default false,
  position      integer not null default 0,
  updated_at_ms bigint  not null,
  deleted       boolean not null default false
);

create index items_list_idx on public.items (list_id);
create index items_list_position_idx on public.items (list_id, position);

-- ---------------------------------------------------------------------
-- Heartbeat helpers
--
-- Per-scope `max(updated_at_ms)` is the "server version" the client
-- compares against. Two thin SQL functions keep that logic in one
-- place; the BFF invokes them via PostgREST/RPC or plain SQL.
-- ---------------------------------------------------------------------
create or replace function public.user_server_version(uid uuid)
returns bigint
language sql
stable
as $$
  select coalesce(
    greatest(
      (select coalesce(max(updated_at_ms), 0) from public.lists where owner_id = uid),
      (select coalesce(max(i.updated_at_ms), 0)
         from public.items i
         join public.lists l on l.id = i.list_id
        where l.owner_id = uid)
    ),
    0
  );
$$;

create or replace function public.list_server_version(lid uuid)
returns bigint
language sql
stable
as $$
  select coalesce(
    greatest(
      (select coalesce(updated_at_ms, 0) from public.lists where id = lid),
      (select coalesce(max(updated_at_ms), 0) from public.items where list_id = lid)
    ),
    0
  );
$$;

-- ---------------------------------------------------------------------
-- Row-level security
-- All tables: enabled, no policies. Service role bypasses RLS, so the
-- BFF works transparently while the anon role is locked out.
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.lists    enable row level security;
alter table public.items    enable row level security;
