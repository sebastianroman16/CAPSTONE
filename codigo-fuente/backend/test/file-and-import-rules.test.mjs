// Pruebas unitarias de E23 (firma de archivos) y E11 (fechas al importar causas). No requieren base de datos.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contentMatchesType, documentRejection, ingestionRejection } from "../dist/product/file-signature.js";
import { CaseImportService } from "../dist/cases/case-import.service.js";
import { AssistantService } from "../dist/assistant/assistant.service.js";

const bytes = (...values) => Buffer.from(values);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const DOCX = Buffer.concat([bytes(0x50, 0x4b, 0x03, 0x04), Buffer.from("....[Content_Types].xml....word/document.xml")]);
const XLSX = Buffer.concat([bytes(0x50, 0x4b, 0x03, 0x04), Buffer.from("....xl/workbook.xml")]);
const EXE = Buffer.concat([Buffer.from("MZ"), bytes(0x90, 0x00, 0x03, 0x00)]);
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("E23 · Firma de archivos de documentos", () => {
  it("feliz: acepta PDF, PNG, JPEG, DOCX y texto con su extensión", () => {
    assert.equal(documentRejection("application/pdf", "demanda.pdf", PDF), null);
    assert.equal(documentRejection("image/png", "foto.png", PNG), null);
    assert.equal(documentRejection("image/jpeg", "foto.jpg", JPEG), null);
    assert.equal(documentRejection(DOCX_TYPE, "escrito.docx", DOCX), null);
    assert.equal(documentRejection("text/plain", "nota.txt", Buffer.from("Texto del cliente\r\nSegunda línea\t✓")), null);
  });
  it("triste: rechaza contenido falso, ejecutables, extensiones cambiadas y tipos no permitidos", () => {
    assert.match(documentRejection("application/pdf", "falso.pdf", Buffer.from("no soy un pdf")), /contenido/);
    assert.match(documentRejection("text/plain", "virus.txt", EXE), /contenido/);
    assert.match(documentRejection("image/png", "foto.png", JPEG), /contenido/);
    assert.match(documentRejection(DOCX_TYPE, "planilla.docx", XLSX), /contenido/, "un XLSX no es un DOCX aunque ambos sean ZIP");
    assert.match(documentRejection("application/pdf", "demanda.exe", PDF), /extensión/);
    assert.match(documentRejection("application/x-msdownload", "virus.exe", EXE), /no permitido/);
  });
  it("borde: archivo vacío, mayúsculas en la extensión, texto Windows-1252 y firma incompleta", () => {
    assert.match(documentRejection("text/plain", "vacio.txt", Buffer.alloc(0)), /vacío/);
    assert.equal(documentRejection("image/jpeg", "FOTO.JPEG", JPEG), null);
    assert.equal(documentRejection("text/plain", "latin1.txt", Buffer.from([0x4d, 0x75, 0xf1, 0x6f, 0x7a])), null, "'Muñoz' en Windows-1252");
    assert.equal(contentMatchesType("image/png", PNG.subarray(0, 4)), false);
    assert.equal(contentMatchesType("application/pdf", Buffer.from("%PDF")), false, "falta el guion de la versión");
  });
});

describe("E23 · Firma de archivos en la bandeja de movimientos", () => {
  it("feliz: PDF, Excel y texto válidos", () => {
    assert.equal(ingestionRejection("aviso.pdf", PDF), null);
    assert.equal(ingestionRejection("movimientos.xlsx", XLSX), null);
    assert.equal(ingestionRejection("correo.eml", Buffer.from("Asunto: RIT C-1-2026")), null);
  });
  it("triste: un Excel o PDF falso se rechaza con 400 en vez de fallar al leerlo", () => {
    assert.match(ingestionRejection("movimientos.xlsx", Buffer.from("texto plano")), /Excel/);
    assert.match(ingestionRejection("movimientos.xlsx", DOCX), /Excel/);
    assert.match(ingestionRejection("aviso.pdf", Buffer.from("texto")), /PDF/);
    assert.match(ingestionRejection("correo.txt", EXE), /texto, PDF o Excel/);
  });
  it("borde: archivo vacío", () => {
    assert.match(ingestionRejection("vacio.pdf", Buffer.alloc(0)), /vacío/);
  });
});

describe("E11 · Fechas al importar causas", () => {
  const service = Object.create(CaseImportService.prototype);
  const date = (value) => service.dateValue(value);
  it("feliz: formatos chilenos con guion, barra y punto, e ISO", () => {
    assert.equal(date("18-09-2026"), "2026-09-18");
    assert.equal(date("18/09/2026"), "2026-09-18");
    assert.equal(date("18.09.2026"), "2026-09-18");
    assert.equal(date("2026-09-18"), "2026-09-18");
  });
  it("triste: fechas imposibles o con año de dos dígitos", () => {
    assert.equal(date("31-02-2026"), false);
    assert.equal(date("18-09-26"), false);
    assert.equal(date("mañana"), false);
  });
  it("borde: día y mes de un dígito, celda vacía, número de serie de Excel y 29 de febrero", () => {
    assert.equal(date("8/9/2026"), "2026-09-08");
    assert.equal(date(""), "");
    assert.equal(date(null), "");
    assert.equal(date(46283), "2026-09-18");
    assert.equal(date("29.02.2028"), "2028-02-29");
    assert.equal(date("29.02.2027"), false);
  });
});

describe("E21 · Referencias de causa en preguntas a Lexi", () => {
  const service = Object.create(AssistantService.prototype);
  const id = (message) => service.caseIdentifier(message);
  it("feliz: ceros a la izquierda, espacios, minúsculas y '#' se normalizan a LC-n", () => {
    assert.equal(id("¿Cómo va la LC-01?"), "LC-1");
    assert.equal(id("estado lc 0001"), "LC-1");
    assert.equal(id("resume LC#7"), "LC-7");
  });
  it("triste: sin número o sin referencia no se inventa una causa", () => {
    assert.equal(id("¿Cómo va la LC-?"), null);
    assert.equal(id("¿cómo va mi causa?"), null);
  });
  it("borde: no confunde números que comparten dígitos, conserva LC-0 y sigue leyendo RIT", () => {
    assert.equal(id("LC-10"), "LC-10");
    assert.equal(id("LC-0100"), "LC-100");
    assert.equal(id("LC-0"), "LC-0");
    assert.equal(id("causa C-12-2026"), "C-12-2026");
  });
});
