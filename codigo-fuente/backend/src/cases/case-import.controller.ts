import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { AuthGuard, AuthRequest } from "../auth/auth.guard";
import { ImportMappingDto } from "./case-import.dto";
import { CaseImportService } from "./case-import.service";

@Controller("case-imports")
@UseGuards(AuthGuard)
export class CaseImportController {
  constructor(private readonly imports: CaseImportService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { files: 1, fileSize: 5 * 1024 * 1024 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthRequest,
  ) {
    return this.imports.upload(file, req.user);
  }

  @Post(":id/validate")
  validate(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ImportMappingDto,
    @Req() req: AuthRequest,
  ) {
    return this.imports.validate(id, dto.mapping, req.user);
  }

  @Post(":id/confirm")
  confirm(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.imports.confirm(id, req.user);
  }
}
