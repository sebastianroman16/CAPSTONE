// Pruebas unitarias de las reglas de extracción (P1 y P7). No requieren base de datos.
// Cada regla se valida con caso feliz, caso triste y caso borde.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectCourt,
  detectDate,
  detectMovementType,
  detectReference,
  detectTime,
  excelCellText,
  excelRowsToMovements,
  extractMovement,
  normalizeReference,
} from "../dist/product/ingestion-rules.js";

describe("Reglas: fecha (E6)", () => {
  it("feliz: reconoce formatos chilenos numéricos, en palabras e ISO", () => {
    assert.equal(detectDate("Audiencia para el 25/09/2026."), "2026-09-25");
    assert.equal(detectDate("Audiencia para el 25-09-2026."), "2026-09-25");
    assert.equal(detectDate("Audiencia para el 5.9.2026."), "2026-09-05");
    assert.equal(detectDate("Se cita a audiencia para el 25 de septiembre de 2026."), "2026-09-25");
    assert.equal(detectDate("Fecha 2026-12-19."), "2026-12-19");
  });
  it("triste: descarta fechas imposibles y textos sin fecha", () => {
    assert.equal(detectDate("Fecha 31/02/2026."), null);
    assert.equal(detectDate("Fecha 2026-13-01."), null);
    assert.equal(detectDate("25 de septiembre sin año"), null);
    assert.equal(detectDate("Sin fecha en el texto."), null);
  });
  it("borde: prefiere la fecha anunciada, acepta 'setiembre', 'del', mayúsculas y años bisiestos", () => {
    assert.equal(
      detectDate("Santiago, 18 de septiembre de 2026. Se cita a audiencia preparatoria para el 25 de septiembre de 2026."),
      "2026-09-25",
    );
    assert.equal(detectDate("fijada para el 3 de Setiembre del 2026"), "2026-09-03");
    assert.equal(detectDate("PARA EL 1 DE OCTUBRE DE 2026"), "2026-10-01");
    assert.equal(detectDate("Fecha 29/02/2028."), "2028-02-29");
    assert.equal(detectDate("Fecha 29/02/2027."), null);
    assert.equal(detectDate("RIT C-12-2026"), null, "un RIT no es una fecha");
  });
});

describe("Reglas: hora", () => {
  it("feliz: detecta 'a las 9:30 horas', '10.15 hrs' y '15:45 h'", () => {
    assert.equal(detectTime("a las 9:30 horas"), "09:30");
    assert.equal(detectTime("a las 10.15 hrs."), "10:15");
    assert.equal(detectTime("15:45 h"), "15:45");
  });
  it("triste: no inventa horas ni acepta horas imposibles", () => {
    assert.equal(detectTime("sin hora"), null);
    assert.equal(detectTime("a las 25:00 horas"), null);
    assert.equal(detectTime("a las 10:75 horas"), null);
  });
  it("borde: hora sin minutos y medianoche", () => {
    assert.equal(detectTime("audiencia a las 11 horas"), "11:00");
    assert.equal(detectTime("a las 00:00 horas"), "00:00");
  });
});

