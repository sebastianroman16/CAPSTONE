-- Endurecimiento y ampliación del modelo de datos.
-- Mantiene compatibilidad con el MVP y agrega integridad, trazabilidad y
-- estructuras para el ciclo documental y operativo de una causa.

ALTER TABLE users
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_login_at timestamptz,
  ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0
    CHECK (failed_login_attempts >= 0),
  ADD COLUMN locked_until timestamptz;

ALTER TABLE sessions
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_seen_at timestamptz,
  ADD COLUMN revoked_at timestamptz,
  ADD CONSTRAINT sessions_revocation_after_creation
    CHECK (revoked_at IS NULL OR revoked_at >= created_at);

CREATE INDEX sessions_active_user
  ON sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (used_at IS NULL OR used_at >= created_at)
);
CREATE INDEX password_reset_tokens_active
  ON password_reset_tokens(user_id, expires_at DESC)
  WHERE used_at IS NULL;

CREATE TABLE lawyer_client_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lawyer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reason varchar(500),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (lawyer_id <> client_id),
  CHECK (ended_at IS NULL OR ended_at >= assigned_at)
);
CREATE UNIQUE INDEX lawyer_client_one_active_assignment
  ON lawyer_client_assignments(client_id)
  WHERE ended_at IS NULL;
CREATE INDEX lawyer_client_active_portfolio
  ON lawyer_client_assignments(lawyer_id, client_id)
  WHERE ended_at IS NULL;

INSERT INTO lawyer_client_assignments (lawyer_id, client_id, reason, assigned_at)
SELECT lawyer_id, id, 'Asignación migrada desde users.lawyer_id', created_at
FROM users
WHERE role = 'CLIENT' AND lawyer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION lex_validate_user_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  assigned_role varchar(10);
BEGIN
  IF NEW.role = 'CLIENT' THEN
    SELECT role INTO assigned_role FROM users WHERE id = NEW.lawyer_id;
    IF assigned_role IS DISTINCT FROM 'LAWYER' THEN
      RAISE EXCEPTION 'El abogado asignado debe existir y tener rol LAWYER'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.lawyer_id IS NOT NULL THEN
    RAISE EXCEPTION 'Solo un usuario CLIENT puede tener abogado asignado'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_validate_assignment
BEFORE INSERT OR UPDATE OF role, lawyer_id ON users
FOR EACH ROW EXECUTE FUNCTION lex_validate_user_assignment();

CREATE OR REPLACE FUNCTION lex_sync_client_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.role = 'CLIENT'
     AND (NEW.role IS DISTINCT FROM OLD.role
          OR NEW.lawyer_id IS DISTINCT FROM OLD.lawyer_id) THEN
    UPDATE lawyer_client_assignments
    SET ended_at = now()
    WHERE client_id = OLD.id AND ended_at IS NULL;
  END IF;

  IF NEW.role = 'CLIENT'
     AND (TG_OP = 'INSERT'
          OR NEW.role IS DISTINCT FROM OLD.role
          OR NEW.lawyer_id IS DISTINCT FROM OLD.lawyer_id) THEN
    INSERT INTO lawyer_client_assignments (lawyer_id, client_id, reason)
    SELECT NEW.lawyer_id, NEW.id, 'Asignación sincronizada desde usuario'
    WHERE NOT EXISTS (
      SELECT 1 FROM lawyer_client_assignments
      WHERE client_id = NEW.id AND lawyer_id = NEW.lawyer_id AND ended_at IS NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_sync_client_assignment
AFTER INSERT OR UPDATE OF role, lawyer_id ON users
FOR EACH ROW EXECUTE FUNCTION lex_sync_client_assignment();

CREATE OR REPLACE FUNCTION lex_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION lex_set_updated_at();

CREATE TRIGGER cases_set_updated_at
BEFORE UPDATE ON cases
FOR EACH ROW EXECUTE FUNCTION lex_set_updated_at();

CREATE OR REPLACE FUNCTION lex_validate_case_parties()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lawyer_role varchar(10);
  client_role varchar(10);
BEGIN
  SELECT role INTO lawyer_role FROM users WHERE id = NEW.lawyer_id;
  SELECT role INTO client_role FROM users WHERE id = NEW.client_id;

  IF lawyer_role IS DISTINCT FROM 'LAWYER' THEN
    RAISE EXCEPTION 'La causa requiere un abogado con rol LAWYER'
      USING ERRCODE = '23514';
  END IF;
  IF client_role IS DISTINCT FROM 'CLIENT' THEN
    RAISE EXCEPTION 'La causa requiere un cliente con rol CLIENT'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM lawyer_client_assignments
    WHERE lawyer_id = NEW.lawyer_id
      AND client_id = NEW.client_id
      AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'El cliente no está asignado al abogado responsable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cases_validate_parties
BEFORE INSERT OR UPDATE OF lawyer_id, client_id ON cases
FOR EACH ROW EXECUTE FUNCTION lex_validate_case_parties();

CREATE TABLE case_participants (
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  participant_role varchar(30) NOT NULL CHECK (
    participant_role IN ('RESPONSIBLE_LAWYER','COLLABORATING_LAWYER','CLIENT','OBSERVER')
  ),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id)
);
CREATE UNIQUE INDEX case_one_responsible_lawyer
  ON case_participants(case_id)
  WHERE participant_role = 'RESPONSIBLE_LAWYER';
