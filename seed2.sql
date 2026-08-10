INSERT INTO org_members (org_id, user_id, role) VALUES
  ('22222222-2222-2222-2222-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'owner')
ON CONFLICT (org_id, user_id) DO NOTHING;

SELECT org_id, user_id, role FROM org_members WHERE org_id = '22222222-2222-2222-2222-222222222222';
