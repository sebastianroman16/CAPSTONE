import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { DatabaseService } from "../database/database.service";
import { SessionUser } from "../auth/auth.service";
import {
  CommunicationDto,
  DeadlineDto,
  DocumentMetadataDto,
  DocumentRequestDto,
  IngestionTextDto,
  ReviewIngestionDto,
} from "./product.dto";

const STORAGE_ROOT = resolve(
  process.env.DOCUMENT_STORAGE_PATH || join(process.cwd(), ".data", "documents"),
);

@Injectable()
export class ProductService {
  constructor(private readonly db: DatabaseService) {}

  private lawyer(user: SessionUser) {
    if (user.role !== "LAWYER") throw new ForbiddenException("Acción reservada al abogado.");
  }
  private async caseAccess(caseId: string, user: SessionUser, write = false) {
    if (write) this.lawyer(user);
    const clause = user.role === "SUPERVISOR"
      ? "id=$1"
      : user.role === "LAWYER"
        ? "id=$1 AND lawyer_id=$2"
        : "id=$1 AND client_id=$2";
    const values = user.role === "SUPERVISOR" ? [caseId] : [caseId, user.id];
    const { rows } = await this.db.query(`SELECT * FROM cases WHERE ${clause}`, values);
    if (!rows[0]) throw new NotFoundException("Causa no encontrada.");
    if (write && rows[0].status === "Archivada")
      throw new BadRequestException("La causa archivada es de solo lectura.");
    return rows[0];
  }

  async agenda(user: SessionUser, from?: string, to?: string) {
    const start = from || new Date().toISOString().slice(0, 10);
    const end = to || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const owner = user.role === "LAWYER" ? "c.lawyer_id" : user.role === "CLIENT" ? "c.client_id" : null;
    const values: unknown[] = [start, end];
    const scope = owner ? `AND ${owner}=$3` : "";
    if (owner) values.push(user.id);
    return (await this.db.query(
      `SELECT d.id,d.case_id AS "caseId",c.reference,c.title AS "caseTitle",
       d.deadline_type AS "deadlineType",d.title,d.description,d.due_at AS "dueAt",
       d.reminder_at AS "reminderAt",d.status
       FROM case_deadlines d JOIN cases c ON c.id=d.case_id
       WHERE d.due_at >= $1::date AND d.due_at < ($2::date + interval '1 day') ${scope}
       ORDER BY d.due_at`, values,
    )).rows;
  }
  async createDeadline(caseId: string, dto: DeadlineDto, user: SessionUser) {
    await this.caseAccess(caseId, user, true);
    if (dto.reminderAt && new Date(dto.reminderAt) > new Date(dto.dueAt))
      throw new BadRequestException("El recordatorio no puede ser posterior al plazo.");
    return (await this.db.query(
      `INSERT INTO case_deadlines(case_id,created_by,deadline_type,title,description,due_at,reminder_at)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,case_id AS "caseId",deadline_type AS "deadlineType",title,description,due_at AS "dueAt",reminder_at AS "reminderAt",status`,
      [caseId,user.id,dto.deadlineType,dto.title,dto.description||null,dto.dueAt,dto.reminderAt||null],
    )).rows[0];
  }
  async deadlineStatus(id: string, status: string, user: SessionUser) {
    this.lawyer(user);
    const result = await this.db.query(
      `UPDATE case_deadlines d SET status=$1,completed_at=CASE WHEN $1='COMPLETED' THEN now() ELSE NULL END
       FROM cases c WHERE d.id=$2 AND d.case_id=c.id AND c.lawyer_id=$3
       RETURNING d.id,d.status,d.completed_at AS "completedAt"`, [status,id,user.id],
    );
    if (!result.rows[0]) throw new NotFoundException("Plazo no encontrado.");
    return result.rows[0];
  }

