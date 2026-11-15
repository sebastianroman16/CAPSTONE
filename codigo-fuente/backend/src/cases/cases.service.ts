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
import { hashPassword } from "../auth/password";
import { randomBytes } from "node:crypto";
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
  private async validateClient(clientId: string, user: SessionUser) {
    const { rowCount } = await this.db.query(
      "SELECT 1 FROM users WHERE id=$1 AND role='CLIENT' AND lawyer_id=$2 AND active=true",
      [clientId, user.id],
    );
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
    let clientId = dto.clientId;
    const dbClient = await this.db.pool.connect();
    try {
      await dbClient.query("BEGIN");
      if (clientId) {
        const owned = await dbClient.query(
          "SELECT id FROM users WHERE id=$1 AND role='CLIENT' AND lawyer_id=$2 AND active=true FOR UPDATE",
          [clientId, user.id],
        );
        if (!owned.rowCount) throw new BadRequestException("Selecciona un cliente de tu cartera.");
      } else {
        const email = dto.newClientEmail!.toLowerCase();
        const existing = (await dbClient.query(
          "SELECT id,role,lawyer_id,active FROM users WHERE email=$1 FOR UPDATE",
          [email],
        )).rows[0];
        if (existing) {
          if (existing.role !== "CLIENT" || existing.lawyer_id !== user.id || !existing.active)
            throw new ConflictException("Ya existe una cuenta con ese correo y no pertenece a tu cartera activa.");
          clientId = existing.id;
        } else {
          temporaryPassword = `Lex-${randomBytes(12).toString("base64url")}!`;
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
        : { clientCreated: false as const };
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
  async update(id: string, dto: UpdateCaseDto, user: SessionUser) {
    this.lawyer(user);
    await this.find(id, user);
    this.validateFields(dto, user);
    await this.validateClient(dto.clientId, user);
    // La comparación y el incremento son atómicos, incluso con dos peticiones simultáneas.
    const result = await this.db.query(
      `UPDATE cases SET client_id=$1,rit=$2,title=$3,matter=$4,court=$5,priority=$6,
      next_date=$7,next_date_label=$8,internal_notes=$9,updated_at=now(),version=version+1
      WHERE id=$10 AND lawyer_id=$11 AND version=$12 RETURNING id`,
      [...this.values(dto, dto.clientId), id, user.id, dto.version],
    );
    if (!result.rowCount) this.changedElsewhere();
    return this.find(id, user);
  }
  async archive(id: string, version: number, user: SessionUser) {
    this.lawyer(user);
    await this.find(id, user);
    const result = await this.db.query(
      `UPDATE cases SET status='Archivada',updated_at=now(),version=version+1
      WHERE id=$1 AND lawyer_id=$2 AND version=$3 RETURNING id`,
      [id, user.id, version],
    );
    if (!result.rowCount) this.changedElsewhere();
    return this.find(id, user);
  }
}
