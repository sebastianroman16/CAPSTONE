import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(1222026)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const applied = await client.query(
      "SELECT 1 FROM schema_migrations WHERE name=$1",
      [file],
    );
    if (applied.rowCount) continue;
    await client.query(await readFile(new URL(file, dir), "utf8"));
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
      file,
    ]);
    console.log(`Aplicada: ${file}`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
