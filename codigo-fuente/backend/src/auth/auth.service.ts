import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { hashPassword, verifyPassword } from "./password";
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "LAWYER" | "CLIENT" | "SUPERVISOR";
}
const SESSION_ABSOLUTE_HOURS = 8;
// El frontend avisa a los 3 minutos y concede 10 segundos para confirmar.
// Cinco segundos adicionales evitan que la latencia de red cierre una sesión
// mientras la confirmación ya está viajando al servidor.
const SESSION_IDLE_SECONDS = 3 * 60 + 10 + 5;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
@Injectable()
export class AuthService {
  private readonly dummyHash = hashPassword(randomBytes(32).toString("hex"));
  constructor(private readonly db: DatabaseService) {}
  async login(email: string, password: string) {
    const { rows } = await this.db.query(
      "SELECT * FROM users WHERE email = $1",
      [email.toLowerCase().trim()],
    );
    const user = rows[0];
    const valid = await verifyPassword(
      password,
      user?.password_hash ?? (await this.dummyHash),
    );
    const locked = user?.locked_until && new Date(user.locked_until) > new Date();
    if (user?.active && !valid && !locked) {
      await this.db.query(
        `UPDATE users
         SET failed_login_attempts=failed_login_attempts+1,
             locked_until=CASE
               WHEN failed_login_attempts+1 >= 5 THEN now() + interval '15 minutes'
               ELSE locked_until
             END
         WHERE id=$1`,
        [user.id],
      );
    }
    if (!user || !user.active || !valid || locked)
      throw new UnauthorizedException("Correo o contraseña incorrectos.");
    const token = randomBytes(32).toString("hex");
    await this.db.query(
      `WITH updated_user AS (
         UPDATE users
         SET failed_login_attempts=0, locked_until=NULL, last_login_at=now()
         WHERE id=$2
       )
       INSERT INTO sessions (token_hash, user_id, expires_at, last_seen_at)
       VALUES ($1, $2, now() + ($3 * interval '1 hour'), now())`,
      [digest(token), user.id, SESSION_ABSOLUTE_HOURS],
    );
    return { token, user: this.publicUser(user) };
  }
  async authenticate(token?: string): Promise<SessionUser> {
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException();
    // La validación y la renovación de actividad ocurren en una sola sentencia:
    // una petición tardía no puede revivir una sesión que ya quedó inactiva.
    const { rows } = await this.db.query(
      `UPDATE sessions s SET last_seen_at=now()
       FROM users u
       WHERE s.user_id=u.id AND s.token_hash=$1
         AND s.expires_at>now() AND s.revoked_at IS NULL AND u.active=true
         AND COALESCE(s.last_seen_at,s.created_at) >=
             now() - ($2 * interval '1 second')
       RETURNING u.*`,
      [digest(token), SESSION_IDLE_SECONDS],
    );
    if (!rows[0])
      throw new UnauthorizedException("La sesión expiró. Vuelve a ingresar.");
    return this.publicUser(rows[0]);
  }
  async logout(token?: string) {
    if (token)
      await this.db.query("UPDATE sessions SET revoked_at=now() WHERE token_hash=$1", [
        digest(token),
      ]);
  }
  private publicUser(user: any): SessionUser {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }
}
