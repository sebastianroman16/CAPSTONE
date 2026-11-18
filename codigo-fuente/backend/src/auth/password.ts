import { randomBytes, scrypt as derive, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(derive);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
/**
 * Contraseña temporal aleatoria para cuentas nuevas de clientes ("Lex-" + bytes aleatorios + "!").
 * El cliente debe cambiarla al primer ingreso.
 */
export function createTemporaryPassword(randomByteCount = 12) {
  return ["Lex-", randomBytes(randomByteCount).toString("base64url"), "!"].join("");
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hash] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
