import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { DatabaseModule } from "./database/database.module";
import { DatabaseService } from "./database/database.service";
import { AuthModule } from "./auth/auth.module";
import { CasesModule } from "./cases/cases.module";
import { UsersModule } from "./users/users.module";
import { SupervisionModule } from "./supervision/supervision.module";
import { ProductModule } from "./product/product.module";
@Controller("health")
class HealthController {
  constructor(private readonly db: DatabaseService) {}
  @Get() async health() {
    try {
      await this.db.query("SELECT 1");
      return { status: "ok", database: "up" };
    } catch {
      throw new ServiceUnavailableException("Base de datos no disponible.");
    }
  }
}
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    CasesModule,
    UsersModule,
    SupervisionModule,
    ProductModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