CREATE UNIQUE INDEX case_one_primary_client
  ON case_participants(case_id)
  WHERE participant_role = 'CLIENT';
CREATE INDEX case_participants_by_user ON case_participants(user_id, case_id);

INSERT INTO case_participants (case_id, user_id, participant_role)
SELECT id, lawyer_id, 'RESPONSIBLE_LAWYER' FROM cases
UNION ALL
SELECT id, client_id, 'CLIENT' FROM cases;

CREATE OR REPLACE FUNCTION lex_sync_case_participants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM case_participants
  WHERE case_id = NEW.id
    AND participant_role IN ('RESPONSIBLE_LAWYER','CLIENT');

  INSERT INTO case_participants (case_id, user_id, participant_role)
  VALUES
    (NEW.id, NEW.lawyer_id, 'RESPONSIBLE_LAWYER'),
    (NEW.id, NEW.client_id, 'CLIENT');
  RETURN NEW;
END;
$$;

CREATE TRIGGER cases_sync_participants
AFTER INSERT OR UPDATE OF lawyer_id, client_id ON cases
FOR EACH ROW EXECUTE FUNCTION lex_sync_case_participants();

CREATE TABLE case_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  from_status varchar(20),
  to_status varchar(20) NOT NULL CHECK (to_status IN ('Activa','Archivada')),
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  case_version integer NOT NULL CHECK (case_version > 0),
  reason varchar(500),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_status_timeline
  ON case_status_history(case_id, changed_at DESC);

INSERT INTO case_status_history
  (case_id, from_status, to_status, changed_by, case_version, reason, changed_at)
SELECT id, NULL, status, lawyer_id, version, 'Estado migrado', created_at
FROM cases;

CREATE OR REPLACE FUNCTION lex_record_case_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO case_status_history
      (case_id, from_status, to_status, changed_by, case_version, reason)
    VALUES
      (NEW.id,
       CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
       NEW.status,
       NEW.lawyer_id,
       NEW.version,
       CASE WHEN TG_OP = 'INSERT' THEN 'Creación de causa' ELSE 'Cambio de estado' END);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cases_record_status
AFTER INSERT OR UPDATE OF status ON cases
FOR EACH ROW EXECUTE FUNCTION lex_record_case_status();

