import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SessionUser } from "../auth/auth.service";
import { SaveCaseDto, UpdateCaseDto } from "./case.dto";
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
  private async validate(dto: SaveCaseDto, user: SessionUser) {
    this.lawyer(user);
    if (
      dto.nextDate &&
      (Number.isNaN(Date.parse(dto.nextDate)) ||
        new Date(dto.nextDate).toISOString().slice(0, 10) !== dto.nextDate)
    ) {
      throw new BadRequestException("Fecha no válida.");
    }
    const { rowCount } = await this.db.query(
      "SELECT 1 FROM users WHERE id=$1 AND role='CLIENT' AND lawyer_id=$2 AND active=true",
      [dto.clientId, user.id],
    );
    if (!rowCount)
      throw new BadRequestException("Selecciona un cliente de tu cartera.");
  }
  private values(dto: SaveCaseDto) {
    return [
      dto.clientId,
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
  async create(dto: SaveCaseDto, user: SessionUser) {
    await this.validate(dto, user);
    const { rows } = await this.db.query(
      `INSERT INTO cases
      (client_id,rit,title,matter,court,priority,next_date,next_date_label,internal_notes,lawyer_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [...this.values(dto), user.id],
    );
    return this.find(rows[0].id, user);
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
    await this.validate(dto, user);
    // La comparación y el incremento son atómicos, incluso con dos peticiones simultáneas.
    const result = await this.db.query(
      `UPDATE cases SET client_id=$1,rit=$2,title=$3,matter=$4,court=$5,priority=$6,
      next_date=$7,next_date_label=$8,internal_notes=$9,updated_at=now(),version=version+1
      WHERE id=$10 AND lawyer_id=$11 AND version=$12 RETURNING id`,
      [...this.values(dto), id, user.id, dto.version],
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
