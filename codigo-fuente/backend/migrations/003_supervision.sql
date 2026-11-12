ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users DROP CONSTRAINT users_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('LAWYER','CLIENT','SUPERVISOR'));
ALTER TABLE users ADD CONSTRAINT users_role_assignment_check CHECK (
  (role IN ('LAWYER','SUPERVISOR') AND lawyer_id IS NULL) OR
  (role='CLIENT' AND lawyer_id IS NOT NULL)
);

ALTER TABLE cases
  ADD COLUMN progress_stage varchar(20) NOT NULL DEFAULT 'NOT_REPORTED'
    CHECK (progress_stage IN ('NOT_REPORTED','ASSESSMENT','PREPARATION','IN_PROGRESS','FOLLOW_UP','COMPLETED')),
  ADD COLUMN progress_summary varchar(2000),
  ADD COLUMN next_action varchar(1000),
  ADD COLUMN progress_updated_at timestamptz;

CREATE TABLE case_progress_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  case_version integer NOT NULL,
  stage varchar(20) NOT NULL CHECK (stage IN ('ASSESSMENT','PREPARATION','IN_PROGRESS','FOLLOW_UP','COMPLETED')),
  summary varchar(2000) NOT NULL,
  next_action varchar(1000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, case_version)
);
CREATE INDEX case_progress_history ON case_progress_events(case_id, case_version DESC);
CREATE INDEX cases_progress_followup ON cases(progress_updated_at) WHERE status='Activa';
