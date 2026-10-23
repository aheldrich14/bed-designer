-- Native Bed Planner tables for a shared Supabase project.
-- Every object is prefixed "bed_planner_" so it can't collide with other apps.
-- If you set SUPABASE_TABLE_PREFIX to something else, find-and-replace the prefix here.
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to re-run.

create table if not exists public.bed_planner_projects (
  id text primary key,
  name text not null,
  aerial_url text,
  aerial_size jsonb,
  calibration jsonb,
  features jsonb not null default '[]',
  user_id text,
  created_at text not null
);

create table if not exists public.bed_planner_beds (
  id text primary key,
  project_id text not null references public.bed_planner_projects(id) on delete cascade,
  name text not null,
  origin jsonb not null,
  outline jsonb not null,
  zones jsonb not null,
  conditions jsonb not null,
  existing jsonb not null,
  photos jsonb not null,
  created_at text not null
);
create index if not exists bed_planner_beds_project on public.bed_planner_beds(project_id);

create table if not exists public.bed_planner_plan_versions (
  id text primary key,
  bed_id text not null references public.bed_planner_beds(id) on delete cascade,
  parent_id text,
  drifts jsonb not null,
  zone_notes jsonb not null,
  author text not null,
  rationale text not null,
  created_at text not null,
  seq integer not null,
  unique (bed_id, seq)
);

create table if not exists public.bed_planner_suggestions (
  id text primary key,
  plan_version_id text not null references public.bed_planner_plan_versions(id) on delete cascade,
  issue text not null,
  detail text not null,
  source text not null,
  severity text not null,
  drift_ids jsonb not null,
  anchor jsonb,
  ops jsonb not null,
  status text not null,
  created_at text not null
);
create index if not exists bed_planner_suggestions_version on public.bed_planner_suggestions(plan_version_id);

create table if not exists public.bed_planner_renders (
  id text primary key,
  plan_version_id text not null references public.bed_planner_plan_versions(id) on delete cascade,
  month integer not null,
  viewpoint text not null,
  prompt text not null,
  image_url text,
  error text,
  created_at text not null
);
create index if not exists bed_planner_renders_version on public.bed_planner_renders(plan_version_id);

create table if not exists public.bed_planner_agent_sessions (
  bed_id text primary key references public.bed_planner_beds(id) on delete cascade,
  messages jsonb not null,
  checklist jsonb not null,
  updated_at text not null
);

-- Version list without the full drift snapshots.
create or replace view public.bed_planner_plan_versions_list
with (security_invoker = true) as
select id, bed_id, parent_id, author, rationale, created_at, seq, jsonb_array_length(drifts) as drift_count
from public.bed_planner_plan_versions;

-- The app talks to these tables only from the server with the secret (service
-- role) key, which bypasses RLS. Enabling RLS with no policies keeps the
-- public anon/publishable key from reading or writing them.
alter table public.bed_planner_projects enable row level security;
alter table public.bed_planner_beds enable row level security;
alter table public.bed_planner_plan_versions enable row level security;
alter table public.bed_planner_suggestions enable row level security;
alter table public.bed_planner_renders enable row level security;
alter table public.bed_planner_agent_sessions enable row level security;

-- Private storage bucket for aerials, photos and renders (the app also creates it on first upload).
insert into storage.buckets (id, name, public)
values ('bed-planner', 'bed-planner', false)
on conflict (id) do nothing;
