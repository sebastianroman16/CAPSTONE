-- Todas las sesiones pasan a tener una marca de actividad explícita. El backend
-- la usa para impedir que una pestaña manipulada reactive una sesión inactiva.
UPDATE sessions SET last_seen_at = created_at WHERE last_seen_at IS NULL;

ALTER TABLE sessions
  ALTER COLUMN last_seen_at SET DEFAULT now(),
  ALTER COLUMN last_seen_at SET NOT NULL,
  ADD CONSTRAINT sessions_activity_after_creation
    CHECK (last_seen_at >= created_at);

CREATE INDEX sessions_idle_cleanup
  ON sessions(last_seen_at)
  WHERE revoked_at IS NULL;
