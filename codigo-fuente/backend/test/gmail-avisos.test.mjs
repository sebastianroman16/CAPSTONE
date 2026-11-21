import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Script de Gmail que reenvía los avisos del Poder Judicial al webhook de ingesta.
// Aquí se prueba la parte que no depende de los servicios de Google.
const require = createRequire(import.meta.url);
const avisos = require("../../integraciones/gmail/lexcorpus-avisos.js");
const CENTRAL = "lexcorpus.avisos@gmail.com";

describe("Script de Gmail: identificar al abogado", () => {
  it("usa X-Forwarded-For cuando Gmail reenvió automáticamente", () => {
    assert.equal(
      avisos.identificarAbogado({ reenviadoPor: "abogada@gmail.com lexcorpus.avisos@gmail.com", para: "Otro <otro@cl.cl>" }, CENTRAL),
      "abogada@gmail.com",
    );
  });
  it("usa el destinatario original cuando el reenvío conserva el Para", () => {
    assert.equal(
      avisos.identificarAbogado({ para: "Mauricio Abogado <Mauricio@CAJ.cl>", de: "notificaciones@pjud.cl" }, CENTRAL),
      "mauricio@caj.cl",
    );
  });
  it("si el abogado reenvió a mano, usa el remitente y nunca la casilla central", () => {
    assert.equal(avisos.identificarAbogado({ para: CENTRAL, de: "Ana <ana@caj.cl>" }, CENTRAL), "ana@caj.cl");
    assert.equal(avisos.identificarAbogado({ para: CENTRAL }, CENTRAL), null);
  });
  it("extrae correos sin repetir y en minúsculas", () => {
    assert.deepEqual(avisos.extraerCorreos("A <A@x.cl>, a@x.cl; b@y.cl"), ["a@x.cl", "b@y.cl"]);
    assert.deepEqual(avisos.extraerCorreos(""), []);
  });
});

describe("Script de Gmail: armar el envío al webhook", () => {
  const base = { para: "abogado@caj.cl", asunto: "Notificación causa C-4521-2026", texto: "Se cita a audiencia preparatoria para el 15 de diciembre de 2026.", messageId: "<abc123@pjud.cl>" };
  it("arma el cuerpo con los campos que exige el webhook", () => {
    assert.deepEqual(avisos.armarEnvio(base, CENTRAL), { payload: { messageId: "<abc123@pjud.cl>", lawyerEmail: "abogado@caj.cl", subject: "Notificación causa C-4521-2026", text: base.texto } });
  });
  it("completa el asunto vacío, usa el id de Gmail si falta el Message-ID y recorta textos largos", () => {
    const { payload } = avisos.armarEnvio({ ...base, asunto: "", messageId: "", idGmail: "18c2f0", texto: "x".repeat(100050) }, CENTRAL);
    assert.equal(payload.subject, "Aviso sin asunto");
    assert.equal(payload.messageId, "18c2f0");
    assert.equal(payload.text.length, 100000);
  });
  it("no envía avisos sin abogado o sin texto", () => {
    assert.match(avisos.armarEnvio({ ...base, para: CENTRAL }, CENTRAL).error, /abogado/);
    assert.match(avisos.armarEnvio({ ...base, texto: "  corto " }, CENTRAL).error, /texto/);
  });
});

describe("Script de Gmail: respuesta del webhook y dirección", () => {
  it("clasifica cada respuesta", () => {
    assert.equal(avisos.clasificarRespuesta(201, '{"id":"1"}').accion, "procesado");
    assert.equal(avisos.clasificarRespuesta(401, "{}").accion, "detener");
    assert.equal(avisos.clasificarRespuesta(404, '{"message":"No existe un abogado activo para el destinatario indicado."}').accion, "error");
    assert.equal(avisos.clasificarRespuesta(404, "<html>Not found</html>").accion, "detener");
    assert.equal(avisos.clasificarRespuesta(400, '{"message":["text must be longer"]}').accion, "error");
    assert.equal(avisos.clasificarRespuesta(502, "").accion, "reintentar");
  });
  it("arma la dirección del webhook desde la dirección pública", () => {
    assert.equal(avisos.direccionWebhook("https://demo.trycloudflare.com/"), "https://demo.trycloudflare.com/api/webhooks/ingestion/email");
    assert.equal(avisos.direccionWebhook("https://demo.trycloudflare.com/api"), "https://demo.trycloudflare.com/api/webhooks/ingestion/email");
    assert.equal(avisos.direccionWebhook("demo.com"), null);
  });
});
