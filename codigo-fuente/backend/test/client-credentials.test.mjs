import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { credentialsForLawyer, deliverClientCredentials } from "../dist/cases/client-credentials.js";

// HU-02, HU-10 y HU-31: la clave temporal solo vuelve a la pantalla del abogado
// cuando no se pudo enviar al cliente por correo.
describe("Credenciales del cliente nuevo", () => {
  it("no devuelve la clave si el envío se completó", () => {
    assert.deepEqual(credentialsForLawyer("Lex-temporal-1", "DELIVERED"), { deliveryStatus: "DELIVERED" });
  });
  it("devuelve la clave si no hay proveedor o el envío falló", () => {
    assert.deepEqual(credentialsForLawyer("Lex-temporal-1", "PENDING"), { deliveryStatus: "PENDING", temporaryPassword: "Lex-temporal-1" });
    assert.deepEqual(credentialsForLawyer("Lex-temporal-1", "FAILED"), { deliveryStatus: "FAILED", temporaryPassword: "Lex-temporal-1" });
  });

  describe("envío por el proveedor configurado", () => {
    let server, status = 200, received = null;
    const previous = process.env.CLIENT_CREDENTIALS_WEBHOOK_URL;
    before(async () => {
      server = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => { received = JSON.parse(body); res.writeHead(status); res.end(); });
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      process.env.CLIENT_CREDENTIALS_WEBHOOK_URL = `http://127.0.0.1:${server.address().port}/credenciales`;
    });
    after(async () => {
      if (previous === undefined) delete process.env.CLIENT_CREDENTIALS_WEBHOOK_URL;
      else process.env.CLIENT_CREDENTIALS_WEBHOOK_URL = previous;
      await new Promise((r) => server.close(r));
    });
    it("marca entregado cuando el proveedor acepta y envía la clave al cliente", async () => {
      status = 200;
      assert.equal(await deliverClientCredentials("cliente@example.test", "Cliente", "Lex-temporal-2"), "DELIVERED");
      assert.equal(received.to, "cliente@example.test");
      assert.equal(received.temporaryPassword, "Lex-temporal-2");
    });
    it("marca fallido cuando el proveedor rechaza", async () => {
      status = 500;
      assert.equal(await deliverClientCredentials("cliente@example.test", "Cliente", "Lex-temporal-3"), "FAILED");
    });
  });
});
