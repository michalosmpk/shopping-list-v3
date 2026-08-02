-- One-shot schema for Coolify / hosted Supabase.
-- Paste into Supabase Studio → SQL Editor → Run (once, on a fresh DB).
-- Same contents as supabase/migrations/* applied in order.

-- =====================================================================
-- init
-- =====================================================================

create extension if not exists pgcrypto;

create table public.profiles (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  name         text        not null unique,
  display_name text        not null,
  is_admin     boolean     not null default false,
  created_at   timestamptz not null default now()
);

create index profiles_is_admin_idx on public.profiles (is_admin) where is_admin;

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

alter table public.profiles enable row level security;
alter table public.lists    enable row level security;
alter table public.items    enable row level security;

-- =====================================================================
-- list_members
-- =====================================================================

create table public.list_members (
  list_id    uuid        not null references public.lists(id)    on delete cascade,
  user_id    uuid        not null references auth.users(id)      on delete cascade,
  position   integer     not null default 0,
  created_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

create index list_members_user_idx on public.list_members (user_id);

alter table public.list_members enable row level security;

create or replace function public.user_server_version(uid uuid)
returns bigint
language sql
stable
as $$
  with visible as (
    select id from public.lists where owner_id = uid
    union
    select list_id as id from public.list_members where user_id = uid
  )
  select coalesce(max(v), 0) from (
    select max(l.updated_at_ms) as v
      from public.lists l
      join visible vv on vv.id = l.id
    union all
    select max(i.updated_at_ms) as v
      from public.items i
      join visible vv on vv.id = i.list_id
  ) t;
$$;
