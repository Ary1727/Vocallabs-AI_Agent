import { pool } from './db';
import { triggerWorkflowRun } from './runWorkflow';
import { approveStep, StepNotPausedError } from './approveStep';
import { ForbiddenError } from './permissions';
import { resetAndSeed, closePool, ORG_A, USER_A_OWNER, USER_A_VIEWER, USER_B_OWNER } from './testSeed';

beforeEach(async () => {
  await resetAndSeed();
});

afterAll(async () => {
  await closePool();
});

async function createPausedRun(): Promise<{ workflowRunId: string; gateStepRunId: string }> {
  const wf = await pool.query<{ id: string }>(
    `insert into workflows (org_id, name, created_by) values ($1, 'Approval Workflow', $1) returning id`,
    [ORG_A]
  );
  const workflowId = wf.rows[0]!.id;
  await pool.query(`insert into workflow_steps (workflow_id, step_order, type, config) values
    ($1, 1, 'db_write', '{"fields": {"before": true}}'),
    ($1, 2, 'approval_gate', '{"required_role": "owner"}'),
    ($1, 3, 'db_write', '{"fields": {"after": true}}')`, [workflowId]);

  const result = await triggerWorkflowRun({ userId: USER_A_OWNER, workflowId, triggerType: 'manual' });
  expect(result.status).toBe('paused');

  const gateStepRun = await pool.query<{ id: string }>(
    `select id from step_runs where workflow_run_id = $1 and status = 'paused'`,
    [result.workflowRunId]
  );
  return { workflowRunId: result.workflowRunId, gateStepRunId: gateStepRun.rows[0]!.id };
}

describe('approveStep', () => {
  test('a viewer cannot approve, even in their own org', async () => {
    const { gateStepRunId } = await createPausedRun();
    await expect(approveStep({ userId: USER_A_VIEWER, stepRunId: gateStepRunId })).rejects.toThrow(ForbiddenError);
  });

  test('a user from a different org cannot approve, even knowing the exact step_run_id', async () => {
    const { gateStepRunId } = await createPausedRun();
    await expect(approveStep({ userId: USER_B_OWNER, stepRunId: gateStepRunId })).rejects.toThrow(ForbiddenError);
  });

  test('an owner CAN approve and the run resumes and completes the remaining steps', async () => {
    const { workflowRunId, gateStepRunId } = await createPausedRun();

    const result = await approveStep({ userId: USER_A_OWNER, stepRunId: gateStepRunId });
    expect(result.status).toBe('succeeded');

    const stepRuns = await pool.query(
      `select status from step_runs where workflow_run_id = $1 order by started_at asc`,
      [workflowRunId]
    );
    expect(stepRuns.rows.map((r) => r.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);

    const runRow = await pool.query(`select status from workflow_runs where id = $1`, [workflowRunId]);
    expect(runRow.rows[0].status).toBe('succeeded');
  });

  test('approving increments the org quota on eventual completion', async () => {
    const { gateStepRunId } = await createPausedRun();
    const before = await pool.query(`select quota_used from organizations where id = $1`, [ORG_A]);
    await approveStep({ userId: USER_A_OWNER, stepRunId: gateStepRunId });
    const after = await pool.query(`select quota_used from organizations where id = $1`, [ORG_A]);
    expect(after.rows[0].quota_used).toBe(Number(before.rows[0].quota_used) + 1);
  });

  test('cannot approve the same gate twice', async () => {
    const { gateStepRunId } = await createPausedRun();
    await approveStep({ userId: USER_A_OWNER, stepRunId: gateStepRunId });
    await expect(approveStep({ userId: USER_A_OWNER, stepRunId: gateStepRunId })).rejects.toThrow(StepNotPausedError);
  });

  test('approved_by and approved_at are recorded on the step_run', async () => {
    const { gateStepRunId } = await createPausedRun();
    await approveStep({ userId: USER_A_OWNER, stepRunId: gateStepRunId });
    const row = await pool.query(`select approved_by, approved_at from step_runs where id = $1`, [gateStepRunId]);
    expect(row.rows[0].approved_by).toBe(USER_A_OWNER);
    expect(row.rows[0].approved_at).not.toBeNull();
  });
});