describe("Reglas: tribunal (E7)", () => {
  it("feliz: toma el nombre completo con ordinal y conectores", () => {
    assert.equal(detectCourt("Ante el 3° Juzgado de Familia de Santiago, en la causa"), "3° Juzgado de Familia de Santiago");
    assert.equal(detectCourt("Corte de Apelaciones de Concepción resolvió"), "Corte de Apelaciones de Concepción");
    assert.equal(detectCourt("2° Juzgado de Letras del Trabajo de Santiago"), "2° Juzgado de Letras del Trabajo de Santiago");
  });
  it("triste: ignora menciones genéricas sin nombre propio", () => {
    assert.equal(detectCourt("Se notifica resolución de este tribunal."), null);
    assert.equal(detectCourt("el juzgado resolvió"), null);
    assert.equal(detectCourt("Sin tribunal"), null);
  });
  it("borde: etiqueta previa, texto en mayúsculas, ordinal escrito y no salta de línea", () => {
    assert.equal(detectCourt("Tribunal: Juzgado de Familia. Resolución"), "Juzgado de Familia");
    assert.equal(detectCourt("JUZGADO DE GARANTIA DE TEMUCO"), "JUZGADO DE GARANTIA DE TEMUCO");
    assert.equal(detectCourt("ante el Tercer Juzgado Civil de Santiago"), "Tercer Juzgado Civil de Santiago");
    assert.equal(detectCourt("Tribunal: 2° Juzgado de Familia de Santiago\nFecha: 2026-09-25"), "2° Juzgado de Familia de Santiago");
    assert.equal(detectCourt("Corte Suprema"), "Corte Suprema");
    assert.ok(detectCourt(`Juzgado de ${"Santiago ".repeat(60)}`).length <= 200, "se limita a 200 caracteres");
  });
});

describe("Reglas: referencia (E8, E21)", () => {
  it("feliz: RIT, rol de Corte y referencia interna", () => {
    assert.equal(detectReference("En la causa RIT C-123-2026 se resolvió"), "C-123-2026");
    assert.equal(detectReference("Rol N° 1234-2026 de la Corte"), "1234-2026");
    assert.equal(detectReference("Referencia LC-7 del sistema"), "LC-7");
  });
  it("triste: no toma 'RIT' ni palabras sin dígitos como referencia", () => {
    assert.equal(detectReference("La causa del cliente"), null);
    assert.equal(detectReference("causa RIT pendiente"), null);
    assert.equal(detectReference("Sin datos"), null);
  });
  it("borde: minúsculas, ceros a la izquierda, espacios y prioridad del RIT sobre LC", () => {
    assert.equal(detectReference("causa rit c-45-2025"), "C-45-2025");
    assert.equal(detectReference("Referencia LC-0007"), "LC-7");
    assert.equal(detectReference("LC 12"), "LC-12");
    assert.equal(detectReference("LC-3 corresponde al RIT O-9-2026"), "O-9-2026");
    assert.equal(normalizeReference(" lc 0001 "), "LC-1");
    assert.equal(normalizeReference("c-1-2026"), "C-1-2026");
  });
});

describe("Reglas: tipo de movimiento (E10)", () => {
  it("feliz: clasifica audiencia, resolución, sentencia y notificación", () => {
    assert.equal(detectMovementType("Se cita a las partes a audiencia preparatoria.").type, "AUDIENCIA");
    assert.equal(detectMovementType("Proveyendo escrito, téngase presente.").type, "RESOLUCIÓN");
    assert.equal(detectMovementType("Se dicta sentencia definitiva.").type, "SENTENCIA");
    assert.equal(detectMovementType("Se notifica a la demandada.").type, "NOTIFICACIÓN");
  });
  it("triste: un texto sin señales queda como movimiento genérico y no específico", () => {
    assert.deepEqual(detectMovementType("Texto sin datos relevantes"), { type: "MOVIMIENTO", specific: false });
  });
  it("borde: la sola palabra audiencia no gana a una sentencia ni a una suspensión", () => {
    assert.equal(detectMovementType("Se dicta sentencia definitiva. La audiencia anterior fue grabada.").type, "SENTENCIA");
    assert.equal(detectMovementType("Se deja sin efecto la audiencia fijada para mañana.").type, "RESOLUCIÓN");
    assert.equal(detectMovementType("La audiencia fue suspendida.").type, "RESOLUCIÓN");
    assert.deepEqual(detectMovementType("Se menciona una audiencia."), { type: "AUDIENCIA", specific: false });
  });
});

