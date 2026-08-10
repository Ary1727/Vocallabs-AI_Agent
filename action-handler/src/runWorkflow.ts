import {
  getWorkflow,
  getStepsForWorkflow,
  getOrgQuota,
  incrementQuota,
  createWorkflowRun,
  setRunStatus,
  createStepRun,
  completeStepRun,
  StepRow,
} from './db';
import { requireOrgRole, ForbiddenError } from './permissions';
import { executeStep, StepDefinition } from './stepExecutor';

export class QuotaExhaustedError extends Error {
  constructor() {
    super('Organization quota is exhausted for this period.');
    this.name = 'QuotaExhaustedError';
  }
}

export class WorkflowNotFoundError extends Error {
  constructor() {
    super('Workflow not found.');
    this.name = 'WorkflowNotFoundError';
  }
}

export interface TriggerWorkflowRunParams {
  userId: string;
  workflowId: string;
  triggerType: 'manual' | 'webhook' | 'scheduled' | 'database_event';
}

export interface TriggerWorkflowRunResult {
  workflowRunId: string;
  status: string;
}

export async function triggerWorkflowRun(params: TriggerWorkflowRunParams): Promise<TriggerWorkflowRunResult> {
  const workflow = await getWorkflow(params.workflowId);
  // Same non-distinguishing failure as requireOrgRole: "workflow doesn't
  // exist" and "workflow exists but you can't see it" should not be
  // distinguishable to the caller — otherwise the error response itself
  // becomes an oracle for probing which workflow IDs exist.
  if (!workflow) throw new WorkflowNotFoundError();

  // Layer 1: org + role scoping. Viewers are excluded here — this is the
  // enforcement point for "viewer, cannot trigger a run," re-checked
  // independently of whatever Hasura's Action-level permissions already
  // filtered (see permissions.ts for why this isn't redundant).
  await requireOrgRole(params.userId, workflow.org_id, ['owner', 'editor']);

  const quota = await getOrgQuota(workflow.org_id);
  if (!quota || quota.quota_used >= quota.quota_limit) {
    throw new QuotaExhaustedError();
  }

  const steps = await getStepsForWorkflow(params.workflowId);
  const runId = await createWorkflowRun({
    workflowId: params.workflowId,
    orgId: workflow.org_id,
    triggeredBy: params.triggerType === 'manual' ? params.userId : null,
    triggerType: params.triggerType,
  });

  const finalStatus = await executeStepsInOrder(runId, workflow.org_id, steps);
  await setRunStatus(runId, finalStatus);

  if (finalStatus === 'succeeded') {
    await incrementQuota(workflow.org_id);
  }

  return { workflowRunId: runId, status: finalStatus };
}

/**
 * Executes steps starting from the lowest step_order, following
 * conditional_branch redirects when present, and stopping (returning
 * 'paused') the moment an approval_gate step is hit. This function does
 * NOT resume a paused run — that's approveStep.ts's job, which re-enters
 * this same execution loop from the step after the approved gate.
 */
export async function executeStepsInOrder(
  runId: string,
  orgId: string,
  steps: StepRow[],
  startFromStepId?: string
): Promise<'succeeded' | 'failed' | 'paused'> {
  const stepsById = new Map(steps.map((s) => [s.id, s]));
  let current: StepRow | undefined = startFromStepId
    ? stepsById.get(startFromStepId)
    : steps[0];
  let previousOutput: unknown = null;

  // Tracks whether `current` was reached by following a conditional_branch
  // redirect rather than by normal step_order sequencing. This exists
  // because of a real bug caught by runWorkflow.test.ts: without it, after
  // executing a branch TARGET step, the loop fell through to
  // "step_order + 1" of that target — which, in the test, happened to be
  // the OTHER branch's step (both branch targets were placed at adjacent
  // step_orders 10 and 11), so the run silently executed both sides of
  // the conditional instead of just the one the condition selected.
  //
  // Fix/design decision: branch-target steps are terminal in this model —
  // once a conditional_branch redirects execution, the run completes
  // after that one target step rather than trying to merge back into a
  // "main line" sequence. Re-merging control flow after a branch (so
  // execution could continue past the target back into shared downstream
  // steps) is a real, more complex feature — this assignment's spec
  // doesn't specify merge semantics, so treating branches as terminal is
  // the documented, disclosed scope cut rather than a guess. See
  // DECISIONS.md.
  let reachedViaBranch = false;

  while (current) {
    const stepDef: StepDefinition = { id: current.id, type: current.type, config: current.config };
    const stepRunId = await createStepRun({ workflowRunId: runId, workflowStepId: current.id, input: previousOutput });

    const result = await executeStep(stepDef, {
      previousOutput,
      orgId,
      workflowRunId: runId,
      stepRunId,
    });

    if (result.kind === 'paused') {
      await completeStepRun({ stepRunId, status: 'paused', attemptCount: 0 });
      return 'paused';
    }

    if (result.kind === 'failed') {
      await completeStepRun({ stepRunId, status: 'failed', error: result.error, attemptCount: result.attempts });
      return 'failed';
    }

    await completeStepRun({
      stepRunId,
      status: 'succeeded',
      output: result.output,
      attemptCount: result.attempts,
    });
    previousOutput = result.output;

    if (result.kind === 'branch') {
      current = result.nextStepId ? stepsById.get(result.nextStepId) : undefined;
      reachedViaBranch = true;
    } else if (reachedViaBranch) {
      current = undefined; // branch target was terminal — stop here, do not fall through
    } else {
      const nextOrder = current.step_order + 1;
      current = steps.find((s) => s.step_order === nextOrder);
    }
  }

  return 'succeeded';
}

export { ForbiddenError };
