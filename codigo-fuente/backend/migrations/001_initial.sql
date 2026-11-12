CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  email varchar(254) UNIQUE NOT NULL CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role varchar(10) NOT NULL CHECK (role IN ('LAWYER','CLIENT')),
  lawyer_id uuid REFERENCES users(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role='LAWYER' AND lawyer_id IS NULL) OR (role='CLIENT' AND lawyer_id IS NOT NULL))
);
CREATE TABLE sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE SEQUENCE case_reference_seq;
CREATE TABLE cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE NOT NULL DEFAULT ('LC-' || nextval('case_reference_seq')::text),
  lawyer_id uuid NOT NULL REFERENCES users(id),
  client_id uuid NOT NULL REFERENCES users(id),
  rit varchar(50), title varchar(200) NOT NULL,
  matter varchar(20) NOT NULL CHECK (matter IN ('Familia','Laboral','Civil','Penal')),
  court varchar(200) NOT NULL,
  priority varchar(10) NOT NULL CHECK (priority IN ('Alta','Media','Baja')),
  status varchar(20) NOT NULL DEFAULT 'Activa' CHECK (status IN ('Activa','Archivada')),
  next_date date, next_date_label varchar(200), internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cases_lawyer ON cases(lawyer_id);
CREATE INDEX cases_client ON cases(client_id);
