import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
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
import { excelCellText, excelRowsToMovements, extractMovement, normalizeReference } from "./ingestion-rules";
import { documentRejection, ingestionRejection } from "./file-signature";

const STORAGE_ROOT = resolve(
  process.env.DOCUMENT_STORAGE_PATH || join(process.cwd(), ".data", "documents"),
);
const MAX_EXCEL_MOVEMENTS = 200;
/** Fecha de hoy en Chile (AAAA-MM-DD), independiente de la zona horaria del servidor. */
const chileToday = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + offsetDays * 86400000));
const isRealDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

@Injectable()
export class ProductService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductService.name);
  private reminderTimer?: NodeJS.Timeout;
  private dispatchingReminders = false;
  constructor(private readonly db: DatabaseService) {}

  // HU-12: revisa periódicamente los recordatorios vencidos y los convierte en notificaciones.
  onModuleInit() {
    const interval = Number(process.env.REMINDER_INTERVAL_MS ?? 60000);
    if (!Number.isFinite(interval) || interval <= 0) return;
    const run = () => void this.dispatchReminders().catch((error) =>
      this.logger.error(`No fue posible enviar recordatorios: ${error?.message ?? error}`));
    this.reminderTimer = setInterval(run, interval);
    this.reminderTimer.unref();
    run();
  }
  onModuleDestroy() {
    if (this.reminderTimer) clearInterval(this.reminderTimer);
  }
  /** Marca y notifica en una sola sentencia: cada recordatorio se envía una vez aunque haya varias instancias. */
  async dispatchReminders() {
    if (this.dispatchingReminders) return 0;
    this.dispatchingReminders = true;
    try {
      const result = await this.db.query(
        `WITH due AS (
           UPDATE case_deadlines d SET reminder_sent_at=now()
           FROM cases c
           WHERE c.id=d.case_id AND d.status='PENDING' AND d.reminder_sent_at IS NULL
             AND d.reminder_at IS NOT NULL AND d.reminder_at<=now() AND c.status<>'Archivada'
           RETURNING d.case_id,d.title,d.due_at,d.urgency,c.lawyer_id,c.reference
         )
         INSERT INTO notifications(user_id,case_id,notification_type,title,body)
         SELECT lawyer_id,case_id,'DEADLINE',left('Recordatorio: '||title,200),
           left(reference||' · vence el '||to_char(due_at AT TIME ZONE 'America/Santiago','DD-MM-YYYY HH24:MI')||' · urgencia '||lower(urgency),1000)
         FROM due`,
      );
      return result.rowCount ?? 0;
    } finally {
      this.dispatchingReminders = false;
    }
  }

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
    const start = from || chileToday();
    const end = to || chileToday(7);
    const owner = user.role === "LAWYER" ? "c.lawyer_id" : user.role === "CLIENT" ? "c.client_id" : null;
    const values: unknown[] = [start, end];
    const scope = owner ? `AND ${owner}=$3` : "";
    if (owner) values.push(user.id);
    return (await this.db.query(
      `SELECT d.id,d.case_id AS "caseId",c.reference,c.title AS "caseTitle",
       d.deadline_type AS "deadlineType",d.title,d.description,d.due_at AS "dueAt",
       d.reminder_at AS "reminderAt",d.urgency,d.status
       FROM case_deadlines d JOIN cases c ON c.id=d.case_id
       WHERE (d.due_at AT TIME ZONE 'America/Santiago')::date BETWEEN $1::date AND $2::date ${scope}
       ORDER BY d.due_at`, values,
    )).rows;
  }
  async createDeadline(caseId: string, dto: DeadlineDto, user: SessionUser) {
    await this.caseAccess(caseId, user, true);
    if (dto.reminderAt && new Date(dto.reminderAt) > new Date(dto.dueAt))
      throw new BadRequestException("El recordatorio no puede ser posterior al plazo.");
    return (await this.db.query(
      `INSERT INTO case_deadlines(case_id,created_by,deadline_type,title,description,due_at,reminder_at,urgency)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,case_id AS "caseId",deadline_type AS "deadlineType",title,description,due_at AS "dueAt",reminder_at AS "reminderAt",urgency,status`,
      [caseId,user.id,dto.deadlineType,dto.title,dto.description||null,dto.dueAt,dto.reminderAt||null,dto.urgency||"Media"],
    )).rows[0];
  }
  async deadlineStatus(id: string, status: string, user: SessionUser) {
    this.lawyer(user);
    const result = await this.db.query(
      // E25: sin el tipo explícito PostgreSQL no puede deducir $1 (varchar frente a text) y respondía 500.
      `UPDATE case_deadlines d SET status=$1::varchar,completed_at=CASE WHEN $1::varchar='COMPLETED' THEN now() ELSE NULL END
       FROM cases c WHERE d.id=$2 AND d.case_id=c.id AND c.lawyer_id=$3
       RETURNING d.id,d.status,d.completed_at AS "completedAt"`, [status,id,user.id],
    );
    if (!result.rows[0]) throw new NotFoundException("Plazo no encontrado.");
    return result.rows[0];
  }

  async communications(caseId: string, user: SessionUser) {
    await this.caseAccess(caseId, user);
    // HU-15 (mockup 07): cuando el cliente abre su causa, los mensajes de su abogado quedan como vistos.
    if (user.role === "CLIENT")
      await this.db.query(
        `UPDATE case_communications SET read_at=now() WHERE case_id=$1 AND read_at IS NULL AND author_id<>$2`,
        [caseId, user.id],
      );
    return (await this.db.query(
      `SELECT m.id,m.message,m.channel,m.category,m.delivery_status AS "deliveryStatus",m.read_at AS "readAt",
       m.created_at AS "createdAt",u.name AS "authorName"
       FROM case_communications m JOIN users u ON u.id=m.author_id
       WHERE m.case_id=$1 ORDER BY m.created_at DESC`, [caseId],
    )).rows;
  }
  /**
   * HU-21 (mockup 13): línea de tiempo de la causa con el ingreso a LEX-CORPUS, los movimientos
   * que el abogado ya confirmó y los cambios de estado. Nunca incluye sugerencias sin revisar.
   */
  async timeline(caseId: string, user: SessionUser) {
    await this.caseAccess(caseId, user);
    return (await this.db.query(
      `SELECT kind,title,detail,court,to_char(event_date,'YYYY-MM-DD') AS "date",recorded_at AS "recordedAt" FROM (
         SELECT 'CASE_CREATED' AS kind,'Causa ingresada a LEX-CORPUS' AS title,
           'Tu causa fue registrada por tu abogado con la referencia interna '||c.reference||'.' AS detail,
           NULL::varchar AS court,(c.created_at AT TIME ZONE 'America/Santiago')::date AS event_date,c.created_at AS recorded_at
         FROM cases c WHERE c.id=$1
         UNION ALL
         SELECT 'MOVEMENT',
           CASE i.movement_type WHEN 'AUDIENCIA' THEN 'Audiencia' WHEN 'RESOLUCIÓN' THEN 'Resolución del tribunal'
             WHEN 'SENTENCIA' THEN 'Sentencia' WHEN 'NOTIFICACIÓN' THEN 'Notificación del tribunal' ELSE 'Movimiento de la causa' END,
           COALESCE(i.corrected_summary,i.suggested_summary),i.detected_court,
           COALESCE(i.detected_date,(i.reviewed_at AT TIME ZONE 'America/Santiago')::date),i.reviewed_at
         FROM ingestion_items i WHERE i.case_id=$1 AND i.status='CONFIRMED'
         UNION ALL
         SELECT 'STATUS',CASE h.to_status WHEN 'Archivada' THEN 'Causa archivada' ELSE 'Causa reactivada' END,
           CASE h.to_status WHEN 'Archivada' THEN 'Tu abogado archivó la causa en LEX-CORPUS.'
             ELSE 'Tu abogado reactivó la causa en LEX-CORPUS.' END,
           NULL,(h.changed_at AT TIME ZONE 'America/Santiago')::date,h.changed_at
         FROM case_status_history h WHERE h.case_id=$1 AND h.from_status IS NOT NULL AND h.from_status<>h.to_status
       ) t ORDER BY event_date DESC,recorded_at DESC`, [caseId],
    )).rows;
  }
  /**
   * HU-13 (mockup 09): plazos sin realizar y solicitudes de documentos por vencer del abogado,
   * para agruparlos en Hoy, Esta semana y Todos. Incluye los vencidos.
   */
  async pending(user: SessionUser) {
    this.lawyer(user);
    return (await this.db.query(
      `SELECT * FROM (
         SELECT 'DEADLINE' AS kind,d.id,d.case_id AS "caseId",c.reference,c.title AS "caseTitle",u.name AS "clientName",
           d.deadline_type AS "deadlineType",d.title,d.due_at AS "dueAt",d.urgency
         FROM case_deadlines d JOIN cases c ON c.id=d.case_id JOIN users u ON u.id=c.client_id
         WHERE c.lawyer_id=$1 AND c.status<>'Archivada' AND d.status='PENDING'
         UNION ALL
         SELECT 'DOCUMENT_REQUEST',r.id,r.case_id,c.reference,c.title,u.name,NULL,'Vence solicitud: '||r.title,r.due_at,NULL
         FROM document_requests r JOIN cases c ON c.id=r.case_id JOIN users u ON u.id=c.client_id
         WHERE c.lawyer_id=$1 AND c.status<>'Archivada' AND r.status IN ('PENDING','IN_REVIEW') AND r.due_at IS NOT NULL
       ) p ORDER BY "dueAt",CASE urgency WHEN 'Alta' THEN 0 WHEN 'Media' THEN 1 WHEN 'Baja' THEN 2 ELSE 3 END
       LIMIT 500`, [user.id],
    )).rows;
  }
  async sendCommunication(caseId: string, dto: CommunicationDto, user: SessionUser) {
    const legalCase = await this.caseAccess(caseId, user, true);
    const client = (await this.db.query("SELECT id,email,phone FROM users WHERE id=$1",[legalCase.client_id])).rows[0];
    const delivery = dto.channel === "IN_APP"
      ? { ok: true as boolean, error: undefined as string | undefined }
      : await this.deliver(dto.channel, client, dto.message);
    const comm = (await this.db.query(
      `INSERT INTO case_communications(case_id,author_id,message,channel,delivery_status,delivery_error,category)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,message,channel,category,delivery_status AS "deliveryStatus",read_at AS "readAt",created_at AS "createdAt"`,
      [caseId,user.id,dto.message,dto.channel,delivery.ok?"DELIVERED":"FAILED",delivery.error||null,dto.category||"STATUS_UPDATE"],
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

  /**
   * E24: paginación por cursor (fecha e id de la última notificación recibida).
   * Se compara la fecha truncada a milisegundos, la misma precisión que viaja en JSON,
   * para no saltar ni repetir notificaciones creadas en el mismo milisegundo.
   */
  async notifications(user: SessionUser, query: { limit?: number; before?: string; beforeId?: string } = {}) {
    if (Boolean(query.before) !== Boolean(query.beforeId))
      throw new BadRequestException("El cursor requiere la fecha y el id de la última notificación.");
    const limit = query.limit ?? 30;
    const values: unknown[] = [user.id, limit];
    let cursor = "";
    if (query.before && query.beforeId) {
      values.push(query.before, query.beforeId);
      cursor = `AND (date_trunc('milliseconds',created_at),id) < ($3::timestamptz,$4::uuid)`;
    }
    return (await this.db.query(
      `SELECT id,case_id AS "caseId",notification_type AS "type",title,body,channel,
       delivery_status AS "deliveryStatus",read_at AS "readAt",created_at AS "createdAt"
       FROM notifications WHERE user_id=$1 ${cursor}
       ORDER BY date_trunc('milliseconds',created_at) DESC,id DESC LIMIT $2`,values,
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
    const rejection=documentRejection(file.mimetype,file.originalname,file.buffer);
    if(rejection) throw new BadRequestException(rejection);
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
      // HU-17: el cliente se entera de un documento nuevo visible. CU-04, paso 6: el abogado se entera de la respuesta.
      if(user.role==="CLIENT"){
        const responded=Boolean(meta.requestId);
        await client.query(
          `INSERT INTO notifications(user_id,case_id,notification_type,title,body) VALUES($1,$2,$3,$4,$5)`,
          [legalCase.lawyer_id,caseId,responded?"DOCUMENT_REQUEST":"CASE_UPDATE",
           responded?"El cliente respondió una solicitud de documento":"El cliente subió un documento",
           `${legalCase.reference}: ${meta.title}`.slice(0,1000)],
        );
      } else if(meta.visibility==="CLIENT"){
        await client.query(
          `INSERT INTO notifications(user_id,case_id,notification_type,title,body) VALUES($1,$2,'CASE_UPDATE','Nuevo documento disponible',$3)`,
          [legalCase.client_id,caseId,`${legalCase.reference}: ${meta.title}`.slice(0,1000)],
        );
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

  private static readonly INGESTION_COLUMNS = `i.id,i.case_id AS "caseId",c.reference AS "caseReference",
    i.source_type AS "sourceType",i.source_name AS "sourceName",i.detected_reference AS "detectedReference",
    to_char(i.detected_date,'YYYY-MM-DD') AS "detectedDate",to_char(i.detected_time,'HH24:MI') AS "detectedTime",
    i.detected_court AS "detectedCourt",i.movement_type AS "movementType",i.suggested_summary AS "suggestedSummary",
    i.corrected_summary AS "correctedSummary",i.status,i.suggestion_source AS "suggestionSource",i.confidence,
    i.format_recognized AS "formatRecognized",i.missing_fields AS "missingFields",i.edited,
    i.created_at AS "createdAt",i.reviewed_at AS "reviewedAt"`;
  async ingestion(user:SessionUser){
    this.lawyer(user);
    return (await this.db.query(
      `SELECT ${ProductService.INGESTION_COLUMNS} FROM ingestion_items i LEFT JOIN cases c ON c.id=i.case_id
       WHERE i.lawyer_id=$1 ORDER BY i.created_at DESC`,
      [user.id],
    )).rows;
  }
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
    try{
      // La causa se asocia en storeIngestion a partir de la referencia del asunto o del cuerpo.
      return await this.storeIngestion("EMAIL",dto.subject,dto.text,undefined,{
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
    const rejection=ingestionRejection(file.originalname,file.buffer);
    if(rejection)throw new BadRequestException(rejection);
    const lowerName=file.originalname.toLowerCase();
    if(lowerName.endsWith(".xlsx")){
      // Cada fila de la planilla es un movimiento distinto; las celdas de fecha se leen como AAAA-MM-DD.
      const wb=new ExcelJS.Workbook();
      await wb.xlsx.load(file.buffer as any);
      const movements:string[]=[];
      wb.eachSheet((sheet: ExcelJS.Worksheet)=>{
        const rows:string[][]=[];
        sheet.eachRow((row: ExcelJS.Row)=>rows.push(Array.from((Array.isArray(row.values)?row.values:[]).slice(1),excelCellText)));
        movements.push(...excelRowsToMovements(rows));
      });
      const texts=movements.filter(text=>text.trim().length>=10);
      if(!texts.length)throw new BadRequestException("No fue posible extraer texto legible del archivo.");
      if(texts.length>MAX_EXCEL_MOVEMENTS)throw new BadRequestException(`La planilla supera el máximo de ${MAX_EXCEL_MOVEMENTS} movimientos por carga.`);
      const name=file.originalname.slice(0,200);
      const items=[];
      for(const [index,text] of texts.entries())
        items.push(await this.storeIngestion("EXCEL",`${name} · movimiento ${index+1}`,text,caseId,user));
      return {count:items.length,items};
    }
    let text=""; let type="EMAIL";
    if(lowerName.endsWith(".pdf")) {
      type="PDF";
      text=await this.extractPdfText(file.buffer);
    } else {
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
  /** Causa del abogado cuyo RIT o referencia coincide con la detectada; las archivadas no reciben movimientos. */
  private async findCaseByReference(lawyerId:string,reference:string){
    const value=normalizeReference(reference);
    return (await this.db.query(
      `SELECT id FROM cases WHERE lawyer_id=$1 AND status<>'Archivada'
       AND (upper(reference)=$2 OR upper(rit)=$2) ORDER BY created_at DESC LIMIT 1`,
      [lawyerId,value],
    )).rows[0]?.id as string|undefined;
  }
  private async storeIngestion(sourceType:string,sourceName:string,text:string,caseId:string|undefined,user:SessionUser,externalMessageId?:string){
    // En un correo el asunto suele traer el RIT, por eso se analiza junto con el cuerpo.
    const rules=extractMovement(sourceType==="EMAIL"?`${sourceName}\n${text}`:text);
    const linkedCase=caseId??(rules.reference?await this.findCaseByReference(user.id,rules.reference):undefined);
    const summary=await this.summarize(text,rules.movementType,rules.reference,rules.date,rules.time,rules.court);
    return (await this.db.query(
      `INSERT INTO ingestion_items(lawyer_id,case_id,source_type,source_name,source_text,detected_reference,detected_date,
         detected_time,detected_court,movement_type,suggested_summary,suggestion_source,confidence,format_recognized,
         missing_fields,external_message_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id,status,case_id AS "caseId",movement_type AS "movementType",suggested_summary AS "suggestedSummary",
         suggestion_source AS "suggestionSource",confidence,format_recognized AS "formatRecognized",missing_fields AS "missingFields"`,
      [user.id,linkedCase||null,sourceType,sourceName,text,rules.reference,rules.date,rules.time,rules.court,
       rules.movementType,summary.text,summary.source,rules.confidence,rules.formatRecognized,rules.missingFields,
       externalMessageId||null],
    )).rows[0];
  }
  private async summarize(text:string,movement:string,reference:string|null,date:string|null,time:string|null,court:string|null):Promise<{text:string;source:"IA"|"REGLAS"}>{
    if(process.env.GEMINI_API_KEY){try{const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:`Resume para una persona no abogada, sin inventar datos y en máximo 120 palabras:\n${text.slice(0,12000)}`}]}]})});if(res.ok){const data:any=await res.json();const value=data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();if(value)return {text:value.slice(0,2000),source:"IA"};}}catch{}}
    const readableDate=date?`${date.slice(8,10)}-${date.slice(5,7)}-${date.slice(0,4)}${time?` a las ${time}`:""}`:"";
    return {source:"REGLAS",text:[`Se detectó un movimiento de tipo ${movement.toLowerCase()}.`,reference?`Referencia ${reference}.`:"",readableDate?`Fecha ${readableDate}.`:"",court?`Tribunal: ${court}.`:"",text.replace(/\s+/g," ").slice(0,500)].filter(Boolean).join(" ").slice(0,2000)};
  }
  /** CU-02: el abogado asocia la causa, corrige los datos sugeridos y recién entonces se publica al cliente. */
  async reviewIngestion(id:string,dto:ReviewIngestionDto,user:SessionUser){
    this.lawyer(user);
    if(dto.detectedDate&&!isRealDate(dto.detectedDate))throw new BadRequestException("Fecha no válida.");
    const client=await this.db.pool.connect();
    try{
      await client.query("BEGIN");
      const current=(await client.query(
        `SELECT *,to_char(detected_date,'YYYY-MM-DD') AS date_text,to_char(detected_time,'HH24:MI') AS time_text
         FROM ingestion_items WHERE id=$1 AND lawyer_id=$2 AND status='PENDING' FOR UPDATE`,
        [id,user.id],
      )).rows[0];
      if(!current)throw new NotFoundException("Movimiento pendiente no encontrado.");
      const caseId:string|null=dto.caseId??current.case_id??null;
      const mustValidateCase=Boolean(caseId)&&(dto.status==="CONFIRMED"||Boolean(dto.caseId));
      const legalCase=mustValidateCase?await this.caseAccess(caseId!,user,true):null;
      if(dto.status==="CONFIRMED"&&!legalCase)
        throw new BadRequestException("Asocia el movimiento a una causa antes de confirmarlo; sin causa no llegaría al cliente.");
      const pick=(value:string|null|undefined,fallback:string|null)=>value===undefined?fallback:(value||null);
      const original={movementType:current.movement_type as string,detectedDate:current.date_text as string|null,detectedTime:current.time_text as string|null,detectedCourt:current.detected_court as string|null,summary:current.suggested_summary as string};
      const movementType=dto.movementType??original.movementType;
      const date=pick(dto.detectedDate,original.detectedDate);
      const time=pick(dto.detectedTime,original.detectedTime);
      const court=pick(dto.court,original.detectedCourt);
      const summary=(dto.summary||original.summary).trim();
      const edited=movementType!==original.movementType||date!==original.detectedDate||time!==original.detectedTime
        ||court!==original.detectedCourt||summary!==original.summary.trim();
      await client.query(
        `UPDATE ingestion_items SET status=$1,corrected_summary=$2,case_id=$3,movement_type=$4,detected_date=$5,detected_time=$6,
           detected_court=$7,edited=$8,original_suggestion=CASE WHEN $8 THEN $9::jsonb ELSE NULL END,reviewed_at=now()
         WHERE id=$10`,
        [dto.status,summary,caseId,movementType,date,time,court,edited,JSON.stringify(original),id],
      );
      let deadlineId:string|null=null;
      if(dto.status==="CONFIRMED"&&legalCase){
        await client.query(`INSERT INTO case_communications(case_id,author_id,message,channel,delivery_status) VALUES($1,$2,$3,'IN_APP','DELIVERED')`,[legalCase.id,user.id,summary]);
        await client.query(`INSERT INTO notifications(user_id,case_id,notification_type,title,body,delivery_status,delivered_at) VALUES($1,$2,'CASE_UPDATE','Nuevo movimiento confirmado',$3,'DELIVERED',now())`,[legalCase.client_id,legalCase.id,summary.slice(0,1000)]);
        // CU-02, paso 5: una audiencia futura actualiza la causa (próxima fecha) y queda en la agenda con recordatorio.
        if(movementType==="AUDIENCIA"&&date&&date>=chileToday()){
          deadlineId=(await client.query(
            `INSERT INTO case_deadlines(case_id,created_by,deadline_type,title,description,due_at,reminder_at,urgency)
             VALUES($1,$2,'HEARING',$3,$4,($5::date+$6::time) AT TIME ZONE 'America/Santiago',
               (($5::date+$6::time) AT TIME ZONE 'America/Santiago')-interval '1 day','Alta')
             RETURNING id`,
            [legalCase.id,user.id,`Audiencia${court?` · ${court}`:""}`.slice(0,200),
             time?null:"Hora no informada en el movimiento; revisa la resolución.",date,time||"09:00"],
          )).rows[0].id;
          await client.query(
            `UPDATE cases SET next_date=$1::date,next_date_label='Audiencia',version=version+1,updated_at=now()
             WHERE id=$2 AND (next_date IS NULL OR next_date<$3::date OR next_date>$1::date)`,
            [date,legalCase.id,chileToday()],
          );
        }
      }
      await client.query("COMMIT");
      return {id,status:dto.status,summary,caseId,edited,deadlineId};
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }
}
