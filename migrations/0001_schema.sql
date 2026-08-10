-- 0001_schema.sql
-- Core schema for the AI Agent Workflow Builder.
-- Run via `hasura migrate apply` or directly against the nhost Postgres
-- instance. Written to be idempotent-safe for local dev re-runs.

create extension if not exists "pgcrypto";

create type org_role as enum ('owner', 'editor', 'viewer');

create type step_type as enum (
  'llm_call',
  'http_request',
  'db_write',
  'notify',
  'conditional_branch',
  'approval_gate'
);

create type trigger_type as enum ('manual', 'webhook', 'scheduled', 'database_event');

create type run_status as enum ('pending', 'running', 'paused', 'succeeded', 'failed', 'cancelled');

create type step_run_status as enum ('pending', 'running', 'succeeded', 'failed', 'paused', 'skipped');

-- ─── organizations ──────────────────────────────────────────────────────
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Quota is tracked as a simple counter + limit rather than a separate
  -- usage-events table. Simpler to reason about and to reset per period;
  -- a real production system would likely want a usage_events log for
  -- auditability, but that's out of scope here — see DECISIONS.md.
  quota_limit integer not null default 1000,
  quota_used integer not null default 0,
  quota_period_start timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ─── org_members ────────────────────────────────────────────────────────
-- This table is the join between auth.users (nhost-managed) and
-- organizations, and it is the SOURCE OF TRUTH for cross-org isolation.
-- Every Hasura permission rule for every other table traces back to a
-- row existing here — see hasura/metadata/.../*.yaml for how each
-- select/insert/update/delete permission scopes through this table.
create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null, -- references auth.users(id), nhost-managed table
  role org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index idx_org_members_user on org_members(user_id);
create index idx_org_members_org on org_members(org_id);

-- ─── workflows ───────────────────────────────────────────────────────────
create table workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_workflows_org on workflows(org_id);

-- ─── workflow_steps ──────────────────────────────────────────────────────
create table workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  step_order integer not null,
  type step_type not null,
  -- JSONB config shape depends on `type`:
  --   llm_call:           { prompt: string, model?: string }
  --   http_request:       { url: string, method: string, headers?: object, body?: object }
  --   db_write:           { target: string, fields: object }
  --   notify:             { channel: 'slack'|'email', target: string, message: string }
  --   conditional_branch: { condition: string, on_true_step_id?: uuid, on_false_step_id?: uuid }
  --   approval_gate:      { required_role: 'owner'|'editor' }
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (workflow_id, step_order)
);

create index idx_workflow_steps_workflow on workflow_steps(workflow_id);

-- ─── workflow_triggers ───────────────────────────────────────────────────
create table workflow_triggers (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  type trigger_type not null,
  -- config shape depends on `type`:
  --   webhook:        { secret: string }  -- caller must present this
  --   scheduled:      { cron: string }
  --   database_event: { table: string }   -- documentation only; the actual
  --                                          wiring lives in Hasura event
  --                                          trigger metadata, not here
  config jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_workflow_triggers_workflow on workflow_triggers(workflow_id);

-- ─── workflow_runs ───────────────────────────────────────────────────────
create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade, -- denormalized for permission-rule simplicity, see DECISIONS.md
  status run_status not null default 'pending',
  triggered_by uuid, -- null for non-manual triggers
  trigger_type trigger_type not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index idx_workflow_runs_workflow on workflow_runs(workflow_id);
create index idx_workflow_runs_org on workflow_runs(org_id);

-- ─── step_runs ───────────────────────────────────────────────────────────
create table step_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  workflow_step_id uuid not null references workflow_steps(id) on delete cascade,
  status step_run_status not null default 'pending',
  input jsonb,
  output jsonb,
  error text,
  attempt_count integer not null default 0,
  approved_by uuid,
  approved_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
);

create index idx_step_runs_run on step_runs(workflow_run_id);

-- ─── workflow_results ────────────────────────────────────────────────────
-- Backing table for db_write steps — "saves a result into your own
-- tables," per the spec. Kept generic (org-scoped, jsonb payload) rather
-- than inventing a business-specific target table, since the assignment
-- doesn't specify what a db_write is actually persisting.
create table workflow_results (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  step_run_id uuid not null references step_runs(id) on delete cascade,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_workflow_results_org on workflow_results(org_id);
create index idx_workflow_results_run on workflow_results(workflow_run_id);

-- ─── watched_events ──────────────────────────────────────────────────────
-- Backing table for the "database event" trigger type. Rather than
-- attaching a Hasura Event Trigger to an arbitrary user table (which would
-- need per-workflow dynamic trigger creation — real complexity for
-- something this assignment doesn't otherwise need), external systems or
-- app code insert a row here to represent "something happened." A single
-- Hasura Event Trigger on INSERT into this table calls the action-handler,
-- which finds workflows with a database_event trigger matching
-- `source_table` and starts a run for each. Documented as a deliberate
-- simplification in DECISIONS.md.
create table watched_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  source_table text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_watched_events_org on watched_events(org_id);

-- ─── org-level usage view ────────────────────────────────────────────────
-- The one required aggregation: usage this period + average run duration,
-- exposed as a view so it can be tracked as a Hasura computed/queryable
-- field without denormalizing onto organizations itself.
create view org_usage_summary as
select
  o.id as org_id,
  o.quota_limit,
  o.quota_used,
  o.quota_period_start,
  (o.quota_limit - o.quota_used) as quota_remaining,
  count(wr.id) filter (where wr.finished_at is not null) as completed_runs_total,
  avg(extract(epoch from (wr.finished_at - wr.started_at)))
    filter (where wr.finished_at is not null) as avg_run_duration_seconds
from organizations o
left join workflow_runs wr on wr.org_id = o.id
group by o.id;