CREATE TABLE case_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  deadline_type varchar(20) NOT NULL CHECK (
    deadline_type IN ('HEARING','FILING','MEETING','REMINDER','OTHER')
  ),
  title varchar(200) NOT NULL,
  description varchar(2000),
  due_at timestamptz NOT NULL,
  reminder_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','COMPLETED','CANCELLED')
  ),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reminder_at IS NULL OR reminder_at <= due_at),
  CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL) OR
    (status <> 'COMPLETED' AND completed_at IS NULL)
  )
);
CREATE INDEX case_deadlines_agenda
  ON case_deadlines(due_at, case_id)
  WHERE status = 'PENDING';

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title varchar(250) NOT NULL,
  description varchar(2000),
  category varchar(30) NOT NULL CHECK (
    category IN ('PLEADING','EVIDENCE','CONTRACT','COURT_RESOLUTION','IDENTITY','OTHER')
  ),
  visibility varchar(20) NOT NULL DEFAULT 'INTERNAL' CHECK (
    visibility IN ('INTERNAL','CLIENT')
  ),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (
    status IN ('ACTIVE','ARCHIVED')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_case_catalog
  ON documents(case_id, status, created_at DESC);

CREATE TABLE document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  storage_key text UNIQUE NOT NULL,
  original_name varchar(255) NOT NULL,
  mime_type varchar(150) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 104857600),
  checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);
CREATE INDEX document_versions_timeline
  ON document_versions(document_id, version DESC);

CREATE TABLE document_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_to uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  fulfilled_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  title varchar(250) NOT NULL,
  description varchar(2000),
  due_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','IN_REVIEW','FULFILLED','CANCELLED')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'FULFILLED' AND fulfilled_document_id IS NOT NULL) OR
    (status <> 'FULFILLED' AND fulfilled_document_id IS NULL)
  )
);
CREATE INDEX document_requests_pending
  ON document_requests(assigned_to, due_at)
  WHERE status IN ('PENDING','IN_REVIEW');

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id uuid REFERENCES cases(id) ON DELETE CASCADE,
  notification_type varchar(30) NOT NULL CHECK (
    notification_type IN ('DEADLINE','DOCUMENT_REQUEST','CASE_UPDATE','SECURITY')
  ),
  title varchar(200) NOT NULL,
  body varchar(1000) NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (read_at IS NULL OR read_at >= created_at)
);
CREATE INDEX notifications_unread
  ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type varchar(50) NOT NULL,
  entity_id uuid NOT NULL,
  action varchar(10) NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_timeline
  ON audit_log(entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_log_actor_timeline
  ON audit_log(actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION lex_audit_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_record jsonb;
  new_record jsonb;
  target_id uuid;
  inferred_actor uuid;
BEGIN
  old_record := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  new_record := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;

  IF TG_TABLE_NAME = 'users' THEN
    old_record := old_record - 'password_hash';
    new_record := new_record - 'password_hash';
  ELSIF TG_TABLE_NAME = 'cases' THEN
    old_record := old_record - 'internal_notes';
    new_record := new_record - 'internal_notes';
    inferred_actor := CASE WHEN TG_OP = 'DELETE' THEN OLD.lawyer_id ELSE NEW.lawyer_id END;
  ELSIF TG_TABLE_NAME = 'documents' THEN
    inferred_actor := CASE WHEN TG_OP = 'DELETE' THEN OLD.created_by ELSE NEW.created_by END;
  END IF;

  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  INSERT INTO audit_log
    (actor_id, entity_type, entity_id, action, old_data, new_data)
  VALUES
    (inferred_actor, TG_TABLE_NAME, target_id, TG_OP, old_record, new_record);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_users
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION lex_audit_change();

CREATE TRIGGER audit_cases
AFTER INSERT OR UPDATE OR DELETE ON cases
FOR EACH ROW EXECUTE FUNCTION lex_audit_change();

CREATE TRIGGER audit_documents
AFTER INSERT OR UPDATE OR DELETE ON documents
FOR EACH ROW EXECUTE FUNCTION lex_audit_change();

CREATE TRIGGER deadlines_set_updated_at
BEFORE UPDATE ON case_deadlines
FOR EACH ROW EXECUTE FUNCTION lex_set_updated_at();

CREATE TRIGGER documents_set_updated_at
BEFORE UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION lex_set_updated_at();

CREATE TRIGGER document_requests_set_updated_at
BEFORE UPDATE ON document_requests
FOR EACH ROW EXECUTE FUNCTION lex_set_updated_at();