  async communications(caseId: string, user: SessionUser) {
    await this.caseAccess(caseId, user);
    return (await this.db.query(
      `SELECT m.id,m.message,m.channel,m.delivery_status AS "deliveryStatus",m.created_at AS "createdAt",u.name AS "authorName"
       FROM case_communications m JOIN users u ON u.id=m.author_id
       WHERE m.case_id=$1 ORDER BY m.created_at DESC`, [caseId],
    )).rows;
  }
  async sendCommunication(caseId: string, dto: CommunicationDto, user: SessionUser) {
    const legalCase = await this.caseAccess(caseId, user, true);
    const client = (await this.db.query("SELECT id,email,phone FROM users WHERE id=$1",[legalCase.client_id])).rows[0];
    const delivery = dto.channel === "IN_APP"
      ? { ok: true as boolean, error: undefined as string | undefined }
      : await this.deliver(dto.channel, client, dto.message);
    const comm = (await this.db.query(
      `INSERT INTO case_communications(case_id,author_id,message,channel,delivery_status,delivery_error)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id,message,channel,delivery_status AS "deliveryStatus",created_at AS "createdAt"`,
      [caseId,user.id,dto.message,dto.channel,delivery.ok?"DELIVERED":"FAILED",delivery.error||null],
    )).rows[0];
    await this.db.query(
      `INSERT INTO notifications(user_id,case_id,notification_type,title,body,channel,delivery_status,delivered_at,delivery_error)
       VALUES($1,$2,'CASE_UPDATE','Nueva actualización de tu causa',$3,$4,$5,$6,$7)`,
      [client.id,caseId,dto.message,dto.channel,delivery.ok?"DELIVERED":"FAILED",delivery.ok?new Date():null,delivery.error||null],
    );
    return comm;
  }
  private async deliver(channel: string, recipient: any, message: string) {
    const url = process.env.NOTIFICATION_WEBHOOK_URL;
    if (!url) return { ok: false, error: "Proveedor externo no configurado; disponible en la bandeja interna." };
    try {
      const response = await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({channel,to:channel==="EMAIL"?recipient.email:recipient.phone,message})});
      return response.ok ? { ok: true } : { ok:false,error:`Proveedor respondió ${response.status}` };
    } catch { return { ok:false,error:"No fue posible contactar al proveedor." }; }
  }

  async notifications(user: SessionUser) {
    return (await this.db.query(
      `SELECT id,case_id AS "caseId",notification_type AS "type",title,body,channel,
       delivery_status AS "deliveryStatus",read_at AS "readAt",created_at AS "createdAt"
       FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,[user.id],
    )).rows;
  }
  async readNotification(id: string,user:SessionUser){
    const result=await this.db.query("UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id,read_at AS \"readAt\"",[id,user.id]);
    if(!result.rows[0]) throw new NotFoundException("Notificación no encontrada.");
    return result.rows[0];
  }

  async documents(caseId:string,user:SessionUser){
    await this.caseAccess(caseId,user);
    const visibility=user.role==="CLIENT"?"AND d.visibility='CLIENT'":"";
    return (await this.db.query(
      `SELECT d.id,d.title,d.description,d.category,d.visibility,d.status,d.created_at AS "createdAt",
       v.id AS "versionId",v.version,v.original_name AS "originalName",v.mime_type AS "mimeType",v.size_bytes AS "sizeBytes",u.name AS "uploadedBy"
       FROM documents d JOIN LATERAL (SELECT * FROM document_versions WHERE document_id=d.id ORDER BY version DESC LIMIT 1) v ON true
       JOIN users u ON u.id=v.uploaded_by WHERE d.case_id=$1 AND d.status='ACTIVE' ${visibility} ORDER BY d.created_at DESC`,[caseId],
    )).rows;
  }
  private validateFile(file?:Express.Multer.File){
    if(!file) throw new BadRequestException("Selecciona un archivo.");
    if(file.size>20*1024*1024) throw new BadRequestException("El archivo supera 20 MB.");
    const allowed=["application/pdf","image/png","image/jpeg","text/plain","application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if(!allowed.includes(file.mimetype)) throw new BadRequestException("Tipo de archivo no permitido.");
    return file;
  }
  async uploadDocument(caseId:string,meta:DocumentMetadataDto,file:Express.Multer.File|undefined,user:SessionUser){
    const f=this.validateFile(file); const legalCase=await this.caseAccess(caseId,user);
    if(user.role==="SUPERVISOR") throw new ForbiddenException();
    if(user.role==="CLIENT" && meta.visibility!=="CLIENT") throw new ForbiddenException();
    if(user.role!=="CLIENT" && meta.requestId) throw new BadRequestException("Solo el cliente puede responder una solicitud documental.");
    if(user.role==="CLIENT") {
      const pending=(await this.db.query(
        `SELECT id FROM document_requests WHERE case_id=$1 AND assigned_to=$2 AND status IN ('PENDING','IN_REVIEW')`,
        [caseId,user.id],
      )).rows;
      if(pending.length && !meta.requestId)
        throw new BadRequestException("Selecciona la solicitud que estás respondiendo.");
      if(meta.requestId && !pending.some((request:any)=>request.id===meta.requestId))
        throw new BadRequestException("La solicitud seleccionada no está pendiente o no pertenece a esta causa.");
    }
    await mkdir(STORAGE_ROOT,{recursive:true});
    const key=`${caseId}-${randomBytes(16).toString("hex")}${extname(f.originalname).toLowerCase()}`;
    await writeFile(join(STORAGE_ROOT,key),f.buffer,{flag:"wx"});
    const client=await this.db.pool.connect();
    try{
      await client.query("BEGIN");
      const doc=(await client.query(`INSERT INTO documents(case_id,created_by,title,description,category,visibility) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[caseId,user.id,meta.title,meta.description||null,meta.category,meta.visibility])).rows[0];
      await client.query(`INSERT INTO document_versions(document_id,version,storage_key,original_name,mime_type,size_bytes,checksum_sha256,uploaded_by) VALUES($1,1,$2,$3,$4,$5,$6,$7)`,[doc.id,key,f.originalname,f.mimetype,f.size,createHash("sha256").update(f.buffer).digest("hex"),user.id]);
      if(user.role==="CLIENT" && meta.requestId) {
        const fulfilled=await client.query(
          `UPDATE document_requests SET status='FULFILLED',fulfilled_document_id=$1,responded_at=now()
           WHERE id=$2 AND case_id=$3 AND assigned_to=$4 AND status IN ('PENDING','IN_REVIEW') RETURNING id`,
          [doc.id,meta.requestId,caseId,user.id],
        );
        if(!fulfilled.rowCount) throw new BadRequestException("La solicitud ya fue respondida o dejó de estar disponible.");
      }
      await client.query("COMMIT"); return {id:doc.id,caseId:legalCase.id};
    }catch(e){await client.query("ROLLBACK");await unlink(join(STORAGE_ROOT,key)).catch(()=>undefined);throw e;}finally{client.release();}
  }
  async documentFile(id:string,user:SessionUser){
    const visibility=user.role==="CLIENT"?"AND d.visibility='CLIENT'":"";
    const owner=user.role==="LAWYER"?"c.lawyer_id":user.role==="CLIENT"?"c.client_id":null;
    const scope=owner?`AND ${owner}=$2`:"";
    const values=owner?[id,user.id]:[id];
    const row=(await this.db.query(`SELECT v.storage_key,v.original_name,v.mime_type FROM document_versions v JOIN documents d ON d.id=v.document_id JOIN cases c ON c.id=d.case_id WHERE v.id=$1 ${visibility} ${scope}`,values)).rows[0];
    if(!row) throw new NotFoundException("Documento no encontrado.");
    return {...row,buffer:await readFile(join(STORAGE_ROOT,row.storage_key))};
  }
  async createDocumentRequest(caseId:string,dto:DocumentRequestDto,user:SessionUser){
    const c=await this.caseAccess(caseId,user,true);
    if(dto.assignedTo!==c.client_id) throw new BadRequestException("La solicitud debe dirigirse al cliente de la causa.");
    const row=(await this.db.query(`INSERT INTO document_requests(case_id,requested_by,assigned_to,title,description,due_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,title,description,due_at AS "dueAt",status`,[caseId,user.id,dto.assignedTo,dto.title,dto.description||null,dto.dueAt||null])).rows[0];
    await this.db.query(`INSERT INTO notifications(user_id,case_id,notification_type,title,body) VALUES($1,$2,'DOCUMENT_REQUEST','Nueva solicitud de documento',$3)`,[dto.assignedTo,caseId,dto.title]);
    return row;
  }
  async documentRequests(user:SessionUser){
    const clause=user.role==="LAWYER"?"r.requested_by=$1":"r.assigned_to=$1";
    if(user.role==="SUPERVISOR") throw new ForbiddenException();
    return (await this.db.query(`SELECT r.id,r.case_id AS "caseId",c.reference,r.title,r.description,r.due_at AS "dueAt",r.status,r.created_at AS "createdAt" FROM document_requests r JOIN cases c ON c.id=r.case_id WHERE ${clause} ORDER BY r.created_at DESC`,[user.id])).rows;
  }

  async ingestion(user:SessionUser){this.lawyer(user);return (await this.db.query(`SELECT id,case_id AS "caseId",source_type AS "sourceType",source_name AS "sourceName",detected_reference AS "detectedReference",detected_date AS "detectedDate",detected_court AS "detectedCourt",movement_type AS "movementType",suggested_summary AS "suggestedSummary",corrected_summary AS "correctedSummary",status,created_at AS "createdAt" FROM ingestion_items WHERE lawyer_id=$1 ORDER BY created_at DESC`,[user.id])).rows;}
  async ingestText(dto:IngestionTextDto,user:SessionUser){this.lawyer(user);if(dto.caseId)await this.caseAccess(dto.caseId,user,true);return this.storeIngestion(dto.sourceType,dto.sourceName,dto.text,dto.caseId,user);}
  async ingestIncomingEmail(dto:{messageId:string;lawyerEmail:string;subject:string;text:string}){
    const lawyer=(await this.db.query(
      "SELECT id,name,email,role,phone,must_change_password FROM users WHERE email=$1 AND role='LAWYER' AND active=true",
      [dto.lawyerEmail.toLowerCase()],
    )).rows[0];
    if(!lawyer) throw new NotFoundException("No existe un abogado activo para el destinatario indicado.");
    const duplicate=(await this.db.query(
      `SELECT id,status FROM ingestion_items WHERE lawyer_id=$1 AND external_message_id=$2`,
      [lawyer.id,dto.messageId],
    )).rows[0];
    if(duplicate) return {...duplicate,duplicate:true};
    const reference=(dto.subject+"\n"+dto.text).match(/\b(?:RIT|ROL|CAUSA|LC)[\s:#-]*([A-Z0-9-]{3,30})/i)?.[1];
    const legalCase=reference?(await this.db.query(
      `SELECT id FROM cases WHERE lawyer_id=$1 AND
       (upper(reference)=upper($2) OR upper(reference)=upper('LC-'||$2) OR upper(rit)=upper($2)) LIMIT 1`,
      [lawyer.id,reference],
    )).rows[0]:undefined;
    try{
      return await this.storeIngestion("EMAIL",dto.subject,dto.text,legalCase?.id,{
        id:lawyer.id,name:lawyer.name,email:lawyer.email,role:"LAWYER",phone:lawyer.phone,mustChangePassword:Boolean(lawyer.must_change_password),
      },dto.messageId);
    }catch(error:any){
      if(error?.code==="23505"){
        const stored=(await this.db.query(`SELECT id,status FROM ingestion_items WHERE lawyer_id=$1 AND external_message_id=$2`,[lawyer.id,dto.messageId])).rows[0];
        if(stored)return {...stored,duplicate:true};
      }
      throw error;
    }
  }
  async ingestFile(file:Express.Multer.File|undefined,caseId:string|undefined,user:SessionUser){
    this.lawyer(user); if(!file)throw new BadRequestException("Selecciona un archivo."); if(file.size>10*1024*1024)throw new BadRequestException("Archivo demasiado grande."); if(caseId)await this.caseAccess(caseId,user,true);
    let text=""; let type="TEXT";
    const lowerName=file.originalname.toLowerCase();
    if(lowerName.endsWith(".xlsx")){
      type="EXCEL";
      const wb=new ExcelJS.Workbook();
      await wb.xlsx.load(file.buffer as any);
      wb.eachSheet((sheet: ExcelJS.Worksheet)=>sheet.eachRow((row: ExcelJS.Row,rowNumber:number)=>{
        const values=(Array.isArray(row.values)?row.values.slice(1):[]).map(value=>String(value??"").trim());
        if(values.some(Boolean)) text+=`Fila ${rowNumber}: ${values.map((value,index)=>`Columna ${index+1}: ${value}`).join(" | ")}\n`;
      }));
    } else if(lowerName.endsWith(".pdf")) {
      type="PDF";
      text=await this.extractPdfText(file.buffer);
    } else {
      type="EMAIL";
      text=file.buffer.toString("utf8");
    }
    if(text.trim().length<10)throw new BadRequestException("No fue posible extraer texto legible del archivo.");
    return this.storeIngestion(type,file.originalname,text.slice(0,100000),caseId,user);
  }
  private async extractPdfText(buffer:Buffer){
    try{
      const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
      const document=await pdfjs.getDocument({data:new Uint8Array(buffer),useSystemFonts:true,isEvalSupported:false}).promise;
      const pages:string[]=[];
      for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
        const page=await document.getPage(pageNumber);
        const content=await page.getTextContent();
        pages.push(content.items.map((item:any)=>("str" in item?item.str:"")).join(" "));
      }
      await document.destroy();
      return pages.join("\n");
    }catch{
      throw new BadRequestException("No fue posible extraer texto del PDF. Verifica que no sea una imagen escaneada o un archivo protegido.");
    }
  }
  private async storeIngestion(sourceType:string,sourceName:string,text:string,caseId:string|undefined,user:SessionUser,externalMessageId?:string){
    const reference=text.match(/\b(?:RIT|ROL|CAUSA|LC)[\s:#-]*([A-Z0-9-]{3,30})/i)?.[1]||null;
    const date=text.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/)?.[0]?.replace(/[\/.]/g,"-")||null;
    const court=text.match(/(?:tribunal|juzgado)[:\s]+([^\n.]{3,180})/i)?.[1]?.trim()||null;
    const movement=/audiencia/i.test(text)?"AUDIENCIA":/resoluci[oó]n/i.test(text)?"RESOLUCIÓN":/notificaci[oó]n/i.test(text)?"NOTIFICACIÓN":"MOVIMIENTO";
    const summary=await this.summarize(text,movement,reference,date,court);
    return (await this.db.query(`INSERT INTO ingestion_items(lawyer_id,case_id,source_type,source_name,source_text,detected_reference,detected_date,detected_court,movement_type,suggested_summary,external_message_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,status,suggested_summary AS "suggestedSummary"`,[user.id,caseId||null,sourceType,sourceName,text,reference,date,court,movement,summary,externalMessageId||null])).rows[0];
  }
  private async summarize(text:string,movement:string,reference:string|null,date:string|null,court:string|null){
    if(process.env.GEMINI_API_KEY){try{const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:`Resume para una persona no abogada, sin inventar datos y en máximo 120 palabras:\n${text.slice(0,12000)}`}]}]})});if(res.ok){const data:any=await res.json();const value=data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();if(value)return value.slice(0,2000);}}catch{}}
    return [`Se detectó un movimiento de tipo ${movement.toLowerCase()}.`,reference?`Referencia ${reference}.`:"",date?`Fecha ${date}.`:"",court?`Tribunal: ${court}.`:"",text.replace(/\s+/g," ").slice(0,500)].filter(Boolean).join(" ").slice(0,2000);
  }
  async reviewIngestion(id:string,dto:ReviewIngestionDto,user:SessionUser){
    this.lawyer(user); const current=(await this.db.query("SELECT * FROM ingestion_items WHERE id=$1 AND lawyer_id=$2 AND status='PENDING'",[id,user.id])).rows[0];if(!current)throw new NotFoundException("Movimiento pendiente no encontrado.");
    const summary=(dto.summary||current.suggested_summary).trim();
    const client=await this.db.pool.connect();try{await client.query("BEGIN");await client.query(`UPDATE ingestion_items SET status=$1,corrected_summary=$2,reviewed_at=now() WHERE id=$3`,[dto.status,summary,id]);if(dto.status==="CONFIRMED"&&current.case_id){const c=(await client.query("SELECT client_id FROM cases WHERE id=$1",[current.case_id])).rows[0];await client.query(`INSERT INTO case_communications(case_id,author_id,message,channel,delivery_status) VALUES($1,$2,$3,'IN_APP','DELIVERED')`,[current.case_id,user.id,summary]);await client.query(`INSERT INTO notifications(user_id,case_id,notification_type,title,body,delivery_status,delivered_at) VALUES($1,$2,'CASE_UPDATE','Nuevo movimiento confirmado',$3,'DELIVERED',now())`,[c.client_id,current.case_id,summary]);}await client.query("COMMIT");return {id,status:dto.status,summary};}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }
}
