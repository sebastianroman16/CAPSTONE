import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { UserThrottlerGuard } from "./auth/user-throttler.guard";
import { DatabaseModule } from "./database/database.module";
import { DatabaseService } from "./database/database.service";
import { AuthModule } from "./auth/auth.module";
import { CasesModule } from "./cases/cases.module";
import { UsersModule } from "./users/users.module";
import { SupervisionModule } from "./supervision/supervision.module";
import { ProductModule } from "./product/product.module";
import { AssistantModule } from "./assistant/assistant.module";
import { AdminModule } from "./admin/admin.module";
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
  @Get("readiness") async readiness() {
    await this.health();
    return {
      status:"ready",
      database:true,
      documents:Boolean(process.env.DOCUMENT_STORAGE_PATH),
      notifications:Boolean(process.env.NOTIFICATION_WEBHOOK_URL),
      passwordRecovery:Boolean(process.env.RESET_DELIVERY_WEBHOOK_URL),
      clientCredentials:Boolean(process.env.CLIENT_CREDENTIALS_WEBHOOK_URL),
      incomingEmail:Boolean(process.env.INGESTION_WEBHOOK_SECRET),
      assistedSummary:Boolean(process.env.GEMINI_API_KEY),
    };
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
    AssistantModule,
    AdminModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
  ],
  controllers: [HealthController],
  // E26: límites por usuario autenticado (por IP solo sin sesión y en las rutas públicas de acceso).
  providers: [{ provide: APP_GUARD, useClass: UserThrottlerGuard }],
})
export class AppModule {}
