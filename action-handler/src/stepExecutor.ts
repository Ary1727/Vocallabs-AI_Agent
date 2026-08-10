import { pool } from './db';
import { withRetry, RetryExhaustedError } from './retry';
import { callLlm } from './llmClient';
import { evaluateCondition, ConditionEvaluationError } from './conditionEvaluator';

export interface StepDefinition {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export type StepExecutionResult =
  | { kind: 'succeeded'; output: unknown; attempts: number }
  | { kind: 'failed'; error: string; attempts: number }
  | { kind: 'paused' }
  | { kind: 'branch'; output: unknown; attempts: number; nextStepId: string | null };

const HTTP_RETRY = { maxAttempts: 3, delayMs: 500 };
const LLM_RETRY = { maxAttempts: 2, delayMs: 500 };

export async function executeStep(
  step: StepDefinition,
  context: { previousOutput: unknown; orgId: string; workflowRunId: string; stepRunId: string }
): Promise<StepExecutionResult> {
  try {
    switch (step.type) {
      case 'llm_call':
        return await runLlmCall(step);
      case 'http_request':
        return await runHttpRequest(step);
      case 'db_write':
        return await runDbWrite(step, context);
      case 'notify':
        return runNotify(step);
      case 'conditional_branch':
        return runConditionalBranch(step, context.previousOutput);
      case 'approval_gate':
        return { kind: 'paused' };
      default:
        return { kind: 'failed', error: `Unknown step type: ${step.type}`, attempts: 0 };
    }
  } catch (err) {
    return { kind: 'failed', error: err instanceof Error ? err.message : String(err), attempts: 0 };
  }
}

async function runLlmCall(step: StepDefinition): Promise<StepExecutionResult> {
  const prompt = String(step.config.prompt ?? '');
  if (!prompt) return { kind: 'failed', error: 'llm_call step is missing a prompt.', attempts: 0 };

  try {
    const { result, attempts } = await withRetry(() => callLlm(prompt), LLM_RETRY);
    return { kind: 'succeeded', output: result, attempts };
  } catch (err) {
    if (err instanceof RetryExhaustedError) {
      return { kind: 'failed', error: err.message, attempts: err.attempts };
    }
    throw err;
  }
}

async function runHttpRequest(step: StepDefinition): Promise<StepExecutionResult> {
  const url = String(step.config.url ?? '');
  const method = String(step.config.method ?? 'GET');
  if (!url) return { kind: 'failed', error: 'http_request step is missing a url.', attempts: 0 };

  try {
    const { result, attempts } = await withRetry(async () => {
      const res = await fetch(url, {
        method,
        headers: (step.config.headers as Record<string, string>) ?? undefined,
        body: step.config.body ? JSON.stringify(step.config.body) : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const contentType = res.headers.get('content-type') ?? '';
      return contentType.includes('application/json') ? await res.json() : await res.text();
    }, HTTP_RETRY);
    return { kind: 'succeeded', output: result, attempts };
  } catch (err) {
    if (err instanceof RetryExhaustedError) {
      return { kind: 'failed', error: err.message, attempts: err.attempts };
    }
    throw err;
  }
}

async function runDbWrite(
  step: StepDefinition,
  context: { orgId: string; workflowRunId: string; stepRunId: string }
): Promise<StepExecutionResult> {
  const fields = (step.config.fields as Record<string, unknown>) ?? {};
  await pool.query(
    `insert into workflow_results (org_id, workflow_run_id, step_run_id, data) values ($1, $2, $3, $4)`,
    [context.orgId, context.workflowRunId, context.stepRunId, JSON.stringify(fields)]
  );
  return { kind: 'succeeded', output: { written: true, fields }, attempts: 1 };
}

function runNotify(step: StepDefinition): StepExecutionResult {
  // Stubbed — no real Slack/email credentials wired up. Recorded honestly
  // as stubbed in the output rather than pretending a message was sent,
  // same principle as the LLM stub.
  const channel = String(step.config.channel ?? 'unknown');
  const target = String(step.config.target ?? '');
  const message = String(step.config.message ?? '');
  return {
    kind: 'succeeded',
    output: { stubbed: true, channel, target, message, note: 'No real notification provider configured.' },
    attempts: 1,
  };
}

function runConditionalBranch(step: StepDefinition, previousOutput: unknown): StepExecutionResult {
  const condition = String(step.config.condition ?? '');
  const onTrue = (step.config.on_true_step_id as string | undefined) ?? null;
  const onFalse = (step.config.on_false_step_id as string | undefined) ?? null;

  try {
    const result = evaluateCondition(condition, previousOutput);
    return { kind: 'branch', output: { condition, result }, attempts: 1, nextStepId: result ? onTrue : onFalse };
  } catch (err) {
    if (err instanceof ConditionEvaluationError) {
      return { kind: 'failed', error: err.message, attempts: 0 };
    }
    throw err;
  }
}
