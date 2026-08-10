import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/vocallabs_test',
});

export type OrgRole = 'owner' | 'editor' | 'viewer';

export interface OrgMembership {
  org_id: string;
  user_id: string;
  role: OrgRole;
}

/**
 * Looks up a user's role in a given org. Returns null if they're not a
 * member — the caller treats "not a member" and "wrong role" identically:
 * both mean "not authorized," and the caller should never distinguish
 * between "org doesn't exist," "you're not in it," and "you have the
 * wrong role" in an error message, since that would leak information
 * about which orgs exist to someone probing IDs they don't have access to.
 */
export async function getMembership(userId: string, orgId: string): Promise<OrgMembership | null> {
  const result = await pool.query<OrgMembership>(
    `select org_id, user_id, role from org_members where user_id = $1 and org_id = $2`,
    [userId, orgId]
  );
  return result.rows[0] ?? null;
}

export interface WorkflowRow {
  id: string;
  org_id: string;
  name: string;
}

export async function getWorkflow(workflowId: string): Promise<WorkflowRow | null> {
  const result = await pool.query<WorkflowRow>(
    `select id, org_id, name from workflows where id = $1`,
    [workflowId]
  );
  return result.rows[0] ?? null;
}

export interface StepRow {
  id: string;
  workflow_id: string;
  step_order: number;
  type: string;
  config: Record<string, unknown>;
}

export async function getStepsForWorkflow(workflowId: string): Promise<StepRow[]> {
  const result = await pool.query<StepRow>(
    `select id, workflow_id, step_order, type, config
     from workflow_steps where workflow_id = $1 order by step_order asc`,
    [workflowId]
  );
  return result.rows;
}

export interface OrgQuota {
  quota_limit: number;
  quota_used: number;
}

export async function getOrgQuota(orgId: string): Promise<OrgQuota | null> {
  const result = await pool.query<OrgQuota>(
    `select quota_limit, quota_used from organizations where id = $1`,
    [orgId]
  );
  return result.rows[0] ?? null;
}

export async function incrementQuota(orgId: string, amount = 1): Promise<void> {
  await pool.query(`update organizations set quota_used = quota_used + $2 where id = $1`, [orgId, amount]);
}

export async function createWorkflowRun(params: {
  workflowId: string;
  orgId: string;
  triggeredBy: string | null;
  triggerType: string;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into workflow_runs (workflow_id, org_id, status, triggered_by, trigger_type)
     values ($1, $2, 'running', $3, $4) returning id`,
    [params.workflowId, params.orgId, params.triggeredBy, params.triggerType]
  );
  const row = result.rows[0];
  if (!row) throw new Error('failed to create workflow_run');
  return row.id;
}

export async function setRunStatus(runId: string, status: string): Promise<void> {
  const finished = ['succeeded', 'failed', 'cancelled'].includes(status);
  await pool.query(
    `update workflow_runs set status = $2, finished_at = case when $3 then now() else finished_at end where id = $1`,
    [runId, status, finished]
  );
}

export async function createStepRun(params: {
  workflowRunId: string;
  workflowStepId: string;
  input: unknown;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into step_runs (workflow_run_id, workflow_step_id, status, input, started_at)
     values ($1, $2, 'running', $3, now()) returning id`,
    [params.workflowRunId, params.workflowStepId, JSON.stringify(params.input)]
  );
  const row = result.rows[0];
  if (!row) throw new Error('failed to create step_run');
  return row.id;
}

export async function completeStepRun(params: {
  stepRunId: string;
  status: 'succeeded' | 'failed' | 'paused';
  output?: unknown;
  error?: string;
  attemptCount: number;
}): Promise<void> {
  const finished = params.status !== 'paused';
  await pool.query(
    `update step_runs
     set status = $2, output = $3, error = $4, attempt_count = $5,
         finished_at = case when $6 then now() else finished_at end
     where id = $1`,
    [
      params.stepRunId,
      params.status,
      params.output !== undefined ? JSON.stringify(params.output) : null,
      params.error ?? null,
      params.attemptCount,
      finished,
    ]
  );
}

export interface StepRunRow {
  id: string;
  workflow_run_id: string;
  workflow_step_id: string;
  status: string;
  approved_by: string | null;
}

export async function getStepRun(stepRunId: string): Promise<StepRunRow | null> {
  const result = await pool.query<StepRunRow>(
    `select id, workflow_run_id, workflow_step_id, status, approved_by from step_runs where id = $1`,
    [stepRunId]
  );
  return result.rows[0] ?? null;
}

export async function approveStepRun(stepRunId: string, approverId: string): Promise<void> {
  await pool.query(
    `update step_runs set status = 'succeeded', approved_by = $2, approved_at = now(), finished_at = now()
     where id = $1`,
    [stepRunId, approverId]
  );
}

export interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  org_id: string;
  status: string;
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRunRow | null> {
  const result = await pool.query<WorkflowRunRow>(
    `select id, workflow_id, org_id, status from workflow_runs where id = $1`,
    [runId]
  );
  return result.rows[0] ?? null;
}

export async function getRunOrgId(runId: string): Promise<string | null> {
  const result = await pool.query<{ org_id: string }>(`select org_id from workflow_runs where id = $1`, [runId]);
  return result.rows[0]?.org_id ?? null;
}
