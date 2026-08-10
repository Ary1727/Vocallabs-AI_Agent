import { pool } from './db';

export const ORG_A = '11111111-1111-1111-1111-111111111111';
export const ORG_B = '22222222-2222-2222-2222-222222222222';
export const USER_A_OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const USER_A_VIEWER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab';
export const USER_B_OWNER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

export async function resetAndSeed() {
  await pool.query('truncate table workflow_results, step_runs, workflow_runs, workflow_triggers, workflow_steps, workflows, org_members, organizations, watched_events cascade');

  await pool.query(
    `insert into organizations (id, name, quota_limit, quota_used) values
     ($1, 'Org A', 1000, 0),
     ($2, 'Org B', 1000, 0)`,
    [ORG_A, ORG_B]
  );

  await pool.query(
    `insert into org_members (org_id, user_id, role) values
     ($1, $2, 'owner'),
     ($1, $3, 'viewer'),
     ($4, $5, 'owner')`,
    [ORG_A, USER_A_OWNER, USER_A_VIEWER, ORG_B, USER_B_OWNER]
  );
}

export async function closePool() {
  await pool.end();
}
