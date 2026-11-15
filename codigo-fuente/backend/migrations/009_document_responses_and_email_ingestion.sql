-- Trazabilidad de respuestas documentales e idempotencia de correos entrantes.
ALTER TABLE document_requests
  ADD COLUMN responded_at timestamptz;

UPDATE document_requests
SET responded_at = created_at
WHERE status = 'FULFILLED' AND responded_at IS NULL;

ALTER TABLE ingestion_items
  ADD COLUMN external_message_id varchar(255);

CREATE UNIQUE INDEX ingestion_external_message_once
  ON ingestion_items(lawyer_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
