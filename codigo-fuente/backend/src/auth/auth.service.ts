import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { hashPassword, verifyPassword } from "./password";
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "LAWYER" | "CLIENT" | "SUPERVISOR";
  phone?: string | null;
  mustChangePassword: boolean;
}
const SESSION_ABSOLUTE_HOURS = 8;
// El frontend avisa tras 3 minutos sin actividad y concede 10 segundos para confirmar.
// E14: el frontend informa actividad al servidor como máximo una vez por minuto, así que la
// última señal recibida puede tener hasta 60 segundos de antigüedad cuando empieza a contar
// la inactividad. Sin ese minuto, el servidor cerraba la sesión hasta ~45 s antes del aviso.
// Cinco segundos adicionales cubren la latencia de red de la confirmación.
export const SESSION_IDLE_SECONDS = 3 * 60 + 60 + 10 + 5;
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
  async changePassword(user: SessionUser, currentPassword: string, newPassword: string) {
    const row = (await this.db.query("SELECT password_hash,must_change_password FROM users WHERE id=$1", [user.id])).rows[0];
    if (!row || !(await verifyPassword(currentPassword, row.password_hash)))
      throw new UnauthorizedException("La contraseña actual no es correcta.");
    if (await verifyPassword(newPassword, row.password_hash))
      throw new BadRequestException("La nueva contraseña debe ser diferente.");
    await this.db.query(
      `UPDATE users SET password_hash=$1,must_change_password=false,failed_login_attempts=0,locked_until=NULL WHERE id=$2`,
      [await hashPassword(newPassword), user.id],
    );
    await this.db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1", [user.id]);
    return { ok: true };
  }
  async forgotPassword(email: string) {
    const user = (await this.db.query("SELECT id,email FROM users WHERE email=$1 AND active=true", [email.toLowerCase().trim()])).rows[0];
    let developmentToken: string | undefined;
    if (user) {
      const token = randomBytes(32).toString("hex");
      await this.db.query(
        `INSERT INTO password_reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')`,
        [digest(token), user.id],
      );
      const resetUrl = `${process.env.FRONTEND_ORIGIN || "http://localhost:4200"}/restablecer-contrasena?token=${token}`;
      if (process.env.RESET_DELIVERY_WEBHOOK_URL) {
        try { await fetch(process.env.RESET_DELIVERY_WEBHOOK_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({to:user.email,template:"password-reset",resetUrl})}); } catch { /* respuesta indistinguible para evitar enumeración */ }
      } else if (process.env.NODE_ENV !== "production") developmentToken = token;
    }
    return { ok: true, developmentToken };
  }
  async resetPassword(token: string, newPassword: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new BadRequestException("Enlace inválido o vencido.");
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      const row = (await client.query(
        `UPDATE password_reset_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING user_id`,
        [digest(token)],
      )).rows[0];
      if (!row) throw new BadRequestException("Enlace inválido o vencido.");
      await client.query("UPDATE users SET password_hash=$1,must_change_password=false,failed_login_attempts=0,locked_until=NULL WHERE id=$2", [await hashPassword(newPassword),row.user_id]);
      await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",[row.user_id]);
      await client.query("COMMIT"); return {ok:true};
    } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  }
  private publicUser(user: any): SessionUser {
    return { id: user.id, name: user.name, email: user.email, role: user.role, phone:user.phone, mustChangePassword:Boolean(user.must_change_password) };
  }
}
