import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SessionUser } from "../auth/auth.service";
import { CreateCaseDto, CaseFieldsDto, UpdateCaseDto } from "./case.dto";
import { createTemporaryPassword, hashPassword } from "../auth/password";
@Injectable()
export class CasesService {
  constructor(private readonly db: DatabaseService) {}
  private lawyer(user: SessionUser) {
    if (user.role !== "LAWYER")
      throw new ForbiddenException("Solo el abogado puede modificar causas.");
  }
  private scope(user: SessionUser) {
    if (user.role === "SUPERVISOR")
      throw new ForbiddenException("Utiliza el panel de supervisión.");
    return user.role === "LAWYER" ? "c.lawyer_id" : "c.client_id";
  }
  private select(user: SessionUser) {
    return `SELECT c.id, c.reference, c.rit, c.title, c.matter, c.court, c.priority, c.status, c.version,
      to_char(c.next_date, 'YYYY-MM-DD') AS "nextDate", c.next_date_label AS "nextDateLabel",
      c.client_id AS "clientId", u.name AS "clientName", c.created_at AS "createdAt", c.updated_at AS "updatedAt"
      ${user.role === "LAWYER" ? ', c.internal_notes AS "internalNotes", c.progress_stage AS "progressStage", c.progress_summary AS "progressSummary", c.next_action AS "nextAction", c.progress_updated_at AS "progressUpdatedAt"' : ""}
      FROM cases c JOIN users u ON u.id=c.client_id`;
  }
  async list(user: SessionUser) {
    return (
      await this.db.query(
        `${this.select(user)} WHERE ${this.scope(user)}=$1
      ORDER BY CASE c.priority WHEN 'Alta' THEN 0 WHEN 'Media' THEN 1 ELSE 2 END, c.next_date ASC NULLS LAST, c.id`,
        [user.id],
      )
    ).rows;
  }
  async find(id: string, user: SessionUser) {
    const { rows } = await this.db.query(
      `${this.select(user)} WHERE c.id=$1 AND ${this.scope(user)}=$2`,
      [id, user.id],
    );
    if (!rows[0]) throw new NotFoundException("Causa no encontrada.");
    return rows[0];
  }
  private validateFields(dto: CaseFieldsDto, user: SessionUser) {
    this.lawyer(user);
    if (
      dto.nextDate &&
      (Number.isNaN(Date.parse(dto.nextDate)) ||
        new Date(dto.nextDate).toISOString().slice(0, 10) !== dto.nextDate)
    ) {
      throw new BadRequestException("Fecha no válida.");
    }
  }
  // La cartera vigente se define por las asignaciones activas, no por users.lawyer_id:
  // un cliente puede tener varios abogados y la reasignación de causas crea asignaciones nuevas.
  private static readonly PORTFOLIO_CLIENT = `SELECT u.id FROM users u
    JOIN lawyer_client_assignments a ON a.client_id=u.id AND a.ended_at IS NULL
    WHERE u.id=$1 AND u.role='CLIENT' AND u.active=true AND a.lawyer_id=$2`;
  private async validateClient(clientId: string, user: SessionUser) {
    const { rowCount } = await this.db.query(CasesService.PORTFOLIO_CLIENT, [
      clientId,
      user.id,
    ]);
    if (!rowCount)
      throw new BadRequestException("Selecciona un cliente de tu cartera.");
  }
  private values(dto: CaseFieldsDto, clientId: string) {
    return [
      clientId,
      dto.rit || null,
      dto.title,
      dto.matter,
      dto.court,
      dto.priority,
      dto.nextDate || null,
      dto.nextDateLabel || null,
      dto.internalNotes || null,
    ];
  }
  async create(dto: CreateCaseDto, user: SessionUser) {
    this.validateFields(dto, user);
    const wantsNewClient = Boolean(dto.newClientName || dto.newClientEmail || dto.newClientPhone);
    if ((dto.clientId && wantsNewClient) || (!dto.clientId && !wantsNewClient))
      throw new BadRequestException("Selecciona un cliente existente o ingresa los datos del cliente nuevo.");
    if (wantsNewClient && (!dto.newClientName || !dto.newClientEmail))
      throw new BadRequestException("El nombre y el correo del cliente nuevo son obligatorios.");

    let temporaryPassword: string | undefined;
    let clientCreated = false;
    let clientLinked = false;
    let clientId = dto.clientId;
    const dbClient = await this.db.pool.connect();
    try {
      await dbClient.query("BEGIN");
      if (clientId) {
        const owned = await dbClient.query(`${CasesService.PORTFOLIO_CLIENT} FOR UPDATE OF u`, [
          clientId,
          user.id,
        ]);
        if (!owned.rowCount) throw new BadRequestException("Selecciona un cliente de tu cartera.");
      } else {
        const email = dto.newClientEmail!.toLowerCase();
        const existing = (await dbClient.query(
          "SELECT id,role,active FROM users WHERE email=$1 FOR UPDATE",
          [email],
        )).rows[0];
        if (existing) {
          if (existing.role !== "CLIENT" || !existing.active)
            throw new ConflictException("Ya existe una cuenta con ese correo que no corresponde a un cliente activo.");
          // CU-01, curso alterno: la cuenta ya existe (propia o de otro abogado) y se asocia sin duplicarla.
          const linked = await dbClient.query(
            `INSERT INTO lawyer_client_assignments(lawyer_id,client_id,assigned_by,reason)
             VALUES($1,$2,$1,'Cliente existente asociado al registrar una causa')
             ON CONFLICT (lawyer_id,client_id) WHERE ended_at IS NULL DO NOTHING`,
            [user.id, existing.id],
          );
          clientLinked = Boolean(linked.rowCount);
          clientId = existing.id;
        } else {
          temporaryPassword = createTemporaryPassword();
          const inserted = await dbClient.query(
            `INSERT INTO users(name,email,phone,password_hash,role,lawyer_id,must_change_password)
             VALUES($1,$2,$3,$4,'CLIENT',$5,true) RETURNING id`,
            [dto.newClientName, email, dto.newClientPhone || null, await hashPassword(temporaryPassword), user.id],
          );
          clientId = inserted.rows[0].id;
          clientCreated = true;
        }
      }
      const created = await dbClient.query(
        `INSERT INTO cases
        (client_id,rit,title,matter,court,priority,next_date,next_date_label,internal_notes,lawyer_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [...this.values(dto, clientId!), user.id],
      );
      await dbClient.query("COMMIT");
      const legalCase = await this.find(created.rows[0].id, user);
      const onboarding = clientCreated
        ? await this.deliverClientCredentials(dto.newClientEmail!, dto.newClientName!, temporaryPassword!)
        : { clientCreated: false as const, clientLinked };
      return { ...legalCase, onboarding };
    } catch (error) {
      await dbClient.query("ROLLBACK");
      throw error;
    } finally {
      dbClient.release();
    }
  }

  private async deliverClientCredentials(email: string, name: string, temporaryPassword: string) {
    const url = process.env.CLIENT_CREDENTIALS_WEBHOOK_URL;
    let deliveryStatus: "DELIVERED" | "PENDING" | "FAILED" = "PENDING";
    if (url) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to: email,
            template: "client-welcome",
            name,
            temporaryPassword,
            loginUrl: `${process.env.FRONTEND_ORIGIN || "http://localhost:4200"}/iniciar-sesion`,
          }),
        });
        deliveryStatus = response.ok ? "DELIVERED" : "FAILED";
      } catch {
        deliveryStatus = "FAILED";
      }
    }
    return { clientCreated: true as const, temporaryPassword, deliveryStatus };
  }

  private changedElsewhere(): never {
    throw new ConflictException({
      code: "CASE_VERSION_CONFLICT",
      message:
        "Esta causa cambió desde que la abriste. Revisa los datos más recientes antes de guardar.",
    });
  }
  private archivedReadOnly(): never {
    throw new BadRequestException({
      code: "CASE_ARCHIVED",
      message: "La causa archivada es de solo lectura. Reactívala para editarla.",
    });
  }
  async update(id: string, dto: UpdateCaseDto, user: SessionUser) {
    this.lawyer(user);
    await this.find(id, user);
    this.validateFields(dto, user);
    await this.validateClient(dto.clientId, user);
    // La comparación y el incremento son atómicos, incluso con dos peticiones simultáneas.
    // E12: una causa archivada no se edita; primero debe reactivarse.
    const result = await this.db.query(
      `UPDATE cases SET client_id=$1,rit=$2,title=$3,matter=$4,court=$5,priority=$6,
      next_date=$7,next_date_label=$8,internal_notes=$9,updated_at=now(),version=version+1
      WHERE id=$10 AND lawyer_id=$11 AND version=$12 AND status<>'Archivada' RETURNING id`,
      [...this.values(dto, dto.clientId), id, user.id, dto.version],
    );
    if (!result.rowCount) await this.explainRejectedWrite(id, user, dto.version);
    return this.find(id, user);
  }
  /** Si la versión cambió, es un conflicto (409); si coincide pero está archivada, es solo lectura (400). */
  private async explainRejectedWrite(id: string, user: SessionUser, version: number): Promise<never> {
    const current = await this.find(id, user);
    if (current.version !== version) this.changedElsewhere();
    if (current.status === "Archivada") this.archivedReadOnly();
    this.changedElsewhere();
  }
  async archive(id: string, version: number, user: SessionUser) {
    return this.changeStatus(id, version, user, "Archivada");
  }
  /** E22: deshace el archivo para poder volver a editar la causa; queda en el historial de estados. */
  async reactivate(id: string, version: number, user: SessionUser) {
    return this.changeStatus(id, version, user, "Activa");
  }
  private async changeStatus(id: string, version: number, user: SessionUser, status: "Activa" | "Archivada") {
    this.lawyer(user);
    await this.find(id, user);
    const result = await this.db.query(
      `UPDATE cases SET status=$4::varchar,updated_at=now(),version=version+1
      WHERE id=$1 AND lawyer_id=$2 AND version=$3 AND status<>$4::varchar RETURNING id`,
      [id, user.id, version, status],
    );
    if (!result.rowCount) {
      const latest = await this.find(id, user);
      if (latest.version !== version) this.changedElsewhere();
      throw new BadRequestException(status === "Activa" ? "La causa ya está activa." : "La causa ya está archivada.");
    }
    return this.find(id, user);
  }
}
