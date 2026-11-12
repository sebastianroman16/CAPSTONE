import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CasesController } from "./cases.controller";
import { CasesService } from "./cases.service";
import { ProgressService } from "./progress.service";
import { CaseImportController } from "./case-import.controller";
import { CaseImportService } from "./case-import.service";
@Module({
  imports: [AuthModule],
  controllers: [CasesController, CaseImportController],
  providers: [CasesService, ProgressService, CaseImportService],
  exports: [ProgressService],
})
export class CasesModule {}
