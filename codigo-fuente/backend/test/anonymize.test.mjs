// Pruebas unitarias de la anonimización previa a Gemini (E27). No requieren base de datos.
// Cada regla se valida con caso feliz, caso triste y caso borde.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { anonymizeForAi } from "../dist/product/anonymize.js";

describe("Anonimización antes de Gemini (E27)", () => {
  it("feliz: quita correos, RUT y teléfonos del texto enviado", () => {
    const out = anonymizeForAi("Escribir a juan.perez@gmail.com, RUT 12.345.678-5, celular +56 9 8123 4567.");
    assert.equal(out, "Escribir a [correo], RUT [rut], celular [teléfono].");
  });

  it("triste: un texto sin datos personales queda idéntico", () => {
    const text = "Resolución que tiene presente lo informado por la parte demandante.";
    assert.equal(anonymizeForAi(text), text);
  });

  it("borde: conserva fechas, horas, RIT y tribunal, que la extracción necesita", () => {
    const text = "RIT C-1234-2026, audiencia el 25/09/2026 a las 09:30, Juzgado de Familia de Santiago, folio 12345.";
    assert.equal(anonymizeForAi(text), text);
  });
});
