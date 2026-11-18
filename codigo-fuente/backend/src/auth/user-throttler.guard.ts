import { Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from "@nestjs/throttler";
import { createHash } from "node:crypto";
import { DatabaseService } from "../database/database.service";

/** Rutas públicas de acceso: se limitan por IP para frenar intentos masivos de contraseña. */
const IP_ONLY_PATHS = new Set(["/api/auth/login", "/api/auth/forgot-password", "/api/auth/reset-password"]);

/**
 * E26: los límites de peticiones se cuentan por usuario autenticado y no por IP.
 * En una corporación todos los abogados pueden salir a internet con la misma IP pública;
 * contar por IP hacía que el equipo completo compartiera un solo cupo (por ejemplo,
 * 8 preguntas por minuto a Lexi para toda la oficina).
 *
 * La sesión se valida contra la base: un token inventado no abre un cupo nuevo y cae en el
 * conteo por IP. Sin sesión válida, o en las rutas públicas de acceso, se cuenta por IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly db: DatabaseService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ipTracker = await super.getTracker(req);
    const path = String(req.originalUrl ?? req.url ?? "").split("?")[0];
    const token = req.cookies?.lex_session;
    if (IP_ONLY_PATHS.has(path) || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return ipTracker;
    const { rows } = await this.db.query(
      `SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active=true`,
      [createHash("sha256").update(token).digest("hex")],
    );
    return rows[0] ? `user:${rows[0].user_id}` : ipTracker;
  }
}
