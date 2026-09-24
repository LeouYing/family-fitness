-- =====================================================================
-- Family Fitness: database setup
-- Paste this whole file into Supabase > SQL Editor > New query, then Run.
-- It is safe to run again later (it won't delete any data).
--
-- How access works: there are no passwords. Each family has a random
-- code (like K7PM-Q2XD). The website can't read the tables directly;
-- it can only call the functions below, and every function needs a
-- valid family code. So people only ever see their own family's data.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tables ----------

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  code        text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  color       text not null default '#3B6FD8' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at  timestamptz not null default now()
);

create table if not exists public.exercises (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null references public.families(id) on delete cascade,
  member_id         uuid not null references public.members(id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 60),
  unit_type         text not null check (unit_type in ('reps','weight','duration','distance','custom')),
  unit_label        text not null default '' check (char_length(unit_label) <= 20),
  higher_is_better  boolean not null default true,
  archived          boolean not null default false,
  created_at        timestamptz not null default now()
);

create table if not exists public.entries (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete cascade,
  member_id    uuid not null references public.members(id) on delete cascade,
  exercise_id  uuid not null references public.exercises(id) on delete cascade,
  value        numeric not null check (value >= 0),
  entry_date   date not null default current_date,
  note         text check (note is null or char_length(note) <= 200),
  created_at   timestamptz not null default now()
);

create index if not exists members_family_idx   on public.members(family_id);
create index if not exists exercises_family_idx on public.exercises(family_id);
create index if not exists entries_family_idx   on public.entries(family_id);

-- Lock the tables: no direct reading or writing from the website.
alter table public.families  enable row level security;
alter table public.members   enable row level security;
alter table public.exercises enable row level security;
alter table public.entries   enable row level security;
revoke all on table public.families, public.members, public.exercises, public.entries from anon, authenticated;

-- ---------- Internal helper (not callable from the website) ----------

create or replace function public._family_id(p_code text)
returns uuid
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  cleaned text;
  fid uuid;
begin
  -- Accept "k7pm q2xd", "K7PMQ2XD" or "K7PM-Q2XD"
  cleaned := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if char_length(cleaned) <> 8 then
    raise exception 'FAMILY_NOT_FOUND';
  end if;
  cleaned := substr(cleaned, 1, 4) || '-' || substr(cleaned, 5, 4);
  select id into fid from families where code = cleaned;
  if fid is null then
    raise exception 'FAMILY_NOT_FOUND';
  end if;
  return fid;
end $$;

revoke execute on function public._family_id(text) from public, anon, authenticated;

-- ---------- Functions the website calls ----------

-- Create a new family and return its code.
create or replace function public.create_family(p_name text)
returns json
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 chars, no I/O/0/1
  bytes bytea;
  new_code text;
  fid uuid;
  i int;
begin
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'NAME_REQUIRED';
  end if;
  loop
    bytes := gen_random_bytes(8);
    new_code := '';
    for i in 0..7 loop
      new_code := new_code || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
      if i = 3 then new_code := new_code || '-'; end if;
    end loop;
    exit when not exists (select 1 from families where code = new_code);
  end loop;
  insert into families(name, code) values (left(trim(p_name), 60), new_code) returning id into fid;
  return json_build_object('id', fid, 'name', left(trim(p_name), 60), 'code', new_code);
end $$;

-- Everything for one family in a single call.
create or replace function public.get_family(p_code text)
returns json
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  fid uuid := public._family_id(p_code);
begin
  return json_build_object(
    'family', (select json_build_object('id', f.id, 'name', f.name, 'code', f.code)
               from families f where f.id = fid),
    'members', coalesce((
      select json_agg(json_build_object('id', m.id, 'name', m.name, 'color', m.color) order by m.created_at)
      from members m where m.family_id = fid), '[]'::json),
    'exercises', coalesce((
      select json_agg(json_build_object(
        'id', e.id, 'member_id', e.member_id, 'name', e.name, 'unit_type', e.unit_type,
        'unit_label', e.unit_label, 'higher_is_better', e.higher_is_better, 'archived', e.archived
      ) order by e.created_at)
      from exercises e where e.family_id = fid), '[]'::json),
    'entries', coalesce((
      select json_agg(json_build_object(
        'id', x.id, 'member_id', x.member_id, 'exercise_id', x.exercise_id,
        'value', x.value, 'date', x.entry_date, 'note', x.note
      ) order by x.entry_date, x.created_at)
      from entries x where x.family_id = fid), '[]'::json)
  );
