import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SessionUser } from "../auth/auth.service";
import { ProgressDto } from "./progress.dto";
@Injectable()
export class ProgressService {
  constructor(private readonly db: DatabaseService) {}
  async history(id: string, user: SessionUser) {
    if (!["LAWYER", "SUPERVISOR"].includes(user.role))
      throw new ForbiddenException();
    const found = await this.db.query(
      "SELECT 1 FROM cases WHERE id=$1 AND ($2::boolean OR lawyer_id=$3)",
      [id, user.role === "SUPERVISOR", user.id],
    );
    if (!found.rowCount) throw new NotFoundException("Causa no encontrada.");
    return (
      await this.db.query(
        `SELECT e.id, e.stage, e.summary, e.next_action AS "nextAction",
      e.created_at AS "createdAt", e.case_version AS "caseVersion", u.name AS "authorName"
      FROM case_progress_events e JOIN users u ON u.id=e.author_id
      WHERE e.case_id=$1 ORDER BY e.case_version DESC LIMIT 100`,
        [id],
      )
    ).rows;
  }
  async update(id: string, dto: ProgressDto, user: SessionUser) {
    if (user.role !== "LAWYER")
      throw new ForbiddenException(
        "Solo el abogado responsable puede registrar avances.",
      );
    const found = await this.db.query(
      "SELECT status FROM cases WHERE id=$1 AND lawyer_id=$2",
      [id, user.id],
    );
    if (!found.rowCount) throw new NotFoundException("Causa no encontrada.");
    if (found.rows[0].status === "Archivada")
      throw new BadRequestException(
        "No se pueden registrar avances en una causa archivada.",
      );
    // El avance, su versión y el evento se guardan juntos o no se guarda ninguno.
    const result = await this.db.query(
      `WITH changed AS (
      UPDATE cases SET progress_stage=$1,progress_summary=$2,next_action=$3,
        progress_updated_at=now(),updated_at=now(),version=version+1
      WHERE id=$4 AND lawyer_id=$5 AND version=$6 AND status='Activa'
      RETURNING id,version
    ) INSERT INTO case_progress_events (case_id,author_id,case_version,stage,summary,next_action)
      SELECT id,$5,version,$1,$2,$3 FROM changed RETURNING id`,
      [dto.stage, dto.summary, dto.nextAction, id, user.id, dto.version],
    );
    if (!result.rowCount)
      throw new ConflictException({
        code: "CASE_VERSION_CONFLICT",
        message:
          "La causa cambió. Revisa los datos actuales antes de registrar el avance.",
      });
    return { saved: true };
  }
}
