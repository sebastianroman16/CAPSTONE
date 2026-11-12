-- La versión se comprueba en la misma sentencia que modifica la causa.
ALTER TABLE cases ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
