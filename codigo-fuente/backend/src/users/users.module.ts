import {
  Controller,
  ForbiddenException,
  Get,
  Module,
  Req,
  UseGuards,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AuthModule } from "../auth/auth.module";
import { AuthGuard, AuthRequest } from "../auth/auth.guard";
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
}
@Module({ imports: [AuthModule], controllers: [UsersController] })
export class UsersModule {}
