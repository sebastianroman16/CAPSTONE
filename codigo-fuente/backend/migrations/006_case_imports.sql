CREATE TABLE case_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lawyer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_filename varchar(255) NOT NULL,
  worksheet_name varchar(100) NOT NULL,
  headers jsonb NOT NULL,
  rows jsonb NOT NULL,
  mapping jsonb,
  status varchar(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','VALIDATED','IMPORTED')),
  total_rows integer NOT NULL CHECK (total_rows BETWEEN 1 AND 500),
  imported_rows integer CHECK (imported_rows BETWEEN 0 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  imported_at timestamptz,
  CHECK (jsonb_typeof(headers)='array'),
  CHECK (jsonb_typeof(rows)='array'),
  CHECK (mapping IS NULL OR jsonb_typeof(mapping)='object'),
  CHECK (expires_at > created_at)
);

CREATE INDEX case_import_batches_owner
  ON case_import_batches(lawyer_id, created_at DESC);
CREATE INDEX case_import_batches_expiry
  ON case_import_batches(expires_at)
  WHERE status <> 'IMPORTED';
