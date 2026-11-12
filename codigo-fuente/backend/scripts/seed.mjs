import "dotenv/config";
import pg from "pg";
import { randomBytes, scryptSync } from "node:crypto";
if (process.env.NODE_ENV === "production")
  throw new Error("Seed deshabilitado en producción.");
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 12)
  throw new Error("Define SEED_PASSWORD con al menos 12 caracteres.");
if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL");
const salt = randomBytes(16).toString("hex");
const hash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  const lawyerId = "11111111-1111-4111-8111-111111111111";
  const clientId = "22222222-2222-4222-8222-222222222222";
  await db.query(
    `INSERT INTO users (id,name,email,password_hash,role) VALUES ('44444444-4444-4444-8444-444444444444','Coordinador jurídico de demostración','coordinador@example.test',$1,'SUPERVISOR') ON CONFLICT DO NOTHING`,
    [hash],
  );
  await db.query(
    `INSERT INTO users (id,name,email,password_hash,role) VALUES ($1,'Abogado de demostración','abogado@example.test',$2,'LAWYER') ON CONFLICT DO NOTHING`,
    [lawyerId, hash],
  );
  await db.query(
    `INSERT INTO users (id,name,email,password_hash,role,lawyer_id) VALUES ($1,'Cliente de demostración','cliente@example.test',$2,'CLIENT',$3) ON CONFLICT DO NOTHING`,
    [clientId, hash, lawyerId],
  );
  await db.query(
    `INSERT INTO cases (id,lawyer_id,client_id,title,matter,court,priority,next_date,next_date_label,internal_notes)
    VALUES ('33333333-3333-4333-8333-333333333333',$1,$2,'Pensión de alimentos — caso ficticio','Familia','Juzgado de Familia de demostración','Alta',current_date+7,'Audiencia de demostración','Nota privada de prueba; nunca visible al cliente.') ON CONFLICT DO NOTHING`,
    [lawyerId, clientId],
  );
  await db.query("COMMIT");
  console.log(
    "Datos ficticios disponibles: abogado@example.test, cliente@example.test y coordinador@example.test. Clave: la configurada en SEED_PASSWORD. No se modifican usuarios existentes.",
  );
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
