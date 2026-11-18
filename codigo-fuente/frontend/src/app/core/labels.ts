/** Textos que ve el usuario para los códigos internos de la API. */
export const CHANNEL_LABELS: Record<string, string> = {
  IN_APP: "Bandeja interna",
  EMAIL: "Correo",
  WHATSAPP: "WhatsApp",
};
export const DELIVERY_LABELS: Record<string, string> = {
  DELIVERED: "Entregado",
  PENDING: "Pendiente de envío",
  FAILED: "No entregado",
};
/** HU-16 y HU-22: la solicitud queda "pendiente" hasta que el cliente responde y pasa a "recibido". */
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  IN_REVIEW: "En revisión",
  FULFILLED: "Recibido",
  CANCELLED: "Cancelada",
};
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  EMAIL: "Correo",
  PDF: "PDF",
  EXCEL: "Excel",
  TEXT: "Texto",
};
export const MOVEMENT_LABELS: Record<string, string> = {
  AUDIENCIA: "Audiencia",
  "RESOLUCIÓN": "Resolución",
  SENTENCIA: "Sentencia",
  "NOTIFICACIÓN": "Notificación",
  MOVIMIENTO: "Otro movimiento",
};
export const DEADLINE_TYPE_LABELS: Record<string, string> = {
  HEARING: "Audiencia",
  FILING: "Presentación de escrito",
  MEETING: "Reunión",
  REMINDER: "Recordatorio",
  OTHER: "Otro",
};

/** Devuelve el texto visible; si el código no es conocido, lo muestra tal cual en vez de ocultarlo. */
export function label(labels: Record<string, string>, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return labels[value] ?? value;
}

/** Tamaño legible de un archivo: 412 KB, 1,2 MB. */
export function fileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
