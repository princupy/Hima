-- Vote + Paid Premium schema
-- User: vote premium for personal prefix
-- Guild: vote/paid premium for musicard theme + 24/7 mode
-- Tokens: owner-generated redeem codes for paid guild premium

create table if not exists public.user_premium_profiles (
    user_id text primary key,
    vote_until timestamptz null,
    custom_prefix text null,
    last_vote_at timestamptz null,
    last_vote_source text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_user_premium_vote_until
    on public.user_premium_profiles (vote_until);

alter table public.user_premium_profiles
    drop constraint if exists user_premium_theme_chk;

alter table public.user_premium_profiles
    drop column if exists musicard_theme;

create table if not exists public.guild_vote_premium (
    guild_id text primary key,
    vote_until timestamptz null,
    musicard_theme text not null default 'ease',
    voter_user_id text null,
    premium_until timestamptz null,
    premium_is_permanent boolean not null default false,
    premium_by_user_id text null,
    premium_source text null,
    premium_token_id text null,
    keep_247_enabled boolean not null default false,
    keep_247_channel_id text null,
    keep_247_by_user_id text null,
    keep_247_updated_at timestamptz null,
    last_vote_at timestamptz null,
    last_vote_source text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.guild_vote_premium
    add column if not exists premium_until timestamptz null;

alter table public.guild_vote_premium
    add column if not exists premium_is_permanent boolean not null default false;

alter table public.guild_vote_premium
    add column if not exists premium_by_user_id text null;

alter table public.guild_vote_premium
    add column if not exists premium_source text null;

alter table public.guild_vote_premium
    add column if not exists premium_token_id text null;

alter table public.guild_vote_premium
    add column if not exists keep_247_enabled boolean not null default false;

alter table public.guild_vote_premium
    add column if not exists keep_247_channel_id text null;

alter table public.guild_vote_premium
    add column if not exists keep_247_by_user_id text null;

alter table public.guild_vote_premium
    add column if not exists keep_247_updated_at timestamptz null;
alter table public.guild_vote_premium
    add column if not exists autoplay_enabled boolean not null default false;

alter table public.guild_vote_premium
    add column if not exists autoplay_by_user_id text null;

alter table public.guild_vote_premium
    add column if not exists autoplay_updated_at timestamptz null;


create index if not exists idx_guild_vote_premium_until
    on public.guild_vote_premium (vote_until);

create index if not exists idx_guild_paid_premium_until
    on public.guild_vote_premium (premium_until);

alter table public.guild_vote_premium
    drop constraint if exists guild_vote_theme_chk;

alter table public.guild_vote_premium
    add constraint guild_vote_theme_chk
    check (musicard_theme in ('ease', 'glass', 'neon', 'sunset', 'ocean', 'mono'));

create table if not exists public.premium_tokens (
    token text primary key,
    duration_key text not null,
    duration_days integer null,
    is_permanent boolean not null default false,
    price_inr integer not null,
    created_by text not null,
    created_at timestamptz not null default now(),
    redeemed_at timestamptz null,
    redeemed_by_user_id text null,
    redeemed_guild_id text null
);

create index if not exists idx_premium_tokens_redeemed_at
    on public.premium_tokens (redeemed_at);

create table if not exists public.user_spotify_profiles (
    user_id text primary key,
    spotify_user_id text not null,
    profile_url text not null,
    display_name text null,
    avatar_url text null,
    connected_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.playlists (
    id text primary key,
    owner_user_id text not null,
    guild_id text null,
    scope text not null default 'user',
    name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint playlists_scope_chk check (scope in ('user', 'shared'))
);

create index if not exists idx_playlists_owner_scope
    on public.playlists (owner_user_id, scope, updated_at desc);

create index if not exists idx_playlists_guild_scope
    on public.playlists (guild_id, scope, updated_at desc);

create unique index if not exists uq_playlists_user_name
    on public.playlists (owner_user_id, scope, name)
    where scope = 'user';

create unique index if not exists uq_playlists_shared_name
    on public.playlists (guild_id, scope, name)
    where scope = 'shared';

create table if not exists public.playlist_tracks (
    id bigint generated by default as identity primary key,
    playlist_id text not null references public.playlists(id) on delete cascade,
    position integer not null,
    query text not null,
    title text null,
    uri text null,
    source text null,
    length_ms bigint null,
    created_at timestamptz not null default now()
);

create index if not exists idx_playlist_tracks_playlist
    on public.playlist_tracks (playlist_id, position);

create unique index if not exists uq_playlist_tracks_position
    on public.playlist_tracks (playlist_id, position);

create table if not exists public.playlist_settings (
    guild_id text not null,
    user_id text not null,
    autosync_enabled boolean not null default false,
    autosync_playlist_id text null references public.playlists(id) on delete set null,
    autoload_playlist_id text null references public.playlists(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (guild_id, user_id)
);

create index if not exists idx_playlist_settings_autosync
    on public.playlist_settings (guild_id, user_id, autosync_enabled);

create table if not exists public.user_favorites (
    id bigint generated by default as identity primary key,
    user_id text not null,
    track_key text not null,
    query text not null,
    title text null,
    uri text null,
    author text null,
    source text null,
    length_ms bigint null,
    created_at timestamptz not null default now()
);

create unique index if not exists uq_user_favorites_track
    on public.user_favorites (user_id, track_key);

create index if not exists idx_user_favorites_created
    on public.user_favorites (user_id, created_at desc);

create table if not exists public.afk_global (
    user_id text primary key,
    reason text not null default 'AFK',
    set_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.afk_guild (
    guild_id text not null,
    user_id text not null,
    reason text not null default 'AFK',
    set_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (guild_id, user_id)
);

create index if not exists idx_afk_guild_lookup
    on public.afk_guild (guild_id, updated_at desc);

create table if not exists public.afk_nicknames (
    guild_id text not null,
    user_id text not null,
    original_nick text null,
    updated_at timestamptz not null default now(),
    primary key (guild_id, user_id)
);

create index if not exists idx_afk_nicknames_user
    on public.afk_nicknames (user_id, updated_at desc);

alter table public.guilds
    add column if not exists music_channel_id text null;

alter table public.user_premium_profiles
    add column if not exists vote_expiry_notified_at timestamptz null;
