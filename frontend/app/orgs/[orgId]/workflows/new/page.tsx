'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { useParams, useRouter } from 'next/navigation';
import { CREATE_WORKFLOW, ADD_WORKFLOW_STEP, ADD_WORKFLOW_TRIGGER } from '@/lib/graphql';
import { useCurrentUser } from '@/lib/useAuth';

const STEP_TYPES = ['llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate'] as const;
type StepType = (typeof STEP_TYPES)[number];

interface DraftStep {
  type: StepType;
  configText: string; // raw JSON text, validated on save
}

export default function NewWorkflowPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const { user } = useCurrentUser();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [triggerType, setTriggerType] = useState<'manual' | 'webhook' | 'scheduled' | 'database_event'>('manual');
  const [triggerConfigText, setTriggerConfigText] = useState('{}');
  const [error, setError] = useState('');

  const [createWorkflow] = useMutation(CREATE_WORKFLOW);
  const [addStep] = useMutation(ADD_WORKFLOW_STEP);
  const [addTrigger] = useMutation(ADD_WORKFLOW_TRIGGER);

  function addDraftStep(type: StepType) {
    setSteps((prev) => [...prev, { type, configText: '{}' }]);
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(index, 1);
      if (!item) return prev;
      next.splice(target, 0, item);
      return next;
    });
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setError('');
    if (!user) {
      setError('Not signed in.');
      return;
    }
    if (!name.trim()) {
      setError('Workflow name is required.');
      return;
    }

    let parsedSteps: Array<{ type: StepType; config: Record<string, unknown> }>;
    let parsedTriggerConfig: Record<string, unknown>;
    try {
      parsedSteps = steps.map((s) => ({ type: s.type, config: JSON.parse(s.configText) }));
      parsedTriggerConfig = JSON.parse(triggerConfigText);
    } catch {
      setError('One of the step configs (or the trigger config) is not valid JSON.');
      return;
    }

    try {
      const workflowResult = await createWorkflow({
        variables: { orgId, name, description: description || null, createdBy: user.id },
      });
      const workflowId = workflowResult.data?.insert_workflows_one?.id;
      if (!workflowId) throw new Error('Workflow creation did not return an id.');

      for (let i = 0; i < parsedSteps.length; i += 1) {
        const step = parsedSteps[i];
        if (!step) continue;
        await addStep({
          variables: { workflowId, stepOrder: i + 1, type: step.type, config: step.config },
        });
      }

      await addTrigger({ variables: { workflowId, type: triggerType, config: parsedTriggerConfig } });

      router.push(`/orgs/${orgId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow.');
    }
  }

  return (
    <div className="container">
      <h1>New workflow</h1>

      <div className="card">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
        <label>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
      </div>

      <div className="card">
        <h3>Steps</h3>
        {steps.map((step, i) => (
          <div key={i} className="card" style={{ background: '#0d0f14' }}>
            <strong>
              {i + 1}. {step.type}
            </strong>
            <div>
              <button onClick={() => moveStep(i, -1)} disabled={i === 0}>↑</button>
              <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}>↓</button>
              <button onClick={() => removeStep(i)}>Remove</button>
            </div>
            <label>Config (JSON)</label>
            <textarea
              value={step.configText}
              onChange={(e) => {
                const value = e.target.value;
                setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, configText: value } : s)));
              }}
              style={{ width: '100%', fontFamily: 'monospace' }}
              rows={3}
            />
          </div>
        ))}
        <div style={{ marginTop: 10 }}>
          Add step:{' '}
          {STEP_TYPES.map((t) => (
            <button key={t} onClick={() => addDraftStep(t)} style={{ marginRight: 6 }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Trigger</h3>
        <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as typeof triggerType)}>
          <option value="manual">Manual</option>
          <option value="webhook">Webhook</option>
          <option value="scheduled">Scheduled (cron)</option>
          <option value="database_event">Database event</option>
        </select>
        <label style={{ display: 'block', marginTop: 10 }}>Trigger config (JSON)</label>
        <textarea
          value={triggerConfigText}
          onChange={(e) => setTriggerConfigText(e.target.value)}
          style={{ width: '100%', fontFamily: 'monospace' }}
          rows={2}
        />
      </div>

      {error && <p style={{ color: '#ff9d9d' }}>{error}</p>}
      <button onClick={handleSave}>Save workflow</button>
    </div>
  );
}
