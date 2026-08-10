import { gql } from '@apollo/client';

// Required: a query returning an org's workflows with their steps,
// triggers, and most recent run status.
export const GET_ORG_WORKFLOWS = gql`
  query GetOrgWorkflows($orgId: uuid!) {
    workflows(where: { org_id: { _eq: $orgId } }, order_by: { created_at: desc }) {
      id
      name
      description
      created_at
      workflow_steps(order_by: { step_order: asc }) {
        id
        step_order
        type
        config
      }
      workflow_triggers {
        id
        type
        config
      }
      workflow_runs(order_by: { started_at: desc }, limit: 1) {
        id
        status
        started_at
        finished_at
      }
    }
  }
`;

// Required: a mutation to create/edit a workflow, its steps, and its
// triggers. Split into three mutations for clarity — a single nested
// mutation across workflows + steps + triggers is possible in Hasura via
// nested inserts, but three explicit calls are easier to reason about
// and match the "add/reorder steps" incremental editing UX the frontend
// actually needs (the builder screen edits steps one at a time, not as
// one big transactional blob).
export const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($orgId: uuid!, $name: String!, $description: String, $createdBy: uuid!) {
    insert_workflows_one(object: { org_id: $orgId, name: $name, description: $description, created_by: $createdBy }) {
      id
      name
    }
  }
`;

export const ADD_WORKFLOW_STEP = gql`
  mutation AddWorkflowStep($workflowId: uuid!, $stepOrder: Int!, $type: String!, $config: jsonb!) {
    insert_workflow_steps_one(object: { workflow_id: $workflowId, step_order: $stepOrder, type: $type, config: $config }) {
      id
      step_order
      type
    }
  }
`;

export const ADD_WORKFLOW_TRIGGER = gql`
  mutation AddWorkflowTrigger($workflowId: uuid!, $type: String!, $config: jsonb!) {
    insert_workflow_triggers_one(object: { workflow_id: $workflowId, type: $type, config: $config }) {
      id
      type
    }
  }
`;

export const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflowId: uuid!) {
    triggerWorkflowRun(workflow_id: $workflowId) {
      workflow_run_id
      status
    }
  }
`;

// Required: a mutation to approve a paused approval_gate step.
export const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!) {
    approveStep(step_run_id: $stepRunId) {
      step_run_id
      status
    }
  }
`;

// Required: a subscription on step_runs (filtered to a workflow_run_id)
// for live step-by-step progress, including the paused state.
export const SUBSCRIBE_STEP_RUNS = gql`
  subscription SubscribeStepRuns($workflowRunId: uuid!) {
    step_runs(where: { workflow_run_id: { _eq: $workflowRunId } }, order_by: { started_at: asc }) {
      id
      workflow_step_id
      status
      input
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      finished_at
    }
  }
`;

export const GET_ORG_USAGE = gql`
  query GetOrgUsage($orgId: uuid!) {
    organizations_by_pk(id: $orgId) {
      id
      name
      quota_limit
      quota_used
    }
  }
`;

export const GET_MY_ROLE = gql`
  query GetMyRole($orgId: uuid!, $userId: uuid!) {
    org_members(where: { org_id: { _eq: $orgId }, user_id: { _eq: $userId } }, limit: 1) {
      role
    }
  }
`;

export const GET_ORG_MEMBERS = gql`
  query GetOrgMembers($orgId: uuid!) {
    org_members(where: { org_id: { _eq: $orgId } }) {
      id
      user_id
      role
    }
  }
`;
