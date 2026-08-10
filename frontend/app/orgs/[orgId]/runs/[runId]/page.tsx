'use client';

import { useSubscription, useMutation, useQuery } from '@apollo/client';
import { useParams } from 'next/navigation';
import { SUBSCRIBE_STEP_RUNS, APPROVE_STEP, GET_MY_ROLE } from '@/lib/graphql';
import { useCurrentUser } from '@/lib/useAuth';

interface StepRunLive {
  id: string;
  workflow_step_id: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  attempt_count: number;
  approved_by: string | null;
  started_at: string;
  finished_at: string | null;
}

export default function RunDetailPage() {
  const { orgId, runId } = useParams<{ orgId: string; runId: string }>();
  const { user } = useCurrentUser();

  // Required: subscription on step_runs filtered to a workflow_run_id, for
  // live step-by-step progress with no refresh — including a paused,
  // awaiting-approval state.
  const { data, loading } = useSubscription<{ step_runs: StepRunLive[] }>(SUBSCRIBE_STEP_RUNS, {
    variables: { workflowRunId: runId },
    skip: !runId,
  });

  const { data: roleData } = useQuery(GET_MY_ROLE, {
    variables: { orgId, userId: user?.id },
    skip: !orgId || !user,
  });
  const myRole: string | undefined = roleData?.org_members?.[0]?.role;
  const canApprove = myRole === 'owner' || myRole === 'editor';

  const [approveStep, { loading: approving }] = useMutation(APPROVE_STEP);

  async function handleApprove(stepRunId: string) {
    await approveStep({ variables: { stepRunId } });
    // The subscription will pick up the resulting status changes live —
    // no manual refetch needed, which is the point of using a
    // subscription here instead of a query.
  }

  return (
    <div className="container">
      <h1>Run {runId}</h1>
      {loading && <p>Connecting to live updates…</p>}

      {data?.step_runs.map((sr) => (
        <div key={sr.id} className="card">
          <span className={`pill pill-${sr.status}`}>{sr.status}</span>
          <div style={{ fontSize: 12, color: '#8b93a3', marginTop: 4 }}>
            step {sr.workflow_step_id} · attempt {sr.attempt_count}
          </div>
          {sr.output != null && (
            <pre style={{ fontSize: 12, overflowX: 'auto' }}>{JSON.stringify(sr.output, null, 2)}</pre>
          )}
          {sr.error && <p style={{ color: '#ff9d9d' }}>{sr.error}</p>}

          {sr.status === 'paused' && (
            <div style={{ marginTop: 8 }}>
              {canApprove ? (
                <button onClick={() => handleApprove(sr.id)} disabled={approving}>
                  {approving ? 'Approving…' : 'Approve to continue'}
                </button>
              ) : (
                <p style={{ color: '#8b93a3' }}>Awaiting approval from an owner or editor.</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
