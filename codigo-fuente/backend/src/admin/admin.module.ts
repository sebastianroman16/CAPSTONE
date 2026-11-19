import { Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";
import { AuthModule } from "../auth/auth.module";
import { AuthGuard, AuthRequest } from "../auth/auth.guard";
import { DatabaseService } from "../database/database.service";

class AccountStatusDto { @IsBoolean() active!:boolean; }
class ReassignCaseDto {
  @IsUUID() lawyerId!:string;
  @Transform(({value})=>typeof value==="string"?value.trim():value)
  @IsString() @MinLength(5) @MaxLength(500) reason!:string;
}
// HU-30: solo las tablas que registran triggers de auditoría (004_domain_hardening.sql).
const AUDITED_ENTITIES = ["users", "cases", "documents"] as const;
class AuditQuery {
  @IsOptional() @IsIn([...AUDITED_ENTITIES]) entityType?:string;
  @Type(()=>Number) @IsInt() @Min(1) @Max(100) limit:number=50;
}

@Injectable()
class AdminService {
  constructor(private readonly db:DatabaseService){}
  private authorize(user:AuthRequest["user"]){if(user.role!=="SUPERVISOR")throw new ForbiddenException("Acceso exclusivo del coordinador jurídico.");}
  async users(user:AuthRequest["user"]){this.authorize(user);return (await this.db.query(`SELECT u.id,u.name,u.email,u.phone,u.role,u.active,u.office,u.last_login_at AS "lastLoginAt",u.created_at AS "createdAt",count(c.id)::int AS "caseCount" FROM users u LEFT JOIN cases c ON c.lawyer_id=u.id OR c.client_id=u.id GROUP BY u.id ORDER BY u.role,u.name`)).rows;}
  async status(id:string,active:boolean,user:AuthRequest["user"]){this.authorize(user);if(id===user.id&&!active)throw new ForbiddenException("No puedes desactivar tu propia cuenta.");const result=await this.db.query(`UPDATE users SET active=$1 WHERE id=$2 RETURNING id,name,email,role,active`,[active,id]);if(!result.rowCount)throw new NotFoundException("Usuario no encontrado.");if(!active)await this.db.query(`UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1`,[id]);return result.rows[0];}
  async reassign(caseId:string,dto:ReassignCaseDto,user:AuthRequest["user"]){this.authorize(user);const client=await this.db.pool.connect();try{await client.query("BEGIN");const legalCase=(await client.query(`SELECT lawyer_id,client_id,version FROM cases WHERE id=$1 FOR UPDATE`,[caseId])).rows[0];if(!legalCase)throw new NotFoundException("Causa no encontrada.");if(legalCase.lawyer_id===dto.lawyerId)throw new ForbiddenException("La causa ya está asignada a ese abogado.");const lawyer=(await client.query(`SELECT id FROM users WHERE id=$1 AND role='LAWYER' AND active=true`,[dto.lawyerId])).rows[0];if(!lawyer)throw new NotFoundException("Abogado activo no encontrado.");await client.query(`INSERT INTO lawyer_client_assignments(lawyer_id,client_id,assigned_by,reason) VALUES($1,$2,$3,$4) ON CONFLICT (lawyer_id,client_id) WHERE ended_at IS NULL DO NOTHING`,[dto.lawyerId,legalCase.client_id,user.id,dto.reason]);await client.query(`UPDATE cases SET lawyer_id=$1,version=version+1,updated_at=now() WHERE id=$2`,[dto.lawyerId,caseId]);await client.query(`INSERT INTO case_reassignments(case_id,from_lawyer_id,to_lawyer_id,changed_by,reason) VALUES($1,$2,$3,$4,$5)`,[caseId,legalCase.lawyer_id,dto.lawyerId,user.id,dto.reason]);await client.query("COMMIT");return {id:caseId,lawyerId:dto.lawyerId,reassigned:true};}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
  async audit(query:AuditQuery,user:AuthRequest["user"]){this.authorize(user);const values:any[]=[];let where="";if(query.entityType){values.push(query.entityType);where=`WHERE a.entity_type=$1`;}values.push(query.limit);return (await this.db.query(`SELECT a.id,a.entity_type AS "entityType",a.entity_id AS "entityId",a.action,a.occurred_at AS "occurredAt",u.name AS "actorName",CASE a.entity_type WHEN 'users' THEN eu.email WHEN 'cases' THEN ec.reference WHEN 'documents' THEN ed.title END AS "entityLabel" FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN users eu ON a.entity_type='users' AND eu.id=a.entity_id LEFT JOIN cases ec ON a.entity_type='cases' AND ec.id=a.entity_id LEFT JOIN documents ed ON a.entity_type='documents' AND ed.id=a.entity_id ${where} ORDER BY a.occurred_at DESC LIMIT $${values.length}`,values)).rows;}
}

@Controller("admin") @UseGuards(AuthGuard)
class AdminController {
  constructor(private readonly service:AdminService){}
  @Get("users") users(@Req()req:AuthRequest){return this.service.users(req.user);}
  @Patch("users/:id/status") status(@Param("id",ParseUUIDPipe)id:string,@Body()dto:AccountStatusDto,@Req()req:AuthRequest){return this.service.status(id,dto.active,req.user);}
  @Patch("cases/:id/reassign") reassign(@Param("id",ParseUUIDPipe)id:string,@Body()dto:ReassignCaseDto,@Req()req:AuthRequest){return this.service.reassign(id,dto,req.user);}
  @Get("audit") audit(@Query()query:AuditQuery,@Req()req:AuthRequest){return this.service.audit(query,req.user);}
}

@Module({imports:[AuthModule],controllers:[AdminController],providers:[AdminService]})
export class AdminModule{}
