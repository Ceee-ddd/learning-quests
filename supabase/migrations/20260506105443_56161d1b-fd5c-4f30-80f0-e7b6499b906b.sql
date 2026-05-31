
-- SESSIONS
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  join_code text unique not null,
  is_active boolean not null default true,
  allow_late_registration boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.sessions enable row level security;

create policy "Public can read sessions" on public.sessions for select using (true);
create policy "Teachers insert own sessions" on public.sessions for insert to authenticated with check (auth.uid() = teacher_id);
create policy "Teachers update own sessions" on public.sessions for update to authenticated using (auth.uid() = teacher_id);
create policy "Teachers delete own sessions" on public.sessions for delete to authenticated using (auth.uid() = teacher_id);

-- CHALLENGES
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  level integer not null check (level between 1 and 5),
  type text not null,
  story_text text,
  question_text text,
  options jsonb,
  correct_answer_code text,
  keywords jsonb,
  compartment_code text,
  reveal_message text,
  unique(session_id, level)
);
alter table public.challenges enable row level security;

create policy "Public can read challenges" on public.challenges for select using (true);
create policy "Teachers manage own challenges" on public.challenges for all to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and s.teacher_id = auth.uid()))
  with check (exists (select 1 from public.sessions s where s.id = session_id and s.teacher_id = auth.uid()));

-- GROUPS
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  group_name text not null,
  members jsonb not null default '[]'::jsonb,
  current_level integer not null default 1,
  start_time timestamptz,
  finish_time timestamptz,
  created_at timestamptz not null default now(),
  password text not null default ''::text
);
alter table public.groups enable row level security;

create policy "Public can read groups" on public.groups for select using (true);
create policy "Public can insert groups" on public.groups for insert with check (
  exists (select 1 from public.sessions s where s.id = session_id and s.is_active = true and s.allow_late_registration = true)
);
create policy "Public can update groups" on public.groups for update using (true);
create policy "Teachers delete groups" on public.groups for delete to authenticated using (
  exists (select 1 from public.sessions s where s.id = session_id and s.teacher_id = auth.uid())
);

-- SUBMISSIONS
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  challenge_level integer not null,
  submitted_answer text,
  is_correct boolean,
  submitted_at timestamptz not null default now()
);
alter table public.submissions enable row level security;

create policy "Public can read submissions" on public.submissions for select using (true);
create policy "Public can insert submissions" on public.submissions for insert with check (true);

-- Realtime
alter publication supabase_realtime add table public.groups;
alter publication supabase_realtime add table public.submissions;
alter publication supabase_realtime add table public.sessions;
