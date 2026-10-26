-- CUSP SHOWDOWN — live multiplayer schema
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It is idempotent: running it again is safe.
--
-- DESIGN
--
-- The server is the authority. Clients never report scores, buzz order, or
-- timestamps; they call functions, and the function decides. Specifically:
--
--   * Buzz order is decided by a primary key on (round_id, epoch) in
--     buzz_winners. The first transaction to commit wins; every later one
--     conflicts and is told it lost. Timestamps come from clock_timestamp(),
--     never from a client.
--   * Score changes are computed from rounds.points inside judge_round(), so a
--     tampered client cannot award itself anything.
--   * Host-only actions require the host token, which is only ever stored as a
--     SHA-256 hash in a table the anon role cannot read.
--   * The answer key is never in the database before the host reveals it. The
--     host's browser holds the content bundle and writes the answer payload
--     only in reveal_round(). The item id lives in a private table, so a player
--     cannot look the item up in the public bundle ahead of the reveal.
--
-- Every public table is readable by anon (Realtime needs that) and writable by
-- nobody: there are no insert/update/delete policies, so the only write path is
-- a `security definer` function in this file.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- public state

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'final', 'done')),
  allow_late_join boolean not null default true,
  -- Board skeleton for the player view: points and played flags only, no item ids.
  board jsonb not null default '{}'::jsonb,
  content_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '8 hours'
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null,
  score integer not null default 0,
  created_at timestamptz not null default now(),
  unique (room_id, name)
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  display_name text not null,
  score integer not null default 0,
  connected boolean not null default true,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (room_id, display_name)
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  seq integer not null,
  category_id text not null,
  category_name text not null,
  points integer not null check (points > 0),
  -- Shown to players: stem, options, vignette, tags. Never the key.
  question jsonb not null,
  -- Written only by reveal_round().
  answer jsonb,
  state text not null default 'open'
    check (state in ('open', 'buzzing', 'locked', 'revealed', 'retired')),
  buzz_open boolean not null default false,
  -- Bumped each time the host reopens buzzing, so a new race starts clean.
  buzz_epoch integer not null default 0,
  winner_player_id uuid references public.players (id) on delete set null,
  is_final boolean not null default false,
  opened_at timestamptz not null default now(),
  revealed_at timestamptz,
  unique (room_id, seq)
);

create table if not exists public.buzzes (
  id bigserial primary key,
  round_id uuid not null references public.rounds (id) on delete cascade,
  epoch integer not null,
  player_id uuid not null references public.players (id) on delete cascade,
  server_ts timestamptz not null default clock_timestamp(),
  unique (round_id, epoch, player_id)
);

-- One row per race. The primary key is what makes "first buzz wins" true.
create table if not exists public.buzz_winners (
  round_id uuid not null references public.rounds (id) on delete cascade,
  epoch integer not null,
  player_id uuid not null references public.players (id) on delete cascade,
  won_at timestamptz not null default clock_timestamp(),
  primary key (round_id, epoch)
);

