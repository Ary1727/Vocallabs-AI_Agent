import { pool } from './db';
import { triggerWorkflowRun, QuotaExhaustedError, WorkflowNotFoundError } from './runWorkflow';
import { ForbiddenError } from './permissions';
import { resetAndSeed, closePool, ORG_A, ORG_B, USER_A_OWNER, USER_A_VIEWER, USER_B_OWNER } from './testSeed';

beforeEach(async () => {
  await resetAndSeed();
});

afterAll(async () => {
  await closePool();
});

async function createWorkflow(orgId: string, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into workflows (org_id, name, created_by) values ($1, $2, $1) returning id`,
    [orgId, name]
  );
  const row = result.rows[0];
  if (!row) throw new Error('seed failed');
  return row.id;
}

async function addStep(workflowId: string, order: number, type: string, config: Record<string, unknown>) {
  await pool.query(
    `insert into workflow_steps (workflow_id, step_order, type, config) values ($1, $2, $3, $4)`,
    [workflowId, order, type, JSON.stringify(config)]
  );
}

describe('triggerWorkflowRun — permissions (Layer 1)', () => {
  test('a viewer cannot trigger a run', async () => {
    const workflowId = await createWorkflow(ORG_A, 'Test Workflow');
    await addStep(workflowId, 1, 'db_write', { fields: { hello: 'world' } });

    await expect(
      triggerWorkflowRun({ userId: USER_A_VIEWER, workflowId, triggerType: 'manual' })
    ).rejects.toThrow(ForbiddenError);
  });

  test('an owner can trigger a run', async () => {
    const workflowId = await createWorkflow(ORG_A, 'Test Workflow');
    await addStep(workflowId, 1, 'db_write', { fields: { hello: 'world' } });

    const result = await triggerWorkflowRun({ userId: USER_A_OWNER, workflowId, triggerType: 'manual' });
    expect(result.status).toBe('succeeded');
  });

  test('cross-org isolation: an Org B user cannot trigger Org A workflow, even knowing its exact ID', async () => {
    const workflowId = await createWorkflow(ORG_A, 'Org A Secret Workflow');
    await addStep(workflowId, 1, 'db_write', { fields: {} });

    await expect(
      triggerWorkflowRun({ userId: USER_B_OWNER, workflowId, triggerType: 'manual' })
    ).rejects.toThrow(ForbiddenError);

    // and confirm no run was actually created as a side effect of the attempt
    const runs = await pool.query('select count(*) from workflow_runs where workflow_id = $1', [workflowId]);
    expect(Number(runs.rows[0].count)).toBe(0);
  });

  test('triggering a nonexistent workflow ID fails distinctly but without leaking existence info', async () => {
    await expect(
      triggerWorkflowRun({ userId: USER_A_OWNER, workflowId: '99999999-9999-9999-9999-999999999999', triggerType: 'manual' })
    ).rejects.toThrow(WorkflowNotFoundError);
  });
});

describe('triggerWorkflowRun — quota enforcement', () => {
  test('rejects when quota is already exhausted', async () => {
    await pool.query('update organizations set quota_used = quota_limit where id = $1', [ORG_A]);
    const workflowId = await createWorkflow(ORG_A, 'Test Workflow');
    await addStep(workflowId, 1, 'db_write', { fields: {} });

    await expect(
      triggerWorkflowRun({ userId: USER_A_OWNER, workflowId, triggerType: 'manual' })
    ).rejects.toThrow(QuotaExhaustedError);
  });

  test('increments quota by 1 on a successful run, not at all on a failed run', async () => {
    const workflowId = await createWorkflow(ORG_A, 'Test Workflow');
    await addStep(workflowId, 1, 'db_write', { fields: {} });
    await triggerWorkflowRun({ userId: USER_A_OWNER, workflowId, triggerType: 'manual' });

    const after = await pool.query('select quota_used from organizations where id = $1', [ORG_A]);
    expect(after.rows[0].quota_used).toBe(1);

    // A failing workflow should NOT consume quota
    const failWorkflowId = await createWorkflow(ORG_A, 'Failing Workflow');
    await addStep(failWorkflowId, 1, 'http_request', { url: 'not-a-valid-url', method: 'GET' });
    const failResult = await triggerWorkflowRun({ userId: USER_A_OWNER, workflowId: failWorkflowId, triggerType: 'manual' });
    expect(failResult.status).toBe('failed');

    const afterFail = await pool.query('select quota_used from organizations where id = $1', [ORG_A]);
    expect(afterFail.rows[0].quota_used).toBe(1); // unchanged from before
  });
});

describe('triggerWorkflowRun — step execution', () => {
  test('executes multiple steps in order and records step_runs for each', async () => {
    const workflowId = await createWorkflow(ORG_A, 'Multi-step Workflow');
    await addStep(workflowId, 1, 'db_write', { fields: { step: 1 } });
    await addStep(workflowId, 2, 'db_write', { fields: { step: 2 } });
    await addStep(workflowId, 3, 'db_write', { fields: { step: 3 } });

    const result = await triggerWorkflowRun({ userId: USER_A_OWNER, workflowId, triggerType: 'manual' });
    expect(result.status).toBe('succeeded');

    const stepRuns = await pool.query(
      'select status from step_runs where workflow_run_id = $1 order by started_at asc',
      [result.workflowRunId]
    );
    expect(stepRuns.rows.map((r) => r.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
  });

  test('conditional_branch redirects execution based on the previous step output', async () => {
    const workflowId = await createWorkflow(ORG_A, 'Branching Workflow');
    // Step 1: db_write with a distinctive field so we can branch on it
    await addStep(workflowId, 1, 'db_write', { fields: { length: 999 } });

    // Get the step ids so we can wire up branch targets
    const steps = await pool.query(
      'select id, step_order from workflow_steps where workflow_id = $1 order by step_order',
      [workflowId]
    );
    const step1Id = steps.rows[0].id;

    // Note: db_write's output shape is { written: true, fields: {...} },
    // so branch on fields.length via nested path.
    await pool.query(
      `update workflow_steps set config = $2 where id = $1`,
      [step1Id, JSON.stringify({ fields: { length: 999 } })]
    );

    const trueStepResult = await pool.query(
      `insert into workflow_steps (workflow_id, step_order, type, config) values ($1, 10, 'db_write', $2) returning id`,
      [workflowId, JSON.stringify({ fields: { branch: 'true_taken' } })]
    );
    const falseStepResult = await pool.query(
      `insert into workflow_steps (workflow_id, step_order, type, config) values ($1, 11, 'db_write', $2) returning id`,
      [workflowId, JSON.stringify({ fields: { branch: 'false_taken' } })]
    );

    await pool.query(
      `insert into workflow_steps (workflow_id, step_order, type, config) values ($1, 2, 'conditional_branch', $2)`,
      [
        workflowId,
        JSON.stringify({
          condition: 'output.fields.length > 500',
          on_true_step_id: trueStepResult.rows[0].id,
          on_false_step_id: falseStepResult.rows[0].id,
        }),
      ]
    );

    const result = await triggerWorkflowRun({ userId: USER_A_OWNER, workflowId, triggerType: 'manual' });
    expect(result.status).toBe('succeeded');

    const writtenResults = await pool.query(
      `select data from workflow_results where workflow_run_id = $1 order by created_at asc`,
      [result.workflowRunId]
    );
    const branches = writtenResults.rows.map((r) => r.data.branch).filter(Boolean);
    expect(branches).toEqual(['true_taken']); // condition was true (999 > 500), false branch never ran
  });

  test('http_request retries on failure and eventually fails the run after exhausting retries', async () => {
    const workflowId = await createWorkflow(ORG_A, 'Failing HTTP Workflow');
    await addStep(workflowId, 1, 'http_request', { url: 'http://localhost:1/definitely-not-listening', method: 'GET' });

    const result = await triggerWorkflowRun({ userId: USER_A_OWNER, workflowId, triggerType: 'manual' });
    expect(result.status).toBe('failed');

    const stepRun = await pool.query(
      'select status, attempt_count, error from step_runs where workflow_run_id = $1',
      [result.workflowRunId]
    );
    expect(stepRun.rows[0].status).toBe('failed');
    expect(stepRun.rows[0].attempt_count).toBe(3); // HTTP_RETRY.maxAttempts in stepExecutor.ts
  }, 15000);
});

describe('triggerWorkflowRun — approval gate pause', () => {
  test('a workflow with an approval_gate pauses instead of completing', async () => {
    const workflowId = await createWorkflow(ORG_A, 'Approval Workflow');
    await addStep(workflowId, 1, 'db_write', { fields: { before_gate: true } });
    await addStep(workflowId, 2, 'approval_gate', { required_role: 'owner' });
    await addStep(workflowId, 3, 'db_write', { fields: { after_gate: true } });

    const result = await triggerWorkflowRun({ userId: USER_A_OWNER, workflowId, triggerType: 'manual' });
    expect(result.status).toBe('paused');

    const stepRuns = await pool.query(
      'select status from step_runs where workflow_run_id = $1 order by started_at asc',
      [result.workflowRunId]
    );
    // step 1 succeeded, step 2 (the gate) paused, step 3 never ran
    expect(stepRuns.rows.map((r) => r.status)).toEqual(['succeeded', 'paused']);

    const writtenResults = await pool.query(`select data from workflow_results where workflow_run_id = $1`, [
      result.workflowRunId,
    ]);
    expect(writtenResults.rows).toHaveLength(1); // only the before_gate write happened
  });
});
