'use client';

import { useQuery, useMutation } from '@apollo/client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { GET_ORG_WORKFLOWS, GET_ORG_USAGE, GET_MY_ROLE, TRIGGER_WORKFLOW_RUN } from '@/lib/graphql';
import { useCurrentUser } from '@/lib/useAuth';

interface WorkflowRun {
  id: string;
  status: string;
}
interface Workflow {
  id: string;
  name: string;
  description: string | null;
  workflow_runs: WorkflowRun[];
}

export default function OrgWorkflowsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const { user } = useCurrentUser();

  const { data: workflowsData, loading, refetch } = useQuery<{ workflows: Workflow[] }>(GET_ORG_WORKFLOWS, {
    variables: { orgId },
    skip: !orgId,
  });
  const { data: usageData } = useQuery(GET_ORG_USAGE, { variables: { orgId }, skip: !orgId });
  const { data: roleData } = useQuery(GET_MY_ROLE, {
    variables: { orgId, userId: user?.id },
    skip: !orgId || !user,
  });
  const [triggerRun] = useMutation(TRIGGER_WORKFLOW_RUN);

  const myRole: string | undefined = roleData?.org_members?.[0]?.role;
  const canTrigger = myRole === 'owner' || myRole === 'editor';

  const org = usageData?.organizations_by_pk;
  const quotaPct = org ? Math.min(100, Math.round((org.quota_used / org.quota_limit) * 100)) : 0;

  async function handleRun(workflowId: string) {
    const result = await triggerRun({ variables: { workflowId } });
    const runId = result.data?.triggerWorkflowRun?.workflow_run_id;
    if (runId) router.push(`/orgs/${orgId}/runs/${runId}`);
  }

  return (
    <div className="container">
      <h1>Workflows</h1>

      {org && (
        <div className="card">
          <strong>{org.name}</strong> usage
          <div>{org.quota_used} / {org.quota_limit} calls this period</div>
          <div className="quota-bar">
            <div className="quota-bar-fill" style={{ width: `${quotaPct}%` }} />
          </div>
        </div>
      )}

      <Link href={`/orgs/${orgId}/workflows/new`}>+ New workflow</Link>

      {loading && <p>Loading…</p>}
      {workflowsData?.workflows.map((wf) => {
        const lastRun = wf.workflow_runs[0];
        return (
          <div key={wf.id} className="card">
            <strong>{wf.name}</strong>
            {wf.description && <p>{wf.description}</p>}
            {lastRun && <span className={`pill pill-${lastRun.status}`}>{lastRun.status}</span>}
            {canTrigger && (
              <button style={{ marginLeft: 12 }} onClick={() => handleRun(wf.id)}>
                Run
              </button>
            )}
            {lastRun && (
              <Link href={`/orgs/${orgId}/runs/${lastRun.id}`} style={{ marginLeft: 12 }}>
                View last run →
              </Link>
            )}
          </div>
        );
      })}
      <button onClick={() => refetch()} style={{ marginTop: 12 }}>Refresh</button>
    </div>
  );
}