create table if not exists public.wagers (
  round_id uuid not null references public.rounds (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  amount integer not null check (amount >= 0),
  locked boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  primary key (round_id, player_id)
);

-- --------------------------------------------------------------- private state
-- The anon role has no policy on these tables, so it cannot read them at all.

create table if not exists public.room_private (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  host_token_hash text not null
);

create table if not exists public.player_private (
  player_id uuid primary key references public.players (id) on delete cascade,
  player_token_hash text not null
);

create table if not exists public.round_private (
  round_id uuid primary key references public.rounds (id) on delete cascade,
  item_id text not null
);

create index if not exists rounds_room_idx on public.rounds (room_id, seq desc);
create index if not exists players_room_idx on public.players (room_id);
create index if not exists buzzes_rate_idx on public.buzzes (player_id, server_ts desc);
create index if not exists rooms_expiry_idx on public.rooms (expires_at);

-- ------------------------------------------------------------------------- RLS

alter table public.rooms enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.rounds enable row level security;
alter table public.buzzes enable row level security;
alter table public.buzz_winners enable row level security;
alter table public.wagers enable row level security;
alter table public.room_private enable row level security;
alter table public.player_private enable row level security;
alter table public.round_private enable row level security;

-- Read-only for everyone; an expired room disappears from every client.
drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select using (expires_at > now());

drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select using (
  exists (select 1 from public.rooms r where r.id = room_id and r.expires_at > now())
);

drop policy if exists players_read on public.players;
create policy players_read on public.players for select using (
  exists (select 1 from public.rooms r where r.id = room_id and r.expires_at > now())
);

drop policy if exists rounds_read on public.rounds;
create policy rounds_read on public.rounds for select using (
  exists (select 1 from public.rooms r where r.id = room_id and r.expires_at > now())
);

drop policy if exists buzzes_read on public.buzzes;
create policy buzzes_read on public.buzzes for select using (true);

drop policy if exists buzz_winners_read on public.buzz_winners;
create policy buzz_winners_read on public.buzz_winners for select using (true);

drop policy if exists wagers_read on public.wagers;
create policy wagers_read on public.wagers for select using (true);

-- No policies at all on the three *_private tables: anon cannot touch them.

-- -------------------------------------------------------------------- helpers

create or replace function public.hash_token(p_token text)
returns text
language sql
immutable
as $$
  select encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

/** Room codes avoid 0/O/1/I/L so they can be read off a projector. */
create or replace function public.new_room_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ACDEFGHJKMNPQRTUVWXY2346789';
  -- Named `candidate`, not `code`: an unqualified `code` would be ambiguous
  -- against rooms.code inside the query below.
  candidate text;
begin
  loop
    candidate := '';
    for i in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.rooms r where r.code = candidate and r.expires_at > now()
    );
  end loop;
  return candidate;
end;
$$;

create or replace function public.require_host(p_code text, p_host_token text)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms;
begin
  select r.* into room from public.rooms r where r.code = upper(p_code) and r.expires_at > now();
  if room.id is null then
    raise exception 'ROOM_NOT_FOUND' using hint = 'No open room has that code.';
  end if;
  if not exists (
    select 1 from public.room_private p
    where p.room_id = room.id and p.host_token_hash = public.hash_token(p_host_token)
  ) then
    raise exception 'NOT_HOST' using hint = 'Only the host of this room can do that.';
  end if;
  return room;
end;
$$;

create or replace function public.require_player(p_player_token text)
returns public.players
language plpgsql
security definer
set search_path = public
as $$
declare
  player public.players;
begin
  select pl.* into player
  from public.players pl
  join public.player_private pp on pp.player_id = pl.id
  join public.rooms r on r.id = pl.room_id
  where pp.player_token_hash = public.hash_token(p_player_token)
    and r.expires_at > now();
  if player.id is null then
    raise exception 'UNKNOWN_PLAYER' using hint = 'This device is not in an open room.';
  end if;
  return player;
end;
$$;

-- ------------------------------------------------------------------ host calls

