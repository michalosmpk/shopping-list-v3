-- =====================================================================
-- shopping-list-v3 — share lists with named users
--
-- Owners can grant other (non-guest) users edit access to their lists.
-- Each grant has its own per-member position so the recipient can
-- reorder shared lists within their own overview without disturbing
-- the owner's order.
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

-- ---------------------------------------------------------------------
-- Updated heartbeat: per-user max(updated_at_ms) now covers lists they
-- own *and* lists they're a member of (plus those lists' items).
-- ---------------------------------------------------------------------
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
