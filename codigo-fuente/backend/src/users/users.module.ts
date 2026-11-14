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
import { AuthGuard, AuthRequest } from "../auth/auth.guard";
import { ConflictException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../auth/password";
import { CreateClientDto, ProfileDto } from "../product/product.dto";
@Controller("users")
@UseGuards(AuthGuard)
class UsersController {
  constructor(private readonly db: DatabaseService) {}
  @Get("clients") async clients(@Req() req: AuthRequest) {
    if (req.user.role !== "LAWYER") throw new ForbiddenException();
    return (
      await this.db.query(
        "SELECT id,name,email FROM users WHERE role='CLIENT' AND lawyer_id=$1 AND active=true ORDER BY name",
        [req.user.id],
      )
    ).rows;
  }
  @Post("clients") async createClient(@Req() req:AuthRequest,@Body() dto:CreateClientDto){
    if(req.user.role!=="LAWYER") throw new ForbiddenException();
    const existing=(await this.db.query("SELECT id FROM users WHERE email=$1",[dto.email.toLowerCase()])).rows[0];
    if(existing) throw new ConflictException("Ya existe una cuenta con ese correo.");
    const temporaryPassword=`Lex-${randomBytes(9).toString("base64url")}!`;
    const client=await this.db.pool.connect();
    try{await client.query("BEGIN");const row=(await client.query(`INSERT INTO users(name,email,phone,password_hash,role,lawyer_id,must_change_password) VALUES($1,$2,$3,$4,'CLIENT',$5,true) RETURNING id,name,email,phone`,[dto.name,dto.email.toLowerCase(),dto.phone||null,await hashPassword(temporaryPassword),req.user.id])).rows[0];await client.query("COMMIT");return {...row,temporaryPassword};}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }
  @Patch("me") async profile(@Req()req:AuthRequest,@Body()dto:ProfileDto){
    const conflict=(await this.db.query("SELECT 1 FROM users WHERE email=$1 AND id<>$2",[dto.email.toLowerCase(),req.user.id])).rowCount;
    if(conflict)throw new ConflictException("Ese correo ya está en uso.");
    return (await this.db.query(`UPDATE users SET name=$1,email=$2,phone=$3 WHERE id=$4 RETURNING id,name,email,phone,role,must_change_password AS "mustChangePassword"`,[dto.name,dto.email.toLowerCase(),dto.phone||null,req.user.id])).rows[0];
  }
}
@Module({ imports: [AuthModule], controllers: [UsersController] })
export class UsersModule {}
