import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, AuthRequest } from "../auth/auth.guard";
import { SaveCaseDto, UpdateCaseDto, ArchiveCaseDto } from "./case.dto";
import { CasesService } from "./cases.service";
import { ProgressDto } from "./progress.dto";
import { ProgressService } from "./progress.service";
@Controller("cases")
@UseGuards(AuthGuard)
export class CasesController {
  constructor(
    private readonly cases: CasesService,
    private readonly progress: ProgressService,
  ) {}
  @Get(":id/progress") history(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.progress.history(id, req.user);
  }
  @Patch(":id/progress") updateProgress(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ProgressDto,
    @Req() req: AuthRequest,
  ) {
    return this.progress.update(id, dto, req.user);
  }
  @Get() list(@Req() req: AuthRequest) {
    return this.cases.list(req.user);
  }
  @Get(":id") find(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.cases.find(id, req.user);
  }
  @Post() create(@Body() dto: SaveCaseDto, @Req() req: AuthRequest) {
    return this.cases.create(dto, req.user);
  }
  @Put(":id") update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateCaseDto,
    @Req() req: AuthRequest,
  ) {
    return this.cases.update(id, dto, req.user);
  }
  @Patch(":id/archive") archive(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ArchiveCaseDto,
    @Req() req: AuthRequest,
  ) {
    return this.cases.archive(id, dto.version, req.user);
  }
}
