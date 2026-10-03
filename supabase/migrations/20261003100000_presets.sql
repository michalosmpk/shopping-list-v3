-- =====================================================================
-- shopping-list-v3 — named presets
--
-- A preset is a reusable bag of item name/quantity pairs owned by one
-- user. Other registered users can be invited by name (preset_members)
-- and then apply the preset onto their own lists. Guests never see
-- these tables; the BFF rejects non-user sessions on /api/presets.
-- =====================================================================

create table public.presets (
  id         uuid        primary key,
  owner_id   uuid        not null references auth.users(id) on delete cascade,
  name       text        not null,
  created_at timestamptz not null default now()
);

create index presets_owner_idx on public.presets (owner_id);

create table public.preset_items (
  id        uuid    primary key,
  preset_id uuid    not null references public.presets(id) on delete cascade,
  name      text    not null,
  quantity  text    not null default '',
  position  integer not null default 0
);

create index preset_items_preset_idx on public.preset_items (preset_id, position);

create table public.preset_members (
  preset_id  uuid        not null references public.presets(id) on delete cascade,
  user_id    uuid        not null references auth.users(id)     on delete cascade,
  created_at timestamptz not null default now(),
  primary key (preset_id, user_id)
);

create index preset_members_user_idx on public.preset_members (user_id);

alter table public.presets        enable row level security;
alter table public.preset_items   enable row level security;
alter table public.preset_members enable row level security;
