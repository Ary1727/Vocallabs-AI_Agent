import { getStepRun, getWorkflowRun, getStepsForWorkflow, approveStepRun, setRunStatus, incrementQuota } from './db';
import { requireOrgRole } from './permissions';
import { executeStepsInOrder } from './runWorkflow';

export class StepRunNotFoundError extends Error {
  constructor() {
    super('Step run not found.');
    this.name = 'StepRunNotFoundError';
  }
}

export class StepNotPausedError extends Error {
  constructor() {
    super('This step is not currently awaiting approval.');
    this.name = 'StepNotPausedError';
  }
}

export interface ApproveStepParams {
  userId: string;
  stepRunId: string;
}

export interface ApproveStepResult {
  stepRunId: string;
  status: string;
}

export async function approveStep(params: ApproveStepParams): Promise<ApproveStepResult> {
  const stepRun = await getStepRun(params.stepRunId);
  if (!stepRun) throw new StepRunNotFoundError();

  const run = await getWorkflowRun(stepRun.workflow_run_id);
  if (!run) throw new StepRunNotFoundError();

  // This is the check the spec calls out specifically: "Clearing an
  // approval_gate requires the Action handler itself to check the
  // approver's role before resuming the run — this can't be a database
  // permission alone, since it's a mid-execution decision, not a simple
  // row read or write." A Hasura row permission can gate whether you can
  // SELECT or UPDATE a row, but "resume a paused workflow, which then
  // executes arbitrary further steps with side effects" is a business
  // operation, not a column-level write — that logic has to live here.
  await requireOrgRole(params.userId, run.org_id, ['owner', 'editor']);

  if (stepRun.status !== 'paused') {
    throw new StepNotPausedError();
  }

  await approveStepRun(params.stepRunId, params.userId);
  await setRunStatus(run.id, 'running');

  const steps = await getStepsForWorkflow(run.workflow_id);
  const approvedStep = steps.find((s) => s.id === stepRun.workflow_step_id);
  const nextOrder = (approvedStep?.step_order ?? 0) + 1;
  const nextStep = steps.find((s) => s.step_order === nextOrder);

  const finalStatus = nextStep
    ? await executeStepsInOrder(run.id, run.org_id, steps, nextStep.id)
    : 'succeeded'; // approval gate was the last step

  await setRunStatus(run.id, finalStatus);
  if (finalStatus === 'succeeded') {
    await incrementQuota(run.org_id);
  }

  return { stepRunId: params.stepRunId, status: finalStatus };
}
