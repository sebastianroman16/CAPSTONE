-- Permite que un cliente participe en causas administradas por más de un abogado.
DROP INDEX IF EXISTS lawyer_client_one_active_assignment;
CREATE UNIQUE INDEX lawyer_client_active_pair
  ON lawyer_client_assignments(lawyer_id, client_id)
  WHERE ended_at IS NULL;

ALTER TABLE users ADD COLUMN office varchar(120);

CREATE INDEX users_role_active ON users(role, active, name);

CREATE TABLE case_reassignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  from_lawyer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  to_lawyer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason varchar(500) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_lawyer_id <> to_lawyer_id)
);
CREATE INDEX case_reassignments_timeline ON case_reassignments(case_id,created_at DESC);
