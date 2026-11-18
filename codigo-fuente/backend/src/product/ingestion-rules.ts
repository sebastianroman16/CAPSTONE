// Extracción por reglas de los movimientos judiciales (respaldo del DAS 3.3).
// Funciones puras: no consultan la base de datos ni servicios externos.

export type Confidence = "ALTA" | "MEDIA" | "BAJA";
export const MOVEMENT_TYPES = ["AUDIENCIA", "RESOLUCIÓN", "SENTENCIA", "NOTIFICACIÓN", "MOVIMIENTO"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface RuleExtraction {
  reference: string | null;
  date: string | null; // AAAA-MM-DD
  time: string | null; // HH:MM
  court: string | null;
  movementType: MovementType;
  confidence: Confidence;
  formatRecognized: boolean;
  missingFields: string[];
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

// Quita tildes conservando el largo de un texto en NFC (cada letra con tilde vuelve a ser un carácter).
function plain(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** Referencias "LC-0001" y "LC 1" se normalizan a "LC-1", como las genera el servidor. */
export function normalizeReference(value: string): string {
  const upper = value.trim().toUpperCase();
  const lc = upper.match(/^LC[\s-]*0*(\d+)$/);
  return lc ? `LC-${lc[1]}` : upper;
}

export function detectReference(text: string): string | null {
  // 1) RIT o ROL con letra, número y año (C-123-2026, O-45-2025). Tiene prioridad sobre "causa".
  const rit = text.match(/\b([A-Z]{1,3})\s?-\s?(\d{1,7})\s?-\s?((?:19|20)\d{2})\b/i);
  if (rit) return `${rit[1].toUpperCase()}-${rit[2]}-${rit[3]}`;
  // 2) Referencia interna de LEX-CORPUS.
  const lc = text.match(/\bLC[\s-]*0*(\d{1,9})\b/i);
  if (lc) return `LC-${lc[1]}`;
  // 3) Rol numérico de Cortes (Rol N° 1234-2026).
  const rol = text.match(/\bROL\b[\s:#.°ºN-]{0,8}(\d{1,7}-(?:19|20)\d{2})\b/i);
  if (rol) return rol[1];
  // 4) Valor después de RIT/ROL/causa, que contenga al menos un dígito y no sea otra etiqueta.
  for (const match of text.matchAll(/\b(?:RIT|ROL|CAUSA)\b[\s:#.°ºN-]*([A-Z0-9][A-Z0-9-]{2,29})/gi)) {
    const value = match[1].toUpperCase();
    if (/\d/.test(value) && !/^(RIT|ROL|CAUSA)$/.test(value)) return value;
  }
  return null;
}

interface FoundDate { index: number; value: string }

function findDates(text: string): FoundDate[] {
  const found: FoundDate[] = [];
  const push = (index: number, value: string | null) => { if (value) found.push({ index, value }); };
  for (const m of text.matchAll(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/g))
    push(m.index!, isoDate(+m[1], +m[2], +m[3]));
  for (const m of text.matchAll(/(?<![\d-])(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.]((?:19|20)\d{2})\b/g))
    push(m.index!, isoDate(+m[3], +m[2], +m[1]));
  const words = plain(text);
  for (const m of words.matchAll(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de|del)\s+((?:19|20)\d{2})\b/g))
    push(m.index!, isoDate(+m[3], MONTHS[m[2]], +m[1]));
  return found.sort((a, b) => a.index - b.index);
}

/** Prefiere la fecha anunciada ("para el 25 de septiembre") sobre la fecha de emisión del documento. */
export function detectDate(text: string): string | null {
  const dates = findDates(text);
  if (!dates.length) return null;
  const lower = plain(text);
  const announced = dates.find((d) =>
    /(para el|para el dia|fija|fijada|fijase|cita|citada|citese|programada|reprograma|se realizara|a celebrarse|audiencia)[^.]{0,60}$/
      .test(lower.slice(Math.max(0, d.index - 80), d.index)),
  );
  return (announced ?? dates[0]).value;
}

export function detectTime(text: string): string | null {
  const pad = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;
  const lower = plain(text);
  const withMinutes = lower.match(/\b(?:a las|las)\s+([01]?\d|2[0-3])[:.]([0-5]\d)\b/)
    ?? lower.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:h|hrs?|horas)\b/);
  if (withMinutes) return pad(withMinutes[1], withMinutes[2]);
  const hourOnly = lower.match(/\ba las\s+([01]?\d|2[0-3])\s*(?:h|hrs?|horas)\b/);
  return hourOnly ? pad(hourOnly[1], "00") : null;
}

// Más largos primero y con límite de palabra: "del" no debe cortarse en "de".
const CONNECTOR = "(?:del|de|las|los|la|lo|en|y|DEL|DE|LAS|LOS|LA|LO|EN|Y)(?![A-Za-zÁÉÍÓÚÑáéíóúñü])";
const NAME_WORD = "[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñü]*";
const ORDINAL = "(?:\\d{1,2}\\s*[°ºª]\\s*|(?:Primer|Segundo|Tercer|Cuarto|Quinto|Sexto|Séptimo|Septimo|Octavo|Noveno|Décimo|Decimo)[oa]?\\s+)?";
const COURT = new RegExp(
  // Solo espacios dentro de la línea: el nombre no continúa en la línea siguiente (encabezados de Excel).
  `(${ORDINAL}(?:Juzgado|JUZGADO|Tribunal|TRIBUNAL|Corte|CORTE)((?:[ \\t]+(?:${CONNECTOR}|${NAME_WORD}))*))`,
  "g",
);

/** Nombre completo del tribunal ("3° Juzgado de Familia de Santiago"); ignora "este tribunal". */
export function detectCourt(text: string): string | null {
  for (const match of text.matchAll(COURT)) {
    const name = match[2].trim().replace(new RegExp(`(?:\\s+${CONNECTOR})+$`), "");
    const hasProperName = new RegExp(`(^|\\s)${NAME_WORD}`).test(name);
    if (!hasProperName) continue;
    const full = match[1].slice(0, match[1].length - match[2].length) + " " + name;
    return full.replace(/\s+/g, " ").trim().slice(0, 200);
  }
  return null;
}

/** Clasifica por frases específicas antes que por palabras sueltas (una sentencia que menciona una audiencia sigue siendo sentencia). */
export function detectMovementType(text: string): { type: MovementType; specific: boolean } {
  const t = plain(text);
  if (/\b(dicta|dicto|se dicto|pronuncia)\s+sentencia\b|\bsentencia (definitiva|interlocutoria|de termino)\b/.test(t))
    return { type: "SENTENCIA", specific: true };
  if (/\b(suspende|suspendese|deja sin efecto|dejase sin efecto|cancela|anula)\b[^.]{0,80}\baudiencia\b|\baudiencia\b[^.]{0,40}\b(suspendida|sin efecto|cancelada)\b/.test(t))
    return { type: "RESOLUCIÓN", specific: true };
  if (/\b(cita|citese|fija|fijase|programa|reprograma|cita a las partes)\b[^.]{0,80}\baudiencia\b|\baudiencia (preparatoria|de juicio|de conciliacion|de formalizacion|de control|de procedimiento|ampliada|de juicio oral)\b|\baudiencia\b[^.]{0,40}\b(para el|el dia|fijada|programada)\b/.test(t))
    return { type: "AUDIENCIA", specific: true };
  if (/\bresolucion\b|\bresuelve\b|\bproveyendo\b|\bha lugar\b|\btengase presente\b/.test(t))
    return { type: "RESOLUCIÓN", specific: true };
  if (/\bnotifica|\bnotificacion\b/.test(t)) return { type: "NOTIFICACIÓN", specific: true };
  if (/\bsentencia\b/.test(t)) return { type: "SENTENCIA", specific: false };
  if (/\baudiencia\b/.test(t)) return { type: "AUDIENCIA", specific: false };
  return { type: "MOVIMIENTO", specific: false };
}

export function extractMovement(input: string): RuleExtraction {
  const text = input.normalize("NFC");
  const reference = detectReference(text);
  const date = detectDate(text);
  const time = detectTime(text);
  const court = detectCourt(text);
  const movement = detectMovementType(text);
  const missingFields = [
    reference ? null : "referencia",
    date ? null : "fecha",
    court ? null : "tribunal",
  ].filter((field): field is string => Boolean(field));
  const score = 3 - missingFields.length + (movement.specific ? 1 : 0);
  const confidence: Confidence = score >= 4 ? "ALTA" : score >= 2 ? "MEDIA" : "BAJA";
  // Validación por patrón: un aviso judicial reconocible trae la causa y al menos fecha o tribunal.
  // Si no, es probable que el Poder Judicial haya cambiado el formato y el abogado debe revisarlo.
  const formatRecognized = Boolean(reference) && missingFields.length <= 1;
  return { reference, date, time, court, movementType: movement.type, confidence, formatRecognized, missingFields };
}

/** Texto de una celda de Excel sin perder fechas ni valores de fórmulas, hipervínculos o texto enriquecido. */
export function excelCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const cell = value as Record<string, unknown>;
    if (Array.isArray(cell.richText)) return cell.richText.map((part: any) => part?.text ?? "").join("").trim();
    if ("result" in cell) return excelCellText(cell.result);
    if ("text" in cell) return excelCellText(cell.text);
    return "";
  }
  return String(value).trim();
}

/** Convierte filas de una planilla en un texto por movimiento. La primera fila se usa como encabezado si no trae datos. */
export function excelRowsToMovements(rows: string[][]): string[] {
  const filled = rows.filter((row) => row.some(Boolean));
  if (!filled.length) return [];
  const [first, ...rest] = filled;
  const isHeader = rest.length > 0 && first.every((cell) => !/\d/.test(cell));
  const headers = isHeader ? first : [];
  const data = isHeader ? rest : filled;
  return data.map((row) =>
    row
      .map((value, index) => (value ? `${headers[index] || `Columna ${index + 1}`}: ${value}` : ""))
      .filter(Boolean)
      .join("\n"),
  );
}
