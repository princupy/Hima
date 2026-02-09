-- Hima Supabase schema (PostgreSQL)

create table if not exists public.guilds (
    id text primary key,
    prefix text not null default 'H!',
    created_at timestamptz not null default now()
);

create table if not exists public.no_prefix_users (
    user_id text primary key,
    is_active boolean not null default true,
    expires_at timestamptz null,
    added_by text not null,
    added_guild_id text not null,
    added_channel_id text not null,
    removed_by text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_no_prefix_users_active
    on public.no_prefix_users (is_active);

create index if not exists idx_no_prefix_users_expires
    on public.no_prefix_users (expires_at)
    where is_active = true and expires_at is not null;

-- normalize old default prefix rows, if any
update public.guilds
set prefix = 'H!'
where prefix is null or prefix = '!';

alter table public.guilds
    add column if not exists music_channel_id text null;