create or replace function public.create_room(
  p_host_token text,
  p_board jsonb default '{}'::jsonb,
  p_allow_late_join boolean default true,
  p_content_version text default null,
  p_ttl_hours integer default 8
)
returns table (room_id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  new_code text := public.new_room_code();
  new_id uuid;
  new_expiry timestamptz;
  ttl integer := least(greatest(coalesce(p_ttl_hours, 8), 1), 24);
begin
  if length(coalesce(p_host_token, '')) < 16 then
    raise exception 'WEAK_TOKEN' using hint = 'The host token must be at least 16 characters.';
  end if;

  insert into public.rooms (code, board, allow_late_join, content_version, expires_at)
  values (new_code, coalesce(p_board, '{}'::jsonb), coalesce(p_allow_late_join, true),
          p_content_version, now() + make_interval(hours => ttl))
  returning id, rooms.expires_at into new_id, new_expiry;

  insert into public.room_private (room_id, host_token_hash)
  values (new_id, public.hash_token(p_host_token));

  return query select new_id, new_code, new_expiry;
end;
$$;

create or replace function public.create_team(p_code text, p_host_token text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
  team_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'EMPTY_NAME' using hint = 'A team needs a name.';
  end if;
  if (select count(*) from public.teams t where t.room_id = room.id) >= 12 then
    raise exception 'TOO_MANY_TEAMS' using hint = 'A room holds at most 12 teams.';
  end if;
  insert into public.teams (room_id, name)
  values (room.id, left(trim(p_name), 40))
  returning id into team_id;
  update public.rooms set updated_at = now() where id = room.id;
  return team_id;
end;
$$;

create or replace function public.assign_player_team(
  p_code text,
  p_host_token text,
  p_player_id uuid,
  p_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
begin
  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.id = p_team_id and t.room_id = room.id
  ) then
    raise exception 'TEAM_NOT_IN_ROOM';
  end if;
  update public.players
  set team_id = p_team_id
  where id = p_player_id and room_id = room.id;
end;
$$;

create or replace function public.set_room_status(p_code text, p_host_token text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
begin
  if p_status not in ('lobby', 'playing', 'final', 'done') then
    raise exception 'BAD_STATUS';
  end if;
  update public.rooms set status = p_status, updated_at = now() where id = room.id;
end;
$$;

create or replace function public.set_late_join(p_code text, p_host_token text, p_allow boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
begin
  update public.rooms set allow_late_join = coalesce(p_allow, true), updated_at = now()
  where id = room.id;
end;
$$;

create or replace function public.update_board(p_code text, p_host_token text, p_board jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
begin
  update public.rooms set board = coalesce(p_board, '{}'::jsonb), updated_at = now()
  where id = room.id;
end;
$$;

/**
 * Opens a question. The host passes the display payload (no key) and the item
 * id, which goes to the private table so players cannot resolve it early.
 */
create or replace function public.open_round(
  p_code text,
  p_host_token text,
  p_category_id text,
  p_category_name text,
  p_points integer,
  p_item_id text,
  p_question jsonb,
  p_is_final boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
  next_seq integer;
  new_round uuid;
begin
  if p_question ? 'key' or p_question ? 'answer' or p_question ? 'rationales' then
    raise exception 'KEY_IN_QUESTION'
      using hint = 'The question payload must not contain the answer key.';
  end if;
  if exists (
    select 1 from public.round_private rp
    join public.rounds r on r.id = rp.round_id
    where r.room_id = room.id and rp.item_id = p_item_id
  ) then
    raise exception 'ITEM_ALREADY_USED' using hint = 'That question has already been played in this room.';
  end if;

  select coalesce(max(r.seq), 0) + 1 into next_seq from public.rounds r where r.room_id = room.id;

  insert into public.rounds (
    room_id, seq, category_id, category_name, points, question, state, buzz_open, is_final
  )
  values (
    room.id, next_seq, p_category_id, left(p_category_name, 120), p_points, p_question,
    'open', false, coalesce(p_is_final, false)
  )
  returning id into new_round;

  insert into public.round_private (round_id, item_id) values (new_round, p_item_id);
  update public.rooms set updated_at = now() where id = room.id;
  return new_round;
end;
$$;

/** Opening buzzing starts a new race; closing it freezes the current one. */
create or replace function public.set_buzzing(
  p_code text,
  p_host_token text,
  p_round_id uuid,
  p_open boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
  current_epoch integer;
begin
  select r.buzz_epoch into current_epoch
  from public.rounds r where r.id = p_round_id and r.room_id = room.id;
  if current_epoch is null then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  if p_open then
    -- A fresh epoch, so earlier buzzes cannot win the new race.
    current_epoch := current_epoch + 1;
    update public.rounds
    set buzz_open = true, buzz_epoch = current_epoch, state = 'buzzing', winner_player_id = null
    where id = p_round_id;
  else
    update public.rounds
    set buzz_open = false, state = case when state = 'buzzing' then 'locked' else state end
    where id = p_round_id;
  end if;

  update public.rooms set updated_at = now() where id = room.id;
  return current_epoch;
end;
$$;

/**
 * Scores the current buzz winner. The delta comes from rounds.points, so the
 * host client cannot inflate it. A wrong answer may reopen buzzing.
 */
create or replace function public.judge_round(
  p_code text,
  p_host_token text,
  p_round_id uuid,
  p_correct boolean,
  p_penalize_incorrect boolean default true,
  p_reopen_on_incorrect boolean default true
)
returns table (delta integer, scored_player uuid, reopened_epoch integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  room public.rooms := public.require_host(p_code, p_host_token);
  round_row public.rounds;
  winner uuid;
  change integer := 0;
  new_epoch integer := null;
begin
  select r.* into round_row from public.rounds r where r.id = p_round_id and r.room_id = room.id;
  if round_row.id is null then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  select bw.player_id into winner
  from public.buzz_winners bw
  where bw.round_id = round_row.id and bw.epoch = round_row.buzz_epoch;

  if winner is null then
    raise exception 'NO_BUZZ_WINNER' using hint = 'Nobody has buzzed in on this question yet.';
  end if;

  change := case
    when p_correct then round_row.points
    when coalesce(p_penalize_incorrect, true) then -round_row.points
    else 0
  end;

  update public.players set score = score + change where id = winner;
  update public.teams t
  set score = t.score + change
  where t.id = (select pl.team_id from public.players pl where pl.id = winner);

  if p_correct then
    update public.rounds
    set state = 'locked', buzz_open = false, winner_player_id = winner
    where id = round_row.id;
  elsif coalesce(p_reopen_on_incorrect, true) then
    new_epoch := round_row.buzz_epoch + 1;
    update public.rounds
    set state = 'buzzing', buzz_open = true, buzz_epoch = new_epoch, winner_player_id = null
    where id = round_row.id;
  else
    update public.rounds
    set state = 'locked', buzz_open = false, winner_player_id = winner
    where id = round_row.id;
  end if;

  update public.rooms set updated_at = now() where id = room.id;
  return query select change, winner, new_epoch;
end;
$$;

/** The only place an answer key enters the database. */
create or replace function public.reveal_round(
  p_code text,
  p_host_token text,
  p_round_id uuid,
  p_answer jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
begin
  update public.rounds
  set answer = p_answer, state = 'revealed', buzz_open = false, revealed_at = now()
  where id = p_round_id and room_id = room.id;
  if not found then
    raise exception 'ROUND_NOT_FOUND';
  end if;
  update public.rooms set updated_at = now() where id = room.id;
end;
$$;

/** Retires a questionable item without scoring it. */
create or replace function public.retire_round(p_code text, p_host_token text, p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
begin
  update public.rounds
  set state = 'retired', buzz_open = false
  where id = p_round_id and room_id = room.id;
end;
$$;

/** Manual correction, for when the room disagrees with the grading. */
create or replace function public.adjust_score(
  p_code text,
  p_host_token text,
  p_player_id uuid,
  p_team_id uuid,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
begin
  if abs(coalesce(p_delta, 0)) > 100000 then
    raise exception 'DELTA_TOO_LARGE';
  end if;
  if p_player_id is not null then
    update public.players set score = score + p_delta where id = p_player_id and room_id = room.id;
  end if;
  if p_team_id is not null then
    update public.teams set score = score + p_delta where id = p_team_id and room_id = room.id;
  end if;
  update public.rooms set updated_at = now() where id = room.id;
end;
$$;

create or replace function public.kick_player(p_code text, p_host_token text, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
begin
  delete from public.players where id = p_player_id and room_id = room.id;
end;
$$;

create or replace function public.close_room(p_code text, p_host_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
begin
  update public.rooms set status = 'done', expires_at = now() + interval '30 minutes'
  where id = room.id;
end;
$$;

-- ---------------------------------------------------------------- player calls

create or replace function public.join_room(
  p_code text,
  p_display_name text,
  p_player_token text
)
returns table (player_id uuid, room_id uuid, status text, team_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  room public.rooms;
  clean_name text := left(trim(coalesce(p_display_name, '')), 24);
  new_player uuid;
begin
  if length(clean_name) = 0 then
    raise exception 'EMPTY_NAME' using hint = 'Enter a display name.';
  end if;
  if length(coalesce(p_player_token, '')) < 16 then
    raise exception 'WEAK_TOKEN';
  end if;

  select r.* into room from public.rooms r where r.code = upper(p_code) and r.expires_at > now();
  if room.id is null then
    raise exception 'ROOM_NOT_FOUND' using hint = 'Check the code with your host.';
  end if;
  if room.status = 'done' then
    raise exception 'ROOM_CLOSED' using hint = 'This game has finished.';
  end if;
  if room.status <> 'lobby' and not room.allow_late_join then
    raise exception 'LATE_JOIN_CLOSED' using hint = 'The host has closed late joining.';
  end if;
  if (select count(*) from public.players pl where pl.room_id = room.id) >= 60 then
    raise exception 'ROOM_FULL' using hint = 'This room already has 60 players.';
  end if;

  -- Reconnecting with the same token keeps the same identity and score.
  select pl.id into new_player
  from public.players pl
  join public.player_private pp on pp.player_id = pl.id
  where pl.room_id = room.id and pp.player_token_hash = public.hash_token(p_player_token);

  if new_player is not null then
    update public.players
    set connected = true, last_seen = now(), display_name = clean_name
    where id = new_player;
  else
    if exists (
      select 1 from public.players pl where pl.room_id = room.id and pl.display_name = clean_name
    ) then
      raise exception 'NAME_TAKEN' using hint = 'Someone in this room already uses that name.';
    end if;
    insert into public.players (room_id, display_name) values (room.id, clean_name)
    returning id into new_player;
    insert into public.player_private (player_id, player_token_hash)
    values (new_player, public.hash_token(p_player_token));
  end if;

  return query
    select new_player, room.id, room.status,
           (select pl.team_id from public.players pl where pl.id = new_player);
end;
$$;

/**
 * Claims a buzz. Returns whether this player won the race. Ordering is decided
 * by the primary key on buzz_winners, not by any client clock.
 */
create or replace function public.claim_buzz(p_player_token text, p_round_id uuid)
returns table (won boolean, winner_player_id uuid, epoch integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  player public.players := public.require_player(p_player_token);
  round_row public.rounds;
  recent integer;
  current_winner uuid;
begin
  select r.* into round_row
  from public.rounds r
  where r.id = p_round_id and r.room_id = player.room_id;
  if round_row.id is null then
    raise exception 'ROUND_NOT_FOUND';
  end if;
  if not round_row.buzz_open then
    raise exception 'BUZZ_CLOSED' using hint = 'Buzzing is not open on this question.';
  end if;

  -- Anti-spam: a handful of attempts per player in a short window.
  select count(*) into recent
  from public.buzzes b
  where b.player_id = player.id and b.server_ts > clock_timestamp() - interval '5 seconds';
  if recent >= 6 then
    raise exception 'RATE_LIMITED' using hint = 'Too many buzz attempts. Wait a moment.';
  end if;

  insert into public.buzzes (round_id, epoch, player_id)
  values (round_row.id, round_row.buzz_epoch, player.id)
  on conflict (round_id, epoch, player_id) do nothing;

  insert into public.buzz_winners (round_id, epoch, player_id)
  values (round_row.id, round_row.buzz_epoch, player.id)
  on conflict (round_id, epoch) do nothing;

  select bw.player_id into current_winner
  from public.buzz_winners bw
  where bw.round_id = round_row.id and bw.epoch = round_row.buzz_epoch;

  if current_winner = player.id then
    update public.rounds set winner_player_id = player.id where id = round_row.id;
  end if;

  update public.players set last_seen = now(), connected = true where id = player.id;

  return query select current_winner = player.id, current_winner, round_row.buzz_epoch;
end;
$$;

create or replace function public.set_wager(p_player_token text, p_round_id uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  player public.players := public.require_player(p_player_token);
  ceiling integer;
  amount integer;
begin
  if exists (
    select 1 from public.wagers w
    where w.round_id = p_round_id and w.player_id = player.id and w.locked
  ) then
    raise exception 'WAGER_LOCKED' using hint = 'Your wager is already locked in.';
  end if;

  ceiling := greatest(player.score, 1000);
  amount := least(greatest(coalesce(p_amount, 0), 0), ceiling);

  insert into public.wagers (round_id, player_id, amount, locked)
  values (p_round_id, player.id, amount, false)
  on conflict (round_id, player_id) do update set amount = excluded.amount;

  return amount;
end;
$$;

create or replace function public.lock_wager(p_player_token text, p_round_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  player public.players := public.require_player(p_player_token);
  amount integer;
begin
  update public.wagers set locked = true
  where round_id = p_round_id and player_id = player.id
  returning wagers.amount into amount;
  if amount is null then
    raise exception 'NO_WAGER' using hint = 'Set a wager first.';
  end if;
  return amount;
end;
$$;

/** Settles the final for every locked wager, from the host's verdict list. */
create or replace function public.settle_final(
  p_code text,
  p_host_token text,
  p_round_id uuid,
  p_correct_player_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.rooms := public.require_host(p_code, p_host_token);
  settled integer := 0;
  w record;
  change integer;
begin
  if not exists (select 1 from public.rounds r where r.id = p_round_id and r.room_id = room.id) then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  for w in
    select wa.player_id, wa.amount
    from public.wagers wa
    join public.players pl on pl.id = wa.player_id
    where wa.round_id = p_round_id and wa.locked and pl.room_id = room.id
  loop
    change := case when w.player_id = any (coalesce(p_correct_player_ids, '{}'::uuid[]))
                   then w.amount else -w.amount end;
    update public.players set score = score + change where id = w.player_id;
    update public.teams t
    set score = t.score + change
    where t.id = (select pl.team_id from public.players pl where pl.id = w.player_id);
    settled := settled + 1;
  end loop;

  update public.rounds set state = 'revealed', revealed_at = now() where id = p_round_id;
  update public.rooms set status = 'done', updated_at = now() where id = room.id;
  return settled;
end;
$$;

create or replace function public.heartbeat(p_player_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  player public.players := public.require_player(p_player_token);
begin
  update public.players set last_seen = now(), connected = true where id = player.id;
end;
$$;

-- ------------------------------------------------------------------- cleanup

/**
 * Deletes expired rooms. Cascades take the teams, players, rounds and buzzes
 * with them, so a free-tier database does not fill up with finished games.
 * Schedule it with pg_cron, or call it from the host client on room creation.
 */
create or replace function public.cleanup_expired_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  with gone as (
    delete from public.rooms where expires_at < now() returning 1
  )
  select count(*) into removed from gone;
  return removed;
end;
$$;

-- ----------------------------------------------------------------- privileges

revoke all on all tables in schema public from anon, authenticated;

grant select on public.rooms, public.teams, public.players, public.rounds,
               public.buzzes, public.buzz_winners, public.wagers
  to anon, authenticated;

revoke all on function public.require_host(text, text) from anon, authenticated;
revoke all on function public.require_player(text) from anon, authenticated;

grant execute on function
  public.create_room(text, jsonb, boolean, text, integer),
  public.create_team(text, text, text),
  public.assign_player_team(text, text, uuid, uuid),
  public.set_room_status(text, text, text),
  public.set_late_join(text, text, boolean),
  public.update_board(text, text, jsonb),
  public.open_round(text, text, text, text, integer, text, jsonb, boolean),
  public.set_buzzing(text, text, uuid, boolean),
  public.judge_round(text, text, uuid, boolean, boolean, boolean),
  public.reveal_round(text, text, uuid, jsonb),
  public.retire_round(text, text, uuid),
  public.adjust_score(text, text, uuid, uuid, integer),
  public.kick_player(text, text, uuid),
  public.close_room(text, text),
  public.join_room(text, text, text),
  public.claim_buzz(text, uuid),
  public.set_wager(text, uuid, integer),
  public.lock_wager(text, uuid),
  public.settle_final(text, text, uuid, uuid[]),
  public.heartbeat(text),
  public.cleanup_expired_rooms()
  to anon, authenticated;

-- Realtime: clients subscribe to these tables for live state.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rooms;
    alter publication supabase_realtime add table public.rounds;
    alter publication supabase_realtime add table public.players;
    alter publication supabase_realtime add table public.teams;
    alter publication supabase_realtime add table public.buzz_winners;
    alter publication supabase_realtime add table public.wagers;
  end if;
exception
  when duplicate_object then null;
end;
$$;
