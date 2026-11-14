-- Completa los flujos funcionales que antes existían solo como diseño o tablas base.
ALTER TABLE users
  ADD COLUMN phone varchar(30),
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE notifications
  ADD COLUMN channel varchar(20) NOT NULL DEFAULT 'IN_APP'
    CHECK (channel IN ('IN_APP','EMAIL','WHATSAPP')),
  ADD COLUMN delivery_status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_status IN ('PENDING','DELIVERED','FAILED')),
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN delivery_error varchar(500);

CREATE TABLE case_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message varchar(2000) NOT NULL,
  channel varchar(20) NOT NULL DEFAULT 'IN_APP'
    CHECK (channel IN ('IN_APP','EMAIL','WHATSAPP')),
  delivery_status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_status IN ('PENDING','DELIVERED','FAILED')),
  delivery_error varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_communications_timeline
  ON case_communications(case_id, created_at DESC);

CREATE TABLE ingestion_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lawyer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id uuid REFERENCES cases(id) ON DELETE SET NULL,
  source_type varchar(20) NOT NULL
    CHECK (source_type IN ('EMAIL','PDF','EXCEL','TEXT')),
  source_name varchar(255) NOT NULL,
  source_text text NOT NULL,
  detected_reference varchar(100),
  detected_date date,
  detected_court varchar(200),
  movement_type varchar(100),
  suggested_summary varchar(2000) NOT NULL,
  corrected_summary varchar(2000),
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','CONFIRMED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CHECK ((status='PENDING' AND reviewed_at IS NULL) OR status<>'PENDING')
);
CREATE INDEX ingestion_owner_queue
  ON ingestion_items(lawyer_id, status, created_at DESC);
