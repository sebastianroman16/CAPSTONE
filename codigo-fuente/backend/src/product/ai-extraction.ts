// Validación de la respuesta de Gemini (DAS 3.3 y 6.4). La IA propone datos.
// Fecha, hora, tribunal y RIT deben aparecer en el aviso original; si no, se descartan.
// El tipo de movimiento es una clasificación: solo reemplaza al genérico y el abogado lo confirma antes de publicar.
import { MOVEMENT_TYPES, MovementType, normalizeReference, RuleExtraction } from "./ingestion-rules";

export interface AiExtraction {
  summary: string;
  movementType: MovementType | null;
  date: string | null; // AAAA-MM-DD
  time: string | null; // HH:MM
  court: string | null;
  rit: string | null;
}

export interface MergedExtraction {
  reference: string | null;
  date: string | null;
  time: string | null;
  court: string | null;
  movementType: MovementType;
  missingFields: string[];
}

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Minúsculas, sin tildes y con espacios simples, para comparar texto libre. */
const fold = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** Solo letras y números en mayúsculas, para comparar referencias con o sin guiones. */
const compact = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const hasNumber = (text: string, n: number) => new RegExp(`(?<!\\d)0?${n}(?!\\d)`).test(text);

// Comprobación de respaldo, no de exactitud: el abogado confirma antes de publicar.
function isGroundedDate(date: string, source: string): boolean {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return false;
  const text = fold(source);
  return text.includes(String(year)) && hasNumber(text, day)
    && (hasNumber(text, month) || text.includes(MONTH_NAMES[month - 1]));
}

function isGroundedTime(time: string, source: string): boolean {
  const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return false;
  const text = fold(source);
  return hasNumber(text, Number(match[1])) && (match[2] === "00" || text.includes(match[2]));
}

/** Convierte el JSON de Gemini en datos validados. Devuelve null si el resumen falta o el JSON no es legible. */
export function parseAiExtraction(raw: string, source: string): AiExtraction | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const field = (key: string): string => {
    const value = (data as Record<string, unknown>)[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const summary = field("summary").slice(0, 2000);
  if (!summary) return null;
  const movement = field("movementType").toUpperCase();
  const date = field("date");
  const time = field("time");
  const court = field("court").slice(0, 200);
  const rit = field("rit").replace(/^(RIT|ROL)\b[\s:#.°ºN-]*/i, "");
  return {
    summary,
    movementType: (MOVEMENT_TYPES as readonly string[]).includes(movement) ? (movement as MovementType) : null,
    date: isGroundedDate(date, source) ? date : null,
    time: isGroundedTime(time, source) ? time : null,
    court: court && fold(source).includes(fold(court)) ? court : null,
    rit: compact(rit).length >= 4 && compact(source).includes(compact(rit)) ? normalizeReference(rit) : null,
  };
}

/** Las reglas mandan cuando encuentran un dato. La IA completa los huecos y solo reemplaza el tipo MOVIMIENTO genérico. */
export function mergeAiGaps(rules: RuleExtraction, ai: AiExtraction | null): MergedExtraction {
  const reference = rules.reference ?? ai?.rit ?? null;
  const date = rules.date ?? ai?.date ?? null;
  const time = rules.time ?? ai?.time ?? null;
  const court = rules.court ?? ai?.court ?? null;
  const movementType: MovementType =
    rules.movementType === "MOVIMIENTO" && ai?.movementType ? ai.movementType : rules.movementType;
  const missingFields = [reference ? null : "referencia", date ? null : "fecha", court ? null : "tribunal"]
    .filter((field): field is string => Boolean(field));
  return { reference, date, time, court, movementType, missingFields };
}
