-- Detalles comprometidos en los mockups de Fase 1 (07 y 13): tipo de mensaje y lectura del cliente.
ALTER TABLE case_communications
  ADD COLUMN category varchar(20) NOT NULL DEFAULT 'STATUS_UPDATE'
    CHECK (category IN ('STATUS_UPDATE','HEARING_REMINDER','INFO_REQUEST')),
  ADD COLUMN read_at timestamptz;

-- Mensajes del abogado que el cliente aún no ha visto.
CREATE INDEX case_communications_unread
  ON case_communications(case_id) WHERE read_at IS NULL;

-- Línea de tiempo del cliente: movimientos confirmados por causa.
CREATE INDEX ingestion_items_case_confirmed
  ON ingestion_items(case_id, reviewed_at DESC) WHERE status = 'CONFIRMED';
