// E23: el tipo de archivo se valida por su contenido (firma o "números mágicos") y su extensión,
// no solo por el tipo que declara el navegador, que el cliente puede falsear.

const startsWith = (buffer: Buffer, bytes: number[]) =>
  buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);

const ZIP = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04": DOCX y XLSX son archivos ZIP

const EXTENSIONS: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "text/plain": [".txt"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

/**
 * Texto plano en UTF-8 o Windows-1252 (frecuente en Chile, con ñ y tildes): se acepta si no trae
 * bytes de control, que delatan un binario. Se permiten tabulación, saltos de línea y avance de página.
 */
function isPlainText(buffer: Buffer) {
  const sample = buffer.subarray(0, 64 * 1024);
  for (const byte of sample) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) return false;
    if (byte === 0x7f) return false;
  }
  return true;
}

/** Indica si el contenido corresponde al tipo declarado. */
export function contentMatchesType(mimeType: string, buffer: Buffer): boolean {
  switch (mimeType) {
    case "application/pdf":
      return startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
    case "image/png":
      return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(buffer, [0xff, 0xd8, 0xff]);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return startsWith(buffer, ZIP) && buffer.includes("word/");
    case "text/plain":
      return isPlainText(buffer);
    default:
      return false;
  }
}

/** Valida tipo declarado, extensión y contenido. Devuelve el motivo del rechazo o null si es válido. */
export function documentRejection(mimeType: string, fileName: string, buffer: Buffer): string | null {
  if (!buffer.length) return "El archivo está vacío.";
  const extensions = EXTENSIONS[mimeType];
  if (!extensions) return "Tipo de archivo no permitido.";
  const name = fileName.toLowerCase();
  if (!extensions.some((extension) => name.endsWith(extension)))
    return "La extensión del archivo no coincide con su tipo.";
  if (!contentMatchesType(mimeType, buffer))
    return "El contenido del archivo no coincide con su tipo.";
  return null;
}

/** Para la bandeja de movimientos: PDF y XLSX deben tener la firma de su formato. */
export function ingestionRejection(fileName: string, buffer: Buffer): string | null {
  if (!buffer.length) return "El archivo está vacío.";
  const name = fileName.toLowerCase();
  if (name.endsWith(".pdf") && !contentMatchesType("application/pdf", buffer))
    return "El archivo no es un PDF válido.";
  if (name.endsWith(".xlsx") && !(startsWith(buffer, ZIP) && buffer.includes("xl/")))
    return "El archivo no es un Excel (.xlsx) válido.";
  if (!name.endsWith(".pdf") && !name.endsWith(".xlsx") && !isPlainText(buffer))
    return "El archivo debe ser texto, PDF o Excel (.xlsx).";
  return null;
}
