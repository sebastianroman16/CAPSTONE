import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { AuthGuard, AuthRequest } from "../auth/auth.guard";
import { CommunicationDto, DeadlineDto, DeadlineStatusDto, DocumentMetadataDto, DocumentRequestDto, IngestionTextDto, NotificationQueryDto, ReviewIngestionDto } from "./product.dto";
import { ProductService } from "./product.service";

@Controller()
@UseGuards(AuthGuard)
export class ProductController {
  constructor(private readonly product:ProductService){}
  @Get("agenda") agenda(@Req() r:AuthRequest,@Query("from")f?:string,@Query("to")t?:string){return this.product.agenda(r.user,f,t);}
  @Post("cases/:id/deadlines") deadline(@Param("id",ParseUUIDPipe)id:string,@Body()d:DeadlineDto,@Req()r:AuthRequest){return this.product.createDeadline(id,d,r.user);}
  @Patch("deadlines/:id") deadlineStatus(@Param("id",ParseUUIDPipe)id:string,@Body()d:DeadlineStatusDto,@Req()r:AuthRequest){return this.product.deadlineStatus(id,d.status,r.user);}
  @Get("pending") pending(@Req() r:AuthRequest){return this.product.pending(r.user);}
  @Get("cases/:id/timeline") timeline(@Param("id",ParseUUIDPipe)id:string,@Req()r:AuthRequest){return this.product.timeline(id,r.user);}
  @Get("cases/:id/communications") communications(@Param("id",ParseUUIDPipe)id:string,@Req()r:AuthRequest){return this.product.communications(id,r.user);}
  @Post("cases/:id/communications") communication(@Param("id",ParseUUIDPipe)id:string,@Body()d:CommunicationDto,@Req()r:AuthRequest){return this.product.sendCommunication(id,d,r.user);}
  @Get("notifications") notifications(@Req()r:AuthRequest,@Query()q:NotificationQueryDto){return this.product.notifications(r.user,q);}
  @Patch("notifications/:id/read") read(@Param("id",ParseUUIDPipe)id:string,@Req()r:AuthRequest){return this.product.readNotification(id,r.user);}
  @Get("cases/:id/documents") documents(@Param("id",ParseUUIDPipe)id:string,@Req()r:AuthRequest){return this.product.documents(id,r.user);}
  @Post("cases/:id/documents") @UseInterceptors(FileInterceptor("file",{limits:{fileSize:20*1024*1024}}))
  upload(@Param("id",ParseUUIDPipe)id:string,@Body()d:DocumentMetadataDto,@UploadedFile()f:Express.Multer.File,@Req()r:AuthRequest){return this.product.uploadDocument(id,d,f,r.user);}
  @Get("documents/:id/download") async download(@Param("id",ParseUUIDPipe)id:string,@Req()r:AuthRequest,@Res()res:Response){const f=await this.product.documentFile(id,r.user);res.setHeader("Content-Type",f.mime_type);res.setHeader("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);res.send(f.buffer);}
  @Post("cases/:id/document-requests") request(@Param("id",ParseUUIDPipe)id:string,@Body()d:DocumentRequestDto,@Req()r:AuthRequest){return this.product.createDocumentRequest(id,d,r.user);}
  @Get("document-requests") requests(@Req()r:AuthRequest){return this.product.documentRequests(r.user);}
  @Get("ingestion") ingestion(@Req()r:AuthRequest){return this.product.ingestion(r.user);}
  @Post("ingestion/text") ingestText(@Body()d:IngestionTextDto,@Req()r:AuthRequest){return this.product.ingestText(d,r.user);}
  @Post("ingestion/file") @UseInterceptors(FileInterceptor("file",{limits:{fileSize:10*1024*1024}}))
  ingestFile(@UploadedFile()f:Express.Multer.File,@Body("caseId")caseId:string|undefined,@Req()r:AuthRequest){return this.product.ingestFile(f,caseId,r.user);}
  @Patch("ingestion/:id/review") review(@Param("id",ParseUUIDPipe)id:string,@Body()d:ReviewIngestionDto,@Req()r:AuthRequest){return this.product.reviewIngestion(id,d,r.user);}
}
