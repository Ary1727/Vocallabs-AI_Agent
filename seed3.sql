INSERT INTO workflows (id, org_id, name, created_by) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111', 'Approval Test Workflow', 'cccccccc-cccc-cccc-cccc-cccccccccccc')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_steps (workflow_id, step_order, type, config) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 1, 'db_write', '{"fields": {"before_gate": true}}'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 2, 'approval_gate', '{"required_role": "owner"}'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 3, 'db_write', '{"fields": {"after_gate": true}}')
ON CONFLICT DO NOTHING;

SELECT id, name FROM workflows WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