describe("Reglas: confianza y validación por patrón (P7)", () => {
  it("feliz: aviso completo con confianza alta y formato reconocido", () => {
    const result = extractMovement(
      "RIT C-123-2026. El 3° Juzgado de Familia de Santiago cita a audiencia preparatoria para el 25 de septiembre de 2026 a las 9:30 horas.",
    );
    assert.deepEqual({ ...result }, {
      reference: "C-123-2026", date: "2026-09-25", time: "09:30", court: "3° Juzgado de Familia de Santiago",
      movementType: "AUDIENCIA", confidence: "ALTA", formatRecognized: true, missingFields: [],
    });
  });
  it("triste: un texto ajeno se marca como formato no reconocido con confianza baja", () => {
    const result = extractMovement("Estimado usuario, adjuntamos información de su interés.");
    assert.equal(result.formatRecognized, false);
    assert.equal(result.confidence, "BAJA");
    assert.deepEqual(result.missingFields, ["referencia", "fecha", "tribunal"]);
  });
  it("borde: sin RIT nunca es reconocible; con RIT basta fecha o tribunal", () => {
    assert.equal(extractMovement("El Juzgado de Familia de Santiago fija audiencia para el 25/09/2026.").formatRecognized, false);
    assert.equal(extractMovement("RIT C-1-2026, nada más.").formatRecognized, false);
    const withDate = extractMovement("RIT C-1-2026, resolución del 25/09/2026.");
    assert.equal(withDate.formatRecognized, true);
    assert.deepEqual(withDate.missingFields, ["tribunal"]);
    assert.equal(withDate.confidence, "MEDIA", "la confianza alta exige referencia, fecha, tribunal y tipo específico");
    assert.equal(extractMovement("Juzgado de Familia de Santiago".normalize("NFD")).court, "Juzgado de Familia de Santiago");
  });
});

describe("Reglas: Excel (E9)", () => {
  it("feliz: un movimiento por fila con encabezados y fechas sin desfase", () => {
    assert.equal(excelCellText(new Date(Date.UTC(2026, 8, 25))), "2026-09-25");
    const movements = excelRowsToMovements([
      ["RIT", "Tribunal", "Fecha", "Trámite"],
      ["C-1-2026", "1° Juzgado de Familia de Santiago", "2026-09-25", "Cita a audiencia"],
      ["C-2-2026", "Juzgado de Garantía de Temuco", "2026-10-01", "Resolución"],
    ]);
    assert.equal(movements.length, 2);
    const parsed = extractMovement(movements[0]);
    assert.equal(parsed.court, "1° Juzgado de Familia de Santiago");
    assert.equal(parsed.date, "2026-09-25");
    assert.equal(parsed.reference, "C-1-2026");
  });
  it("triste: planilla vacía o solo con filas en blanco no produce movimientos", () => {
    assert.deepEqual(excelRowsToMovements([]), []);
    assert.deepEqual(excelRowsToMovements([["", ""], ["", ""]]), []);
    assert.equal(excelCellText(null), "");
    assert.equal(excelCellText(new Date("fecha inválida")), "");
  });
  it("borde: sin encabezado, celdas vacías, texto enriquecido, fórmulas e hipervínculos", () => {
    const withoutHeader = excelRowsToMovements([["C-1-2026", "2026-09-25"], ["C-2-2026", "2026-09-26"]]);
    assert.equal(withoutHeader.length, 2, "una primera fila con datos no se descarta como encabezado");
    assert.match(withoutHeader[0], /^Columna 1: C-1-2026\nColumna 2: 2026-09-25$/);
    assert.equal(excelRowsToMovements([["RIT", "Fecha"], ["C-1-2026", ""]])[0], "RIT: C-1-2026");
    assert.equal(excelRowsToMovements([["RIT"]]).length, 1, "una sola fila sin dígitos se procesa como dato");
    assert.equal(excelCellText({ richText: [{ text: "C-1" }, { text: "-2026" }] }), "C-1-2026");
    assert.equal(excelCellText({ formula: "A1", result: new Date(Date.UTC(2026, 0, 2)) }), "2026-01-02");
    assert.equal(excelCellText({ text: "Ver resolución", hyperlink: "https://example.test" }), "Ver resolución");
    assert.equal(excelCellText({ error: "#REF!" }), "");
  });
});
