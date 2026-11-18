-- Completa compromisos de Fase 1 que no dependen de proveedores externos.

-- HU-12 / DAS 8: urgencia del recordatorio y control de envío del aviso.
ALTER TABLE case_deadlines
  ADD COLUMN urgency varchar(10) NOT NULL DEFAULT 'Media'
    CHECK (urgency IN ('Alta','Media','Baja')),
  ADD COLUMN reminder_sent_at timestamptz;

CREATE INDEX case_deadlines_pending_reminders
  ON case_deadlines(reminder_at)
  WHERE reminder_sent_at IS NULL AND status = 'PENDING' AND reminder_at IS NOT NULL;

-- HU-19, HU-20, CU-02 y DAS 8.2: origen de la sugerencia, confianza, hora,
-- validación de formato y trazabilidad de la corrección del abogado.
ALTER TABLE ingestion_items
  ADD COLUMN suggestion_source varchar(10) NOT NULL DEFAULT 'REGLAS'
    CHECK (suggestion_source IN ('IA','REGLAS')),
  ADD COLUMN confidence varchar(10) NOT NULL DEFAULT 'BAJA'
    CHECK (confidence IN ('ALTA','MEDIA','BAJA')),
  ADD COLUMN detected_time time,
  ADD COLUMN format_recognized boolean NOT NULL DEFAULT true,
  ADD COLUMN missing_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN edited boolean NOT NULL DEFAULT false,
  ADD COLUMN original_suggestion jsonb;