end $$;

create or replace function public.add_member(p_code text, p_name text, p_color text)
returns json
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  fid uuid := public._family_id(p_code);
  mid uuid;
begin
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'NAME_REQUIRED';
  end if;
  if (select count(*) from members where family_id = fid) >= 30 then
    raise exception 'TOO_MANY_MEMBERS';
  end if;
  insert into members(family_id, name, color)
  values (fid, left(trim(p_name), 40), coalesce(p_color, '#3B6FD8'))
  returning id into mid;
  return json_build_object('id', mid);
end $$;

create or replace function public.update_member(p_code text, p_member_id uuid, p_name text, p_color text)
returns void
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  fid uuid := public._family_id(p_code);
begin
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'NAME_REQUIRED';
  end if;
  update members set name = left(trim(p_name), 40), color = p_color
  where id = p_member_id and family_id = fid;
  if not found then raise exception 'NOT_IN_FAMILY'; end if;
end $$;

create or replace function public.add_exercise(
  p_code text, p_member_id uuid, p_name text, p_unit_type text,
  p_unit_label text, p_higher_is_better boolean)
returns json
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  fid uuid := public._family_id(p_code);
  eid uuid;
begin
  if not exists (select 1 from members where id = p_member_id and family_id = fid) then
    raise exception 'NOT_IN_FAMILY';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'NAME_REQUIRED';
  end if;
  insert into exercises(family_id, member_id, name, unit_type, unit_label, higher_is_better)
  values (fid, p_member_id, left(trim(p_name), 60), p_unit_type,
          left(trim(coalesce(p_unit_label, '')), 20), coalesce(p_higher_is_better, true))
  returning id into eid;
  return json_build_object('id', eid);
end $$;

create or replace function public.update_exercise(
  p_code text, p_exercise_id uuid, p_name text, p_unit_label text,
  p_higher_is_better boolean, p_archived boolean)
returns void
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  fid uuid := public._family_id(p_code);
begin
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'NAME_REQUIRED';
  end if;
  update exercises
  set name = left(trim(p_name), 60),
      unit_label = left(trim(coalesce(p_unit_label, '')), 20),
      higher_is_better = coalesce(p_higher_is_better, higher_is_better),
      archived = coalesce(p_archived, archived)
  where id = p_exercise_id and family_id = fid;
  if not found then raise exception 'NOT_IN_FAMILY'; end if;
end $$;

create or replace function public.add_entry(
  p_code text, p_member_id uuid, p_exercise_id uuid,
  p_value numeric, p_date date, p_note text)
returns json
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  fid uuid := public._family_id(p_code);
  xid uuid;
begin
  if not exists (select 1 from exercises
                 where id = p_exercise_id and member_id = p_member_id and family_id = fid) then
    raise exception 'NOT_IN_FAMILY';
  end if;
  if p_value is null or p_value < 0 then
    raise exception 'BAD_VALUE';
  end if;
  insert into entries(family_id, member_id, exercise_id, value, entry_date, note)
  values (fid, p_member_id, p_exercise_id, p_value, coalesce(p_date, current_date),
          nullif(left(trim(coalesce(p_note, '')), 200), ''))
  returning id into xid;
  return json_build_object('id', xid);
end $$;

create or replace function public.delete_entry(p_code text, p_entry_id uuid)
returns void
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  fid uuid := public._family_id(p_code);
begin
  delete from entries where id = p_entry_id and family_id = fid;
  if not found then raise exception 'NOT_IN_FAMILY'; end if;
end $$;

-- Let the website call only these functions.
grant execute on function public.create_family(text)                                   to anon, authenticated;
grant execute on function public.get_family(text)                                      to anon, authenticated;
grant execute on function public.add_member(text, text, text)                          to anon, authenticated;
grant execute on function public.update_member(text, uuid, text, text)                 to anon, authenticated;
grant execute on function public.add_exercise(text, uuid, text, text, text, boolean)   to anon, authenticated;
grant execute on function public.update_exercise(text, uuid, text, text, boolean, boolean) to anon, authenticated;
grant execute on function public.add_entry(text, uuid, uuid, numeric, date, text)      to anon, authenticated;
grant execute on function public.delete_entry(text, uuid)                              to anon, authenticated;
