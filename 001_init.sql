-- Exam Command Center: cloud schema. Run in Supabase SQL editor or `supabase db push`.
create extension if not exists pgcrypto;

create or replace function touch_updated() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text, must_change_password boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- Whole app state (topics, timer history, PYQs, mocks, revisions, water log, settings) as one document.
-- Lets the existing app sync without losing features. Split into tables later if needed.
create table app_state (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data)='object'),
  version bigint not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- Relational because the notification engine queries it server-side.
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null check (length(title) between 1 and 200),
  subject text, task_date date not null,
  start_time time not null, end_time time not null check (end_time > start_time),
  done boolean not null default false, done_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index on tasks (user_id, task_date);

create table exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  code text not null, name text not null, short text not null,
  starts_at timestamptz not null, time_label text not null, marks int not null default 60,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table notification_prefs (
  user_id uuid primary key references auth.users on delete cascade,
  task_done boolean not null default true, pending boolean not null default true,
  exam boolean not null default true, daily_summary boolean not null default true,
  motivation boolean not null default true, water boolean not null default false,
  session_done boolean not null default true,
  summary_time time not null default '21:00', motivation_time time not null default '08:00',
  lead_minutes int not null default 30 check (lead_minutes between 1 and 240),
  followup_minutes int not null default 60 check (followup_minutes between 10 and 600),
  exam_days int[] not null default '{7,3,1,0}', water_minutes int not null default 60,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique, p256dh text not null, auth text not null, user_agent text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  type text not null, subject text, task_id uuid,
  dedupe_key text not null, scheduled_for timestamptz not null default now(),
  status text not null default 'pending', error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key));   -- duplicate prevention

do $$ declare t text; begin
  foreach t in array array['profiles','app_state','tasks','exams','notification_prefs','push_subscriptions','notification_log'] loop
    execute format('create trigger trg_touch before update on %I for each row execute function touch_updated()', t);
    execute format('alter table %I enable row level security', t);
  end loop; end $$;

-- RLS: each user sees only their own rows. The service role (Edge Function only) bypasses RLS.
create policy own_profile_sel on profiles for select using (auth.uid() = id);
create policy own_profile_upd on profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy own_state_all on app_state for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_tasks_all on tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_exams_all on exams for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_prefs_all on notification_prefs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_subs_all on push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_log_sel on notification_log for select using (auth.uid() = user_id);  -- read-only for the client

-- On every new auth user: create profile, prefs, empty state and the 8 fixed exams.
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'name','Student'));
  insert into notification_prefs(user_id) values (new.id);
  insert into app_state(user_id) values (new.id);
  insert into exams(user_id, code, name, short, starts_at, time_label) values
   (new.id,'ESC-102-ELE','Basic Electrical Engineering','BEE','2026-11-27 10:00+05:30','10 AM–12:30 PM'),
   (new.id,'ESC-101-ETC','Basic Electronics Engineering','BXE','2026-11-28 10:00+05:30','10 AM–12:30 PM'),
   (new.id,'BSC-151-BES','Engineering Mathematics-II','M2','2026-12-04 10:00+05:30','10 AM–12:30 PM'),
   (new.id,'PCC201MEC','Solid Mechanics','Solid Mechanics','2026-11-25 14:00+05:30','2–4:30 PM'),
   (new.id,'PCC202MEC','Engineering Thermodynamics','Engineering Thermodynamics','2026-11-27 14:00+05:30','2–4:30 PM'),
   (new.id,'PCC203MEC','Engineering Materials & Metallurgy','Materials & Metallurgy','2026-11-30 14:00+05:30','2–4:30 PM'),
   (new.id,'MDM221MEC','Engineering Mathematics-III','M3','2026-12-02 14:00+05:30','2–4:30 PM'),
   (new.id,'VEC233MEC','Universal Human Values','UHV','2026-12-04 14:00+05:30','2–4 PM');
  return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

alter publication supabase_realtime add table app_state, tasks, notification_prefs;
