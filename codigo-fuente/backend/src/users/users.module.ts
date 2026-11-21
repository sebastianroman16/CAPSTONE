import {
  Controller,
  ForbiddenException,
  Get,
  Body,
  Patch,
  Post,
  Module,
  Req,
  UseGuards,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AuthModule } from "../auth/auth.module";
import { AllowTemporaryPassword, AuthGuard, AuthRequest } from "../auth/auth.guard";
import { ConflictException } from "@nestjs/common";
import { createTemporaryPassword, hashPassword } from "../auth/password";
import { credentialsForLawyer, deliverClientCredentials } from "../cases/client-credentials";
import { CreateClientDto, ProfileDto } from "../product/product.dto";
@Controller("users")
@UseGuards(AuthGuard)
class UsersController {
  constructor(private readonly db: DatabaseService) {}
  @Get("clients") async clients(@Req() req: AuthRequest) {
    if (req.user.role !== "LAWYER") throw new ForbiddenException();
    return (
      await this.db.query(
        `SELECT DISTINCT u.id,u.name,u.email FROM users u
         JOIN lawyer_client_assignments a ON a.client_id=u.id AND a.ended_at IS NULL
         WHERE u.role='CLIENT' AND a.lawyer_id=$1 AND u.active=true ORDER BY u.name`,
        [req.user.id],
      )
    ).rows;
  }
  @Post("clients") async createClient(@Req() req:AuthRequest,@Body() dto:CreateClientDto){
    if(req.user.role!=="LAWYER") throw new ForbiddenException();
    const existing=(await this.db.query("SELECT id FROM users WHERE email=$1",[dto.email.toLowerCase()])).rows[0];
    if(existing) throw new ConflictException("Ya existe una cuenta con ese correo.");
    const temporaryPassword=createTemporaryPassword(9);
    const client=await this.db.pool.connect();
    try{await client.query("BEGIN");const row=(await client.query(`INSERT INTO users(name,email,phone,password_hash,role,lawyer_id,must_change_password) VALUES($1,$2,$3,$4,'CLIENT',$5,true) RETURNING id,name,email,phone`,[dto.name,dto.email.toLowerCase(),dto.phone||null,await hashPassword(temporaryPassword),req.user.id])).rows[0];await client.query("COMMIT");
      // HU-31: la cuenta creada desde la cartera también recibe sus credenciales por correo.
      const deliveryStatus=await deliverClientCredentials(row.email,row.name,temporaryPassword);
      return {...row,...credentialsForLawyer(temporaryPassword,deliveryStatus)};}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }
  /**
   * HU-05 (mockup 04): datos de la corporación en el perfil. El sistema atiende a una corporación,
   * configurada en CORPORATION_NAME; la oficina es la del usuario o, para el cliente, la de su abogado.
   */
  @Get("me/summary") async summary(@Req() req: AuthRequest) {
    const user = req.user;
    const own = (await this.db.query(`SELECT office,created_at AS "memberSince" FROM users WHERE id=$1`, [user.id])).rows[0];
    const scope = user.role === "LAWYER" ? "lawyer_id=$1" : user.role === "CLIENT" ? "client_id=$1" : "true";
    const activeCases = (await this.db.query(
      `SELECT count(*)::int AS n FROM cases WHERE status='Activa' AND ${scope}`,
      user.role === "SUPERVISOR" ? [] : [user.id],
    )).rows[0].n;
    const lawyers = user.role !== "CLIENT" ? [] : (await this.db.query(
      `SELECT u.name,u.email,u.phone,u.office FROM lawyer_client_assignments a JOIN users u ON u.id=a.lawyer_id
       WHERE a.client_id=$1 AND a.ended_at IS NULL AND u.active=true ORDER BY a.assigned_at,u.name`,
      [user.id],
    )).rows;
    return {
      corporation: process.env.CORPORATION_NAME?.trim() || "Corporación de Asistencia Judicial",
      office: own.office ?? lawyers.find((lawyer: any) => lawyer.office)?.office ?? null,
      memberSince: own.memberSince,
      activeCases,
      lawyers: lawyers.map(({ name, email, phone }: any) => ({ name, email, phone })),
    };
  }
  @Patch("me") @AllowTemporaryPassword()
  async profile(@Req()req:AuthRequest,@Body()dto:ProfileDto){
    const conflict=(await this.db.query("SELECT 1 FROM users WHERE email=$1 AND id<>$2",[dto.email.toLowerCase(),req.user.id])).rowCount;
    if(conflict)throw new ConflictException("Ese correo ya está en uso.");
    return (await this.db.query(`UPDATE users SET name=$1,email=$2,phone=$3 WHERE id=$4 RETURNING id,name,email,phone,role,must_change_password AS "mustChangePassword"`,[dto.name,dto.email.toLowerCase(),dto.phone||null,req.user.id])).rows[0];
  }
}
@Module({ imports: [AuthModule], controllers: [UsersController] })
export class UsersModule {}
