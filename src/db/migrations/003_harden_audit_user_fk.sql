ALTER TABLE audit_events
  DROP CONSTRAINT IF EXISTS audit_events_actor_user_id_fkey;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT;
