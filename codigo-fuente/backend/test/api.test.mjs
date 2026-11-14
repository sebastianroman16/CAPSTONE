import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import ExcelJS from "exceljs";
import { hashPassword, verifyPassword } from "../dist/auth/password.js";

const schema = `lex_test_${randomBytes(6).toString("hex")}`;
const connection = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!connection)
  throw new Error(
    "Configura TEST_DATABASE_URL o DATABASE_URL para las pruebas de integración.",
  );
const admin = new pg.Client({ connectionString: connection });
const url = new URL(connection);
url.searchParams.set("options", `-csearch_path=${schema},public`);
const testUrl = url.toString();
const db = new pg.Client({ connectionString: testUrl });
const password = randomBytes(18).toString("hex");
const port = 31379;
const base = `http://127.0.0.1:${port}/api`;
let server,
  output = "",
  lawyerCookie,
  clientCookie,
  otherCookie,
  supervisorCookie,
  created;
let connected = false,
  schemaCreated = false;
const lawyerId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const otherId = randomUUID(),
  otherClientId = randomUUID();
const payload = {
  title: "Causa creada por prueba",
  clientId,
  matter: "Civil",
  court: "Tribunal de prueba",
  priority: "Alta",
  internalNotes: "SECRETO INTERNO",
  nextDate: "2026-12-20",
};
async function request(path, method = "GET", body, cookie, origin) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json();
  return {
    status: response.status,
    json,
    cookie: response.headers.get("set-cookie"),
    headers: response.headers,
  };
}
async function uploadRequest(path, buffer, cookie, filename = "causas.xlsx") {
  const body = new FormData();
  body.append(
    "file",
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
  const response = await fetch(base + path, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body,
  });
  return { status: response.status, json: await response.json() };
}
async function workbookBuffer(headers, rows, formula = false) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Causas");
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  if (formula) sheet.getCell("A2").value = { formula: 'HYPERLINK("https://example.test")' };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
describe("API real con PostgreSQL y esquema aislado", () => {
  before(
    async () => {
      await admin.connect();
      connected = true;
      await admin.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      const env = {
        ...process.env,
        DATABASE_URL: testUrl,
        SEED_PASSWORD: password,
        NODE_ENV: "test",
        PORT: String(port),
        FRONTEND_ORIGIN: "http://localhost:4200",
      };
      execFileSync(process.execPath, ["scripts/migrate.mjs"], { env });
      execFileSync(process.execPath, ["scripts/migrate.mjs"], { env });
      execFileSync(process.execPath, ["scripts/seed.mjs"], { env });
      await db.connect();
      const hash = await hashPassword(password);
      await db.query(
        "INSERT INTO users (id,name,email,password_hash,role) VALUES ($1,'Otro abogado','otro@example.test',$2,'LAWYER')",
        [otherId, hash],
      );
      await db.query(
        "INSERT INTO users (id,name,email,password_hash,role,lawyer_id) VALUES ($1,'Otro cliente','otro-cliente@example.test',$2,'CLIENT',$3)",
        [otherClientId, hash, otherId],
      );
      server = spawn(process.execPath, ["dist/main.js"], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      server.stdout.on("data", (data) => (output += data));
      server.stderr.on("data", (data) => (output += data));
      let ready = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        if (server.exitCode !== null) throw new Error(output);
        try {
          const result = await request("/health");
          if (result.status === 200) {
            ready = true;
            break;
          }
        } catch {}
        await delay(100);
      }
      if (!ready) throw new Error(`API no inició: ${output}`);
      for (const [email, set] of [
        ["abogado@example.test", (v) => (lawyerCookie = v)],
        ["cliente@example.test", (v) => (clientCookie = v)],
        ["otro@example.test", (v) => (otherCookie = v)],
        ["coordinador@example.test", (v) => (supervisorCookie = v)],
      ]) {
        const result = await request("/auth/login", "POST", {
          email,
          password,
        });
        assert.equal(result.status, 201);
        assert.match(result.cookie, /HttpOnly/);
        assert.match(result.cookie, /SameSite=Strict/);
        set(result.cookie.split(";")[0]);
      }
    },
    { timeout: 30000 },
  );
  after(async () => {
    if (server && server.exitCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await exited;
    }
    await db.end().catch(() => {});
    if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    if (connected) await admin.end();
  });
  it("rechaza acceso anónimo y contraseñas incorrectas", async () => {
    assert.equal((await request("/cases")).status, 401);
    assert.equal(
      (
        await request("/auth/login", "POST", {
          email: "abogado@example.test",
          password: "incorrecta",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/auth/login", "POST", {
          email: "inexistente@example.test",
          password: "incorrecta",
        })
      ).status,
      401,
    );
  });
  it("recupera la sesión sin exponer hash ni token", async () => {
    const result = await request("/auth/me", "GET", undefined, lawyerCookie);
    assert.equal(result.status, 200);
    assert.equal(result.json.role, "LAWYER");
    assert.deepEqual(Object.keys(result.json).sort(), [
      "email",
      "id",
      "mustChangePassword",
      "name",
      "phone",
      "role",
    ]);
  });
  it("renueva actividad en servidor y rechaza sesiones inactivas", async () => {
    const login = await request("/auth/login", "POST", {
      email: "otro@example.test",
      password,
    });
    const cookie = login.cookie.split(";")[0];
    const token = cookie.slice(cookie.indexOf("=") + 1);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await db.query(
      `UPDATE sessions
       SET created_at=now()-interval '5 minutes',
           last_seen_at=now()-interval '1 minute'
       WHERE token_hash=$1`,
      [tokenHash],
    );
    const extended = await request(
      "/auth/extend",
      "POST",
      undefined,
      cookie,
    );
    assert.equal(extended.status, 201);
    const activity = await db.query(
      "SELECT last_seen_at > now()-interval '5 seconds' AS fresh FROM sessions WHERE token_hash=$1",
      [tokenHash],
    );
    assert.equal(activity.rows[0].fresh, true);
    await db.query(
      "UPDATE sessions SET last_seen_at=now()-interval '4 minutes' WHERE token_hash=$1",
      [tokenHash],
    );
    assert.equal(
      (await request("/auth/me", "GET", undefined, cookie)).status,
      401,
    );
  });
  it("registra intentos fallidos y restablece el bloqueo al autenticar", async () => {
    const failed = await db.query(
      "SELECT failed_login_attempts FROM users WHERE id=$1",
      [lawyerId],
    );
    assert.equal(failed.rows[0].failed_login_attempts, 1);
    assert.equal(
      (
        await request("/auth/login", "POST", {
          email: "abogado@example.test",
          password,
        })
      ).status,
      201,
    );
    const restored = await db.query(
      "SELECT failed_login_attempts,last_login_at FROM users WHERE id=$1",
      [lawyerId],
    );
    assert.equal(restored.rows[0].failed_login_attempts, 0);
    assert.ok(restored.rows[0].last_login_at);
  });
  it("crea y persiste una causa con referencia generada en servidor", async () => {
    const result = await request("/cases", "POST", payload, lawyerCookie);
    assert.equal(result.status, 201);
    assert.match(result.json.reference, /^LC-/);
    created = result.json.id;
    assert.equal(result.json.internalNotes, "SECRETO INTERNO");
    const persisted = await db.query("SELECT title FROM cases WHERE id=$1", [
      created,
    ]);
    assert.equal(persisted.rows[0].title, payload.title);
  });
  it("no filtra notas internas al cliente en lista ni detalle", async () => {
    for (const path of ["/cases", `/cases/${created}`]) {
      const result = await request(path, "GET", undefined, clientCookie);
      assert.equal(result.status, 200);
      assert.ok(!JSON.stringify(result.json).includes("internalNotes"));
      assert.ok(!JSON.stringify(result.json).includes("SECRETO INTERNO"));
    }
  });
  it("bloquea crear, editar y archivar como cliente", async () => {
    for (const [method, path, body] of [
      ["POST", "/cases", payload],
      ["PUT", `/cases/${created}`, { ...payload, version: 1 }],
      ["PATCH", `/cases/${created}/archive`, { version: 1 }],
    ]) {
      assert.equal(
        (await request(path, method, body, clientCookie)).status,
        403,
      );
    }
  });
  it("aísla la cartera de abogados y la de clientes", async () => {
    assert.deepEqual(
      (await request("/cases", "GET", undefined, otherCookie)).json,
      [],
    );
    for (const [method, path, body] of [
      ["GET", `/cases/${created}`, undefined],
      ["PUT", `/cases/${created}`, { ...payload, version: 1 }],
      ["PATCH", `/cases/${created}/archive`, { version: 1 }],
    ]) {
      assert.equal(
        (await request(path, method, body, otherCookie)).status,
        404,
      );
    }
    const login = await request("/auth/login", "POST", {
      email: "otro-cliente@example.test",
      password,
    });
    const cookie = login.cookie.split(";")[0];
    assert.deepEqual(
      (await request("/cases", "GET", undefined, cookie)).json,
      [],
    );
    assert.equal(
      (await request(`/cases/${created}`, "GET", undefined, cookie)).status,
      404,
    );
    assert.equal(
      (await request("/users/clients", "GET", undefined, clientCookie)).status,
      403,
    );
  });
  it("importa desde Excel solo filas válidas y conserva el aislamiento", async () => {
    const headers = [
      "Correo cliente*",
      "Carátula*",
      "RIT",
      "Materia*",
      "Tribunal*",
      "Prioridad*",
      "Próxima fecha",
      "Descripción fecha",
      "Notas internas",
    ];
    const rows = [
      [
        "cliente@example.test",
        "Cobro importado",
        "C-IMPORT-2026",
        "Civil",
        "1° Juzgado Civil",
        "Alta",
        "2026-11-20",
        "Audiencia",
        "Dato reservado importado",
      ],
      [
        "cliente@example.test",
        "Cobro repetido",
        "C-IMPORT-2026",
        "Civil",
        "1° Juzgado Civil",
        "Media",
        null,
        null,
        null,
      ],
      [
        "otro-cliente@example.test",
        "Cliente ajeno",
        "C-AJENA-2026",
        "Laboral",
        "Juzgado Laboral",
        "Baja",
        null,
        null,
        null,
      ],
    ];
    const uploaded = await uploadRequest(
      "/case-imports",
      await workbookBuffer(headers, rows),
      lawyerCookie,
    );
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.json.totalRows, 3);
    assert.equal(uploaded.json.suggestedMapping.clientEmail, 0);
    assert.equal(uploaded.json.suggestedMapping.title, 1);

    const mapping = {
      clientEmail: 0,
      title: 1,
      rit: 2,
      matter: 3,
      court: 4,
      priority: 5,
      nextDate: 6,
      nextDateLabel: 7,
      internalNotes: 8,
    };
    const preview = await request(
      `/case-imports/${uploaded.json.id}/validate`,
      "POST",
      { mapping },
      lawyerCookie,
    );
    assert.equal(preview.status, 201);
    assert.deepEqual(preview.json.summary, { total: 3, valid: 1, duplicates: 1, errors: 1 });
    assert.equal(
      (await request(`/case-imports/${uploaded.json.id}/validate`, "POST", { mapping }, otherCookie)).status,
      404,
    );

    const confirmed = await request(
      `/case-imports/${uploaded.json.id}/confirm`,
      "POST",
      undefined,
      lawyerCookie,
    );
    assert.equal(confirmed.status, 201);
    assert.equal(confirmed.json.imported, 1);
    assert.equal(confirmed.json.omitted, 2);
    assert.equal(
      (await request(`/case-imports/${uploaded.json.id}/confirm`, "POST", undefined, lawyerCookie)).status,
      409,
    );
    const persisted = await db.query(
      "SELECT lawyer_id,client_id FROM cases WHERE rit='C-IMPORT-2026'",
    );
    assert.equal(persisted.rowCount, 1);
    assert.equal(persisted.rows[0].lawyer_id, lawyerId);
    assert.equal(persisted.rows[0].client_id, clientId);
  });
  it("protege la carga Excel por rol, tipo de archivo y contenido", async () => {
    const headers = ["Correo cliente*", "Carátula*", "Materia*", "Tribunal*", "Prioridad*"];
    const rows = [["cliente@example.test", "Prueba", "Civil", "Tribunal", "Media"]];
    const valid = await workbookBuffer(headers, rows);
    assert.equal((await uploadRequest("/case-imports", valid, clientCookie)).status, 403);
    assert.equal((await uploadRequest("/case-imports", valid, lawyerCookie, "causas.xlsm")).status, 400);
    assert.equal(
      (await uploadRequest("/case-imports", await workbookBuffer(headers, rows, true), lawyerCookie)).status,
      400,
    );
  });
  it("rechaza clientes ajenos, campos no autorizados y fechas imposibles", async () => {
    for (const body of [
      { ...payload, clientId: otherClientId },
      { ...payload, lawyerId: otherId },
      { ...payload, nextDate: "2026-02-30" },
      { ...payload, title: "   " },
      { ...payload, priority: "Urgente" },
    ]) {
      assert.equal(
        (await request("/cases", "POST", body, lawyerCookie)).status,
        400,
      );
    }
    assert.equal(
      (await request("/cases/no-es-uuid", "GET", undefined, lawyerCookie))
        .status,
      400,
    );
  });
  it("edita sin cambiar la referencia ni ejecutar SQL en los campos", async () => {
    const before = (
      await request(`/cases/${created}`, "GET", undefined, lawyerCookie)
    ).json;
    const title = "Prueba '; DROP TABLE cases; --";
    const result = await request(
      `/cases/${created}`,
      "PUT",
      { ...payload, title, version: before.version },
      lawyerCookie,
    );
    assert.equal(result.status, 200);
    assert.equal(result.json.title, title);
    assert.equal(result.json.reference, before.reference);
    assert.ok((await db.query("SELECT count(*) FROM cases")).rows[0].count > 0);
  });
  it("archiva sin borrar datos", async () => {
    const before = (
      await request(`/cases/${created}`, "GET", undefined, lawyerCookie)
    ).json;
    const result = await request(
      `/cases/${created}/archive`,
      "PATCH",
      { version: before.version },
      lawyerCookie,
    );
    assert.equal(result.status, 200);
    assert.equal(result.json.status, "Archivada");
    assert.equal(
      (await request(`/cases/${created}`, "GET", undefined, clientCookie)).json
        .status,
      "Archivada",
    );
  });
  it("mantiene participantes, historial de estado y auditoría sin datos sensibles", async () => {
    const participants = await db.query(
      `SELECT participant_role FROM case_participants
       WHERE case_id=$1 ORDER BY participant_role`,
      [created],
    );
    assert.deepEqual(
      participants.rows.map((row) => row.participant_role),
      ["CLIENT", "RESPONSIBLE_LAWYER"],
    );
    const history = await db.query(
      `SELECT from_status,to_status,changed_by FROM case_status_history
       WHERE case_id=$1 ORDER BY changed_at,id`,
      [created],
    );
    assert.equal(history.rows[0].from_status, null);
    assert.equal(history.rows.at(-1).to_status, "Archivada");
    assert.equal(history.rows.at(-1).changed_by, lawyerId);

    const caseAudit = await db.query(
      `SELECT new_data FROM audit_log
       WHERE entity_type='cases' AND entity_id=$1 AND action='INSERT' LIMIT 1`,
      [created],
    );
    assert.equal("internal_notes" in caseAudit.rows[0].new_data, false);
    const userAudit = await db.query(
      `SELECT new_data FROM audit_log
       WHERE entity_type='users' AND entity_id=$1 AND action='INSERT' LIMIT 1`,
      [lawyerId],
    );
    assert.equal("password_hash" in userAudit.rows[0].new_data, false);
  });
  it("impide relaciones jurídicas inválidas incluso fuera de la API", async () => {
    const assignment = await db.query(
      `SELECT lawyer_id FROM lawyer_client_assignments
       WHERE client_id=$1 AND ended_at IS NULL`,
      [otherClientId],
    );
    assert.equal(assignment.rows[0].lawyer_id, otherId);
    await assert.rejects(
      db.query(
        `INSERT INTO cases(lawyer_id,client_id,title,matter,court,priority)
         VALUES($1,$2,'Relación inválida','Civil','Tribunal','Media')`,
        [lawyerId, otherClientId],
      ),
      (error) => error.code === "23514",
    );
    const supervisor = await db.query(
      "SELECT id FROM users WHERE role='SUPERVISOR' LIMIT 1",
    );
    await assert.rejects(
      db.query(
        `INSERT INTO users(name,email,password_hash,role,lawyer_id)
         VALUES('Cliente inválido','cliente-invalido@example.test','unused','CLIENT',$1)`,
        [supervisor.rows[0].id],
      ),
      (error) => error.code === "23514",
    );
  });
  it("persiste plazos, solicitudes y documentos con versiones verificables", async () => {
    const deadline = await db.query(
      `INSERT INTO case_deadlines
       (case_id,created_by,deadline_type,title,due_at,reminder_at)
       VALUES($1,$2,'FILING','Presentar escrito','2027-01-20T15:00:00Z','2027-01-19T15:00:00Z')
       RETURNING id,status`,
      [created, lawyerId],
    );
    assert.equal(deadline.rows[0].status, "PENDING");
    const document = await db.query(
      `INSERT INTO documents(case_id,created_by,title,category,visibility)
       VALUES($1,$2,'Demanda principal','PLEADING','CLIENT') RETURNING id`,
      [created, lawyerId],
    );
    const documentId = document.rows[0].id;
    await db.query(
      `INSERT INTO document_versions
       (document_id,version,storage_key,original_name,mime_type,size_bytes,checksum_sha256,uploaded_by)
       VALUES($1,1,$2,'demanda.pdf','application/pdf',2048,$3,$4)`,
      [documentId, `cases/${created}/demanda-v1.pdf`, "a".repeat(64), lawyerId],
    );
    const requestResult = await db.query(
      `INSERT INTO document_requests(case_id,requested_by,assigned_to,title,due_at)
       VALUES($1,$2,$3,'Cédula de identidad','2027-01-15T20:00:00Z')
       RETURNING status`,
      [created, lawyerId, clientId],
    );
    assert.equal(requestResult.rows[0].status, "PENDING");
    await assert.rejects(
      db.query(
        `INSERT INTO document_versions
         (document_id,version,storage_key,original_name,mime_type,size_bytes,checksum_sha256,uploaded_by)
         VALUES($1,1,$2,'duplicado.pdf','application/pdf',100,$3,$4)`,
        [documentId, `cases/${created}/duplicado.pdf`, "b".repeat(64), lawyerId],
      ),
      (error) => error.code === "23505",
    );
    const audit = await db.query(
      `SELECT actor_id FROM audit_log
       WHERE entity_type='documents' AND entity_id=$1 AND action='INSERT'`,
      [documentId],
    );
    assert.equal(audit.rows[0].actor_id, lawyerId);
  });

  it("rechaza una edición obsoleta sin modificar datos ni versión", async () => {
    const created = await request("/cases", "POST", payload, lawyerCookie);
    const id = created.json.id;
    assert.equal(created.json.version, 1);
    const first = await request(
      `/cases/${id}`,
      "PUT",
      { ...payload, title: "Cambio más reciente", version: 1 },
      lawyerCookie,
    );
    assert.equal(first.status, 200);
    assert.equal(first.json.version, 2);
    const stale = await request(
      `/cases/${id}`,
      "PUT",
      { ...payload, title: "Cambio obsoleto", version: 1 },
      lawyerCookie,
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, "CASE_VERSION_CONFLICT");
    const final = (
      await request(`/cases/${id}`, "GET", undefined, lawyerCookie)
    ).json;
    assert.equal(final.title, "Cambio más reciente");
    assert.equal(final.version, 2);
  });
  it("acepta exactamente uno de dos guardados simultáneos", async () => {
    const created = await request("/cases", "POST", payload, lawyerCookie);
    const id = created.json.id;
    const results = await Promise.all(
      ["Pestaña A", "Pestaña B"].map((title) =>
        request(
          `/cases/${id}`,
          "PUT",
          { ...payload, title, version: 1 },
          lawyerCookie,
        ),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const final = (
      await request(`/cases/${id}`, "GET", undefined, lawyerCookie)
    ).json;
    assert.equal(final.version, 2);
    assert.equal(final.title, results.find((r) => r.status === 200).json.title);
  });
  it("requiere versión entera positiva para editar y archivar", async () => {
    const created = await request("/cases", "POST", payload, lawyerCookie);
    for (const version of [undefined, null, 0, -1, 1.5, "1"]) {
      assert.equal(
        (
          await request(
            `/cases/${created.json.id}`,
            "PUT",
            { ...payload, version },
            lawyerCookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            `/cases/${created.json.id}/archive`,
            "PATCH",
            { version },
            lawyerCookie,
          )
        ).status,
        400,
      );
    }
  });
  it("impide archivo obsoleto y edición con datos previos al archivo", async () => {
    const created = await request("/cases", "POST", payload, lawyerCookie);
    const id = created.json.id;
    await request(
      `/cases/${id}`,
      "PUT",
      { ...payload, title: "Antes de archivar", version: 1 },
      lawyerCookie,
    );
    assert.equal(
      (
        await request(
          `/cases/${id}/archive`,
          "PATCH",
          { version: 1 },
          lawyerCookie,
        )
      ).status,
      409,
    );
    const archived = await request(
      `/cases/${id}/archive`,
      "PATCH",
      { version: 2 },
      lawyerCookie,
    );
    assert.equal(archived.status, 200);
    assert.equal(archived.json.version, 3);
    assert.equal(
      (
        await request(
          `/cases/${id}`,
          "PUT",
          { ...payload, version: 2 },
          lawyerCookie,
        )
      ).status,
      409,
    );
    const final = (
      await request(`/cases/${id}`, "GET", undefined, lawyerCookie)
    ).json;
    assert.equal(final.status, "Archivada");
    assert.equal(final.title, "Antes de archivar");
    assert.equal(final.version, 3);
  });
  it("permite volver a guardar tras consultar la versión actual", async () => {
    const current = (
      await request(`/cases/${created}`, "GET", undefined, lawyerCookie)
    ).json;
    const result = await request(
      `/cases/${created}`,
      "PUT",
      { ...payload, version: current.version },
      lawyerCookie,
    );
    assert.equal(result.status, 200);
    assert.equal(result.json.version, current.version + 1);
  });
  it("rechaza mutaciones desde un origen web ajeno", async () => {
    assert.equal(
      (
        await request(
          "/cases",
          "POST",
          payload,
          lawyerCookie,
          "https://otro.example",
        )
      ).status,
      403,
    );
  });
  it("reserva la supervisión al coordinador incluso por acceso directo a la API", async () => {
    assert.equal((await request("/supervision")).status, 401);
    for (const cookie of [lawyerCookie, clientCookie, otherCookie]) {
      for (const path of ["/supervision", `/supervision/cases/${created}`]) {
        assert.equal(
          (await request(path, "GET", undefined, cookie)).status,
          403,
        );
      }
    }
    const me = await request("/auth/me", "GET", undefined, supervisorCookie);
    assert.equal(me.json.role, "SUPERVISOR");
    for (const [path, method, body] of [
      ["/cases", "POST", payload],
      [`/cases/${created}`, "PUT", { ...payload, version: 1 }],
      [`/cases/${created}/archive`, "PATCH", { version: 1 }],
      [
        `/cases/${created}/progress`,
        "PATCH",
        {
          version: 1,
          stage: "ASSESSMENT",
          summary: "Avance de prueba",
          nextAction: "",
        },
      ],
    ])
      assert.equal(
        (await request(path, method, body, supervisorCookie)).status,
        403,
      );
  });
  it("muestra causas de distintos abogados sin notas privadas ni credenciales", async () => {
    await db.query(
      `INSERT INTO cases(id,lawyer_id,client_id,title,matter,court,priority,internal_notes) VALUES($1,$2,$3,'Caso de otro abogado','Civil','Tribunal','Media','OTRO SECRETO')`,
      [randomUUID(), otherId, otherClientId],
    );
    const result = await request(
      "/supervision",
      "GET",
      undefined,
      supervisorCookie,
    );
    assert.equal(result.status, 200);
    assert.equal(result.json.lawyers.length, 2);
    assert.ok(result.json.items.some((c) => c.lawyerId === lawyerId));
    assert.ok(result.json.items.some((c) => c.lawyerId === otherId));
    const detail = await request(
      `/supervision/cases/${created}`,
      "GET",
      undefined,
      supervisorCookie,
    );
    assert.equal(detail.status, 200);
    for (const body of [result.json, detail.json]) {
      const json = JSON.stringify(body);
      for (const secret of [
        "internalNotes",
        "SECRETO",
        "password",
        "token_hash",
      ])
        assert.ok(!json.includes(secret));
    }
    assert.equal(detail.json.lawyerName, "Abogado de demostración");
  });
  it("registra avance e historial atómicos, visibles al coordinador y privados frente al cliente", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const dto = {
      version: 1,
      stage: "PREPARATION",
      summary: "Documentos de respaldo revisados.",
      nextAction: "Solicitar documento pendiente",
    };
    const result = await request(
      `/cases/${id}/progress`,
      "PATCH",
      dto,
      lawyerCookie,
    );
    assert.equal(result.status, 200);
    const detail = (
      await request(
        `/supervision/cases/${id}`,
        "GET",
        undefined,
        supervisorCookie,
      )
    ).json;
    assert.equal(detail.progressStage, "PREPARATION");
    assert.equal(detail.history.length, 1);
    assert.equal(detail.history[0].summary, dto.summary);
    assert.equal(detail.history[0].caseVersion, 2);
    assert.equal(detail.history[0].authorName, "Abogado de demostración");
    assert.equal(detail.needsAttention, false);
    assert.equal(
      (await request(`/cases/${id}/progress`, "GET", undefined, otherCookie))
        .status,
      404,
    );
    assert.equal(
      (await request(`/cases/${id}/progress`, "GET", undefined, clientCookie))
        .status,
      403,
    );
    const client = (
      await request(`/cases/${id}`, "GET", undefined, clientCookie)
    ).json;
    assert.ok(!("progressSummary" in client));
    assert.ok(!JSON.stringify(client).includes(dto.summary));
  });
  it("un avance antiguo no añade historial y compite con ediciones usando la misma versión", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const dto = {
      stage: "IN_PROGRESS",
      summary: "Nueva gestión para la causa.",
      nextAction: "",
    };
    const stale = await request(
      `/cases/${id}/progress`,
      "PATCH",
      { ...dto, version: 1 },
      lawyerCookie,
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, "CASE_VERSION_CONFLICT");
    const results = await Promise.all([
      request(
        `/cases/${id}/progress`,
        "PATCH",
        { ...dto, version: 2 },
        lawyerCookie,
      ),
      request(`/cases/${id}`, "PUT", { ...payload, version: 2 }, lawyerCookie),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const saved = await db.query("SELECT version FROM cases WHERE id=$1", [id]);
    assert.equal(saved.rows[0].version, 3);
    const events = await db.query(
      "SELECT count(*)::int AS count FROM case_progress_events WHERE case_id=$1",
      [id],
    );
    assert.equal(events.rows[0].count, results[0].status === 200 ? 2 : 1);
  });
  it("rechaza avances inválidos, de causas ajenas y archivadas", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const dto = {
      version: 3,
      stage: "ASSESSMENT",
      summary: "Resumen de la gestión realizada",
      nextAction: "",
    };
    for (const change of [
      { stage: "NOT_REPORTED" },
      { summary: "   " },
      { summary: "x".repeat(2001) },
      { version: 0 },
      { role: "SUPERVISOR" },
    ]) {
      assert.equal(
        (
          await request(
            `/cases/${id}/progress`,
            "PATCH",
            { ...dto, ...change },
            lawyerCookie,
          )
        ).status,
        400,
      );
    }
    assert.equal(
      (await request(`/cases/${id}/progress`, "PATCH", dto, otherCookie))
        .status,
      404,
    );
    assert.equal(
      (await request(`/cases/${created}/progress`, "PATCH", dto, lawyerCookie))
        .status,
      400,
    );
  });
  it("calcula alertas solo para causas activas sin avance reciente y conserva resúmenes globales al filtrar", async () => {
    await db.query(
      `UPDATE cases SET progress_updated_at=now()-interval '15 days' WHERE id='33333333-3333-4333-8333-333333333333'`,
    );
    const all = (
      await request("/supervision", "GET", undefined, supervisorCookie)
    ).json;
    assert.equal(
      all.summary.total,
      all.lawyers.reduce((n, l) => n + l.total, 0),
    );
    assert.ok(
      all.items.find((c) => c.id === "33333333-3333-4333-8333-333333333333")
        .needsAttention,
    );
    assert.equal(all.items.find((c) => c.id === created).needsAttention, false);
    const filtered = (
      await request(
        `/supervision?lawyerId=${otherId}&status=Activa&stage=NOT_REPORTED&attention=needed`,
        "GET",
        undefined,
        supervisorCookie,
      )
    ).json;
    assert.equal(filtered.total, 1);
    assert.ok(
      filtered.items.every((c) => c.lawyerId === otherId && c.needsAttention),
    );
    assert.deepEqual(filtered.summary, all.summary);
    assert.equal(
      (await request("/supervision?page=0", "GET", undefined, supervisorCookie))
        .status,
      400,
    );
    assert.equal(
      (
        await request(
          "/supervision?lawyerId=invalid",
          "GET",
          undefined,
          supervisorCookie,
        )
      ).status,
      400,
    );
    const literal = (
      await request("/supervision?q=%25", "GET", undefined, supervisorCookie)
    ).json;
    assert.equal(literal.total, 0);
  });
  it("pagina causas sin omisiones e incluye abogados sin causas y cuentas inactivas", async () => {
    await db.query(`UPDATE users SET active=false WHERE id=$1`, [otherId]);
    await db.query(
      `INSERT INTO users(name,email,password_hash,role) VALUES('Sin causas','sin-causas@example.test','unused','LAWYER')`,
    );
    for (let i = 0; i < 23; i++)
      await db.query(
        `INSERT INTO cases(lawyer_id,client_id,title,matter,court,priority) VALUES($1,$2,$3,'Civil','Tribunal','Media')`,
        [otherId, otherClientId, `Paginación ${i}`],
      );
    const first = (
      await request(
        `/supervision?lawyerId=${otherId}`,
        "GET",
        undefined,
        supervisorCookie,
      )
    ).json;
    const second = (
      await request(
        `/supervision?lawyerId=${otherId}&page=2`,
        "GET",
        undefined,
        supervisorCookie,
      )
    ).json;
    assert.equal(first.total, 24);
    assert.equal(first.items.length, 20);
    assert.equal(second.items.length, 4);
    assert.equal(
      new Set([...first.items, ...second.items].map((c) => c.id)).size,
      24,
    );
    assert.equal(first.lawyers.find((l) => l.name === "Sin causas").total, 0);
    assert.equal(
      first.lawyers.find((l) => l.id === otherId).accountActive,
      false,
    );
  });
  it("crea clientes con clave temporal y exige cambiarla", async () => {
    const email = `nuevo-${randomBytes(4).toString("hex")}@example.test`;
    const createdClient = await request("/users/clients", "POST", {
      name: "Cliente nuevo", email, phone: "+56911112222",
    }, lawyerCookie);
    assert.equal(createdClient.status, 201);
    assert.ok(createdClient.json.temporaryPassword.length >= 12);
    const login = await request("/auth/login", "POST", {
      email, password: createdClient.json.temporaryPassword,
    });
    assert.equal(login.status, 201);
    assert.equal(login.json.mustChangePassword, true);
    const cookie = login.cookie.split(";")[0];
    const changed = await request("/auth/change-password", "POST", {
      currentPassword: createdClient.json.temporaryPassword,
      newPassword: "Nueva-clave-segura-2026",
    }, cookie);
    assert.equal(changed.status, 201);
    assert.equal((await request("/auth/me", "GET", undefined, cookie)).status, 401);
    assert.equal(await verifyPassword("Nueva-clave-segura-2026",(await db.query("SELECT password_hash FROM users WHERE email=$1",[email])).rows[0].password_hash),true);
  });
  it("gestiona agenda, comunicaciones y notificaciones del cliente", async () => {
    const caseId = "33333333-3333-4333-8333-333333333333";
    const deadline = await request(`/cases/${caseId}/deadlines`, "POST", {
      deadlineType:"HEARING",title:"Audiencia de prueba",dueAt:"2026-12-18T12:00:00.000Z",reminderAt:"2026-12-17T12:00:00.000Z",
    }, lawyerCookie);
    assert.equal(deadline.status, 201, JSON.stringify(deadline.json));
    const agenda = await request("/agenda?from=2026-12-01&to=2026-12-31", "GET", undefined, lawyerCookie);
    assert.ok(agenda.json.some((item) => item.id === deadline.json.id));
    const sent = await request(`/cases/${caseId}/communications`, "POST", {message:"Audiencia confirmada para diciembre.",channel:"IN_APP"}, lawyerCookie);
    assert.equal(sent.status, 201, `${JSON.stringify(sent.json)}\n${output}`);
    const communications = await request(`/cases/${caseId}/communications`, "GET", undefined, clientCookie);
    assert.ok(communications.json.some((item) => item.message.includes("Audiencia confirmada")));
    const notifications = await request("/notifications", "GET", undefined, clientCookie);
    assert.ok(notifications.json.some((item) => item.type === "CASE_UPDATE"));
  });
  it("completa solicitudes documentales e ingesta con confirmación humana", async () => {
    const caseId = "33333333-3333-4333-8333-333333333333";
    assert.equal((await request(`/cases/${caseId}/document-requests`, "POST", {assignedTo:clientId,title:"Cédula de identidad"}, lawyerCookie)).status, 201);
    const form = new FormData();
    form.append("file",new Blob(["documento ficticio"],{type:"text/plain"}),"cedula.txt");
    form.append("title","Documento ficticio");form.append("category","IDENTITY");form.append("visibility","CLIENT");
    const uploaded = await fetch(`${base}/cases/${caseId}/documents`,{method:"POST",headers:{cookie:clientCookie},body:form});
    assert.equal(uploaded.status,201);
    const ingested = await request("/ingestion/text","POST",{sourceType:"EMAIL",sourceName:"Correo PJUD",caseId,text:"Tribunal: Juzgado de Familia. Resolución causa LC-1 con fecha 2026-12-19."},lawyerCookie);
    assert.equal(ingested.status,201);
    const reviewed = await request(`/ingestion/${ingested.json.id}/review`,"PATCH",{status:"CONFIRMED",summary:"El tribunal emitió una resolución que fue revisada por el abogado."},lawyerCookie);
    assert.equal(reviewed.status,200);
  });
  it("invalida sesiones al cerrar sesión y al expirar", async () => {
    assert.equal(
      (await request("/auth/logout", "POST", {}, clientCookie)).status,
      201,
    );
    assert.equal(
      (await request("/auth/me", "GET", undefined, clientCookie)).status,
      401,
    );
    const revoked = await db.query(
      "SELECT revoked_at FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
      [clientId],
    );
    assert.ok(revoked.rows[0].revoked_at);
    await db.query(
      "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
      [otherId],
    );
    assert.equal(
      (await request("/auth/me", "GET", undefined, otherCookie)).status,
      401,
    );
  });
  it("deriva contraseñas con sal única y verifica sin aceptar claves incorrectas", async () => {
    const hash = await hashPassword(password);
    const second = await hashPassword(password);
    assert.notEqual(hash, second);
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(await verifyPassword("incorrecta", hash), false);
  });
});
