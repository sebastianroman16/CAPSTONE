import {
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { AuthModule } from "../auth/auth.module";
import { AuthGuard, AuthRequest } from "../auth/auth.guard";
import { SessionUser } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
import { CasesModule } from "../cases/cases.module";
import { ProgressService } from "../cases/progress.service";
import { PROGRESS_STAGES } from "../cases/progress.dto";

class SupervisionQuery {
  @IsOptional() @IsUUID() lawyerId?: string;
  @IsOptional() @IsIn(["Activa", "Archivada"]) status?: string;
  @IsOptional() @IsIn(["NOT_REPORTED", ...PROGRESS_STAGES]) stage?: string;
  @IsOptional() @IsIn(["needed"]) attention?: string;
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  q?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page: number = 1;
}
const needsAttention = `(c.status='Activa' AND c.progress_stage<>'COMPLETED' AND
  (c.progress_updated_at IS NULL OR c.progress_updated_at < now()-interval '14 days'))`;
const fields = `c.id,c.reference,c.rit,c.title,c.matter,c.court,c.priority,c.status,
  c.lawyer_id AS "lawyerId", l.name AS "lawyerName", l.active AS "lawyerActive",
  u.name AS "clientName", c.progress_stage AS "progressStage", c.progress_summary AS "progressSummary",
  c.next_action AS "nextAction", c.progress_updated_at AS "progressUpdatedAt",
  to_char(c.next_date,'YYYY-MM-DD') AS "nextDate", c.next_date_label AS "nextDateLabel",
  c.updated_at AS "updatedAt", ${needsAttention} AS "needsAttention"`;
const joins =
  "FROM cases c JOIN users l ON l.id=c.lawyer_id JOIN users u ON u.id=c.client_id";
@Injectable()
class SupervisionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly progress: ProgressService,
  ) {}
  private authorize(user: SessionUser) {
    if (user.role !== "SUPERVISOR")
      throw new ForbiddenException(
        "Acceso exclusivo del coordinador jurídico.",
      );
  }
  async dashboard(user: SessionUser, query: SupervisionQuery) {
    this.authorize(user);
    const connection = await this.db.pool.connect();
    try {
      await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const lawyers = (
        await connection.query(`SELECT l.id,l.name,l.active AS "accountActive",
        count(c.id)::int AS total,
        count(c.id) FILTER (WHERE c.status='Activa')::int AS active,
        count(c.id) FILTER (WHERE c.status='Archivada')::int AS archived,
        count(c.id) FILTER (WHERE c.status='Activa' AND c.priority='Alta')::int AS "highPriority",
        count(c.id) FILTER (WHERE ${needsAttention})::int AS "needsAttention",
        count(c.id) FILTER (WHERE c.progress_stage='COMPLETED')::int AS completed
        FROM users l LEFT JOIN cases c ON c.lawyer_id=l.id WHERE l.role='LAWYER'
        GROUP BY l.id,l.name,l.active ORDER BY l.name,l.id`)
      ).rows;
      const values: unknown[] = [];
      const filters: string[] = [];
      const where = (sql: string, value: unknown) => {
        values.push(value);
        filters.push(sql.replace("?", "$" + values.length));
      };
      if (query.lawyerId) where("c.lawyer_id=?", query.lawyerId);
      if (query.status) where("c.status=?", query.status);
      if (query.stage) where("c.progress_stage=?", query.stage);
      if (query.attention) filters.push(needsAttention);
      // La búsqueda trata %, _ y barras como texto, no como patrones del usuario.
      if (query.q)
        where(
          "concat_ws(' ',c.reference,c.rit,c.title,l.name,u.name) ILIKE ?",
          "%" + query.q.replace(/[\\%_]/g, "\\$&") + "%",
        );
      values.push((query.page - 1) * 20);
      const result = (
        await connection.query(
          `WITH filtered AS (
        SELECT ${fields} ${joins} ${filters.length ? "WHERE " + filters.join(" AND ") : ""}
      ), paged AS (SELECT * FROM filtered ORDER BY "needsAttention" DESC,"progressUpdatedAt" ASC NULLS FIRST,id LIMIT 20 OFFSET $${values.length})
      SELECT now() AS "asOf", (SELECT count(*)::int FROM filtered) AS total,
        COALESCE((SELECT json_agg(paged) FROM paged),'[]'::json) AS items`,
          values,
        )
      ).rows[0];
      await connection.query("COMMIT");
      const summary = lawyers.reduce(
        (acc: any, lawyer: any) => {
          for (const key of [
            "total",
            "active",
            "archived",
            "highPriority",
            "needsAttention",
            "completed",
          ])
            acc[key] += lawyer[key];
          return acc;
        },
        {
          total: 0,
          active: 0,
          archived: 0,
          highPriority: 0,
          needsAttention: 0,
          completed: 0,
        },
      );
      return {
        ...result,
        summary,
        lawyers,
        page: query.page,
        pageSize: 20,
        staleAfterDays: 14,
      };
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }
  async detail(id: string, user: SessionUser) {
    this.authorize(user);
    const result = await this.db.query(
      `SELECT ${fields} ${joins} WHERE c.id=$1`,
      [id],
    );
    if (!result.rowCount) throw new NotFoundException("Causa no encontrada.");
    return {
      ...result.rows[0],
      history: await this.progress.history(id, user),
    };
  }
}
@Controller("supervision")
@UseGuards(AuthGuard)
class SupervisionController {
  constructor(private readonly service: SupervisionService) {}
  @Get() dashboard(@Req() req: AuthRequest, @Query() query: SupervisionQuery) {
    return this.service.dashboard(req.user, query);
  }
  @Get("cases/:id") detail(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.service.detail(id, req.user);
  }
}
@Module({
  imports: [AuthModule, CasesModule],
  providers: [SupervisionService],
  controllers: [SupervisionController],
})
export class SupervisionModule {}
