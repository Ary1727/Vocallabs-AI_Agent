INSERT INTO org_members (org_id, user_id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'owner')
ON CONFLICT (org_id, user_id) DO NOTHING;

INSERT INTO workflows (id, org_id, name, created_by) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'Test Workflow', 'cccccccc-cccc-cccc-cccc-cccccccccccc')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_steps (workflow_id, step_order, type, config) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 1, 'llm_call', '{"prompt": "Summarize this test"}'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 2, 'db_write', '{"fields": {"test": true}}')
ON CONFLICT DO NOTHING;

SELECT id, name FROM workflows;
