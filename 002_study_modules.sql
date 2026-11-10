-- Relational study data for Exam Command Center 2026.
-- Safe to apply after 001_init.sql; existing tasks, exams, and preferences are retained.

alter table exams add column if not exists exam_type text not null default 'regular'
  check (exam_type in ('backlog', 'regular'));
update exams set exam_type = 'backlog' where code in ('ESC-102-ELE', 'ESC-101-ETC', 'BSC-151-BES');

create table subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  exam_id uuid references exams on delete set null,
  name text not null,
  paper_code text,
  exam_type text not null default 'regular' check (exam_type in ('backlog', 'regular')),
  total_marks int not null default 60 check (total_marks > 0),
  target_marks int check (target_marks between 0 and total_marks),
  confidence int not null default 0 check (confidence between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name));

create table units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  subject_id uuid not null references subjects on delete cascade,
  title text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  subject_id uuid not null references subjects on delete cascade,
  unit_id uuid references units on delete set null,
  title text not null,
  priority text not null default 'medium' check (priority in ('must_study', 'high', 'medium', 'low')),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed', 'needs_revision')),
  estimated_minutes int not null default 30 check (estimated_minutes > 0),
  actual_minutes int not null default 0 check (actual_minutes >= 0),
  confidence int not null default 0 check (confidence between 0 and 100),
  revision_count int not null default 0 check (revision_count >= 0),
  notes text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index topics_user_subject_status_idx on topics(user_id, subject_id, status);

create table study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  subject_id uuid references subjects on delete set null,
  topic_id uuid references topics on delete set null,
  session_type text not null default 'study' check (session_type in ('study', 'break')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_minutes int not null check (duration_minutes > 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at > started_at));

create table revision_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  topic_id uuid not null references topics on delete cascade,
  due_at timestamptz not null,
  completed_at timestamptz,
  confidence int check (confidence between 0 and 100),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table pyq_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  subject_id uuid not null references subjects on delete cascade,
  topic_id uuid references topics on delete set null,
  unit_label text not null default '',
  question text not null,
  exam_year int,
  marks int check (marks > 0),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  solved boolean not null default false,
  accuracy int check (accuracy between 0 and 100),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table mock_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  subject_id uuid not null references subjects on delete cascade,
  test_date date not null default current_date,
  total_marks int not null default 60 check (total_marks > 0),
  marks_obtained int not null check (marks_obtained between 0 and total_marks),
  duration_minutes int check (duration_minutes > 0),
  weak_topics text[] not null default '{}',
  mistakes text not null default '',
  improvement_strategy text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table water_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  drank_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

alter table notification_prefs
  add column if not exists daily_target_minutes int not null default 600 check (daily_target_minutes between 30 and 1440),
  add column if not exists water_interval_minutes int not null default 60 check (water_interval_minutes between 15 and 240),
  add column if not exists motivation_interval_minutes int not null default 30 check (motivation_interval_minutes between 10 and 240),
  add column if not exists auto_start_break boolean not null default false,
  add column if not exists auto_start_study boolean not null default false,
  add column if not exists remember_session boolean not null default true;

insert into subjects(user_id, exam_id, name, paper_code, exam_type, total_marks)
select e.user_id, e.id, e.name, e.code, e.exam_type, e.marks
from exams e
on conflict (user_id, name) do nothing;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'name','Student'));
  insert into notification_prefs(user_id) values (new.id);
  insert into app_state(user_id) values (new.id);
  insert into exams(user_id, code, name, short, starts_at, time_label, exam_type) values
   (new.id,'ESC-102-ELE','Basic Electrical Engineering','BEE','2026-11-27 10:00+05:30','10 AM–12:30 PM','backlog'),
   (new.id,'ESC-101-ETC','Basic Electronics Engineering','BXE','2026-11-28 10:00+05:30','10 AM–12:30 PM','backlog'),
   (new.id,'BSC-151-BES','Engineering Mathematics-II','M2','2026-12-04 10:00+05:30','10 AM–12:30 PM','backlog'),
   (new.id,'PCC201MEC','Solid Mechanics','Solid Mechanics','2026-11-25 14:00+05:30','2–4:30 PM','regular'),
   (new.id,'PCC202MEC','Engineering Thermodynamics','Engineering Thermodynamics','2026-11-27 14:00+05:30','2–4:30 PM','regular'),
   (new.id,'PCC203MEC','Engineering Materials & Metallurgy','Materials & Metallurgy','2026-11-30 14:00+05:30','2–4:30 PM','regular'),
   (new.id,'MDM221MEC','Engineering Mathematics-III','M3','2026-12-02 14:00+05:30','2–4:30 PM','regular'),
   (new.id,'VEC233MEC','Universal Human Values','UHV','2026-12-04 14:00+05:30','2–4 PM','regular');
  insert into subjects(user_id, exam_id, name, paper_code, exam_type, total_marks)
    select e.user_id, e.id, e.name, e.code, e.exam_type, e.marks from exams e where e.user_id = new.id;
  return new;
end $$;

do $$ declare table_name text; begin
  foreach table_name in array array['subjects','units','topics','study_sessions','revision_records','pyq_records','mock_tests','water_log'] loop
    execute format('create trigger trg_touch_%I before update on %I for each row execute function touch_updated()', table_name, table_name);
    execute format('alter table %I enable row level security', table_name);
    execute format('create policy own_%I_all on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', table_name, table_name);
  end loop;
end $$;

alter publication supabase_realtime add table subjects, units, topics, study_sessions, revision_records, pyq_records, mock_tests, water_log;