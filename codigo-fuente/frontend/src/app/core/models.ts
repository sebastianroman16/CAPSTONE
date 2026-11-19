export interface User {
  id: string;
  name: string;
  email: string;
  role: "LAWYER" | "CLIENT" | "SUPERVISOR";
  phone?: string | null;
  mustChangePassword?: boolean;
}
export interface Client {
  id: string;
  name: string;
  email: string;
}
export interface LegalCase {
  progressStage?: string;
  progressSummary?: string | null;
  nextAction?: string | null;
  progressUpdatedAt?: string | null;
  version: number;
  id: string;
  reference: string;
  rit: string | null;
  title: string;
  clientId: string;
  clientName: string;
  matter: string;
  court: string;
  priority: "Alta" | "Media" | "Baja";
  status: "Activa" | "Archivada";
  nextDate: string | null;
  nextDateLabel: string | null;
  internalNotes?: string | null;
  createdAt: string;
  updatedAt: string;
}
export const progressStages = [
  { value: "NOT_REPORTED", label: "Sin avance informado" },
  { value: "ASSESSMENT", label: "Evaluación inicial" },
  { value: "PREPARATION", label: "Preparación" },
  { value: "IN_PROGRESS", label: "En tramitación" },
  { value: "FOLLOW_UP", label: "Seguimiento" },
  { value: "COMPLETED", label: "Gestión finalizada" },
];
export function stageLabel(stage?: string) {
  return (
    progressStages.find((s) => s.value === stage)?.label ??
    "Sin avance informado"
  );
}
// HU-26: reasignación visible para la coordinación (sin datos de contacto).
export interface CaseReassignment { createdAt: string; reason: string; fromLawyer: string; toLawyer: string; changedBy: string; }
export interface ProgressEvent {
  id: string;
  stage: string;
  summary: string;
  nextAction: string;
  createdAt: string;
  caseVersion: number;
  authorName: string;
}
export interface SupervisedCase {
  id: string;
  reference: string;
  rit: string | null;
  title: string;
  matter: string;
  court: string;
  priority: string;
  status: string;
  lawyerId: string;
  lawyerName: string;
  lawyerActive: boolean;
  clientName: string;
  progressStage: string;
  progressSummary: string | null;
  nextAction: string | null;
  progressUpdatedAt: string | null;
  nextDate: string | null;
  nextDateLabel: string | null;
  updatedAt: string;
  needsAttention: boolean;
}
export interface SupervisionCounts {
  total: number;
  active: number;
  archived: number;
  highPriority: number;
  needsAttention: number;
  completed: number;
}
export interface SupervisionDashboard {
  asOf: string;
  summary: SupervisionCounts;
  lawyers: (SupervisionCounts & {
    id: string;
    name: string;
    accountActive: boolean;
  })[];
  items: SupervisedCase[];
  total: number;
  page: number;
  pageSize: number;
  staleAfterDays: number;
}
export interface SaveCase {
  title: string;
  clientId?: string;
  newClientName?: string;
  newClientEmail?: string;
  newClientPhone?: string;
  rit: string;
  matter: string;
  court: string;
  priority: string;
  nextDate: string | null;
  nextDateLabel: string;
  internalNotes: string;
}
export interface CaseOnboarding {
  clientCreated: boolean;
  temporaryPassword?: string;
  deliveryStatus?: "DELIVERED" | "PENDING" | "FAILED";
  /** Cliente existente (también de otro abogado) asociado a la cartera al registrar la causa. */
  clientLinked?: boolean;
}
export type CreatedCase = LegalCase & { onboarding?: CaseOnboarding };

export type ImportField =
  | "clientEmail"
  | "clientName"
  | "clientPhone"
  | "title"
  | "rit"
  | "matter"
  | "court"
  | "priority"
  | "nextDate"
  | "nextDateLabel"
  | "internalNotes";
export interface ImportBatch {
  id: string;
  filename: string;
  worksheet: string;
  totalRows: number;
  headers: string[];
  samples: string[];
  suggestedMapping: Record<ImportField, number | null>;
  expiresAt: string;
}
export interface ImportPreviewRow {
  rowNumber: number;
  status: "VALID" | "ERROR" | "DUPLICATE";
  detail: string;
  errors: string[];
  data: {
    clientEmail: string;
    clientName?: string;
    clientPhone?: string;
    /** EXISTING: de tu cartera · LINK: de otra cartera, se asocia · CREATE: se crea la cuenta. */
    clientAction?: "EXISTING" | "LINK" | "CREATE";
    title: string;
    rit: string;
    matter: string;
    court: string;
    priority: string;
    nextDate: string;
    nextDateLabel: string;
    internalNotes: string;
  };
}
/** Cuenta creada al importar (CU-01): la clave temporal se muestra una sola vez al abogado. */
export interface ImportedClient { name: string; email: string; temporaryPassword: string; deliveryStatus: "DELIVERED" | "PENDING" | "FAILED"; }
export interface ImportValidation {
  summary: { total: number; valid: number; errors: number; duplicates: number; newClients: number; linkedClients: number };
  rows: ImportPreviewRow[];
}
export interface Deadline { id:string;caseId:string;reference:string;caseTitle:string;deadlineType:string;title:string;description:string|null;dueAt:string;reminderAt:string|null;urgency:"Alta"|"Media"|"Baja";status:string; }
export type CommunicationCategory = "STATUS_UPDATE" | "HEARING_REMINDER" | "INFO_REQUEST";
export interface Communication { id:string;message:string;channel:string;category:CommunicationCategory;deliveryStatus:string;readAt:string|null;createdAt:string;authorName:string; }
export const COMMUNICATION_CATEGORIES: Record<CommunicationCategory, string> = {
  STATUS_UPDATE: "Actualización de estado",
  HEARING_REMINDER: "Recordatorio de audiencia",
  INFO_REQUEST: "Solicitud de información",
};
/** Hito de la línea de tiempo de la causa (HU-21). */
export interface TimelineEvent { kind:"CASE_CREATED"|"MOVEMENT"|"STATUS";title:string;detail:string;court:string|null;date:string;recordedAt:string; }
/** Pendiente del abogado: plazo sin realizar o solicitud de documento por vencer (HU-13). */
export interface PendingItem { kind:"DEADLINE"|"DOCUMENT_REQUEST";id:string;caseId:string;reference:string;caseTitle:string;clientName:string;deadlineType:string|null;title:string;dueAt:string;urgency:"Alta"|"Media"|"Baja"|null; }
/** Datos de la corporación y de la cuenta en el perfil (HU-05). */
export interface ProfileSummary { corporation:string;office:string|null;memberSince:string;activeCases:number;lawyers:Array<{name:string;email:string;phone:string|null}>; }
export interface CaseDocument { id:string;title:string;description:string|null;category:string;visibility:string;versionId:string;version:number;originalName:string;mimeType:string;sizeBytes:number;uploadedBy:string;createdAt:string; }
export interface DocumentRequest { id:string;caseId:string;reference:string;title:string;description:string|null;dueAt:string|null;status:string;createdAt:string; }
export interface AppNotification { id:string;caseId:string|null;type:string;title:string;body:string;channel:string;deliveryStatus:string;readAt:string|null;createdAt:string; }
export interface IngestionItem { id:string;caseId:string|null;caseReference:string|null;clientName?:string|null;sourceText?:string;sourceTruncated?:boolean;sourceType:string;sourceName:string;detectedReference:string|null;detectedDate:string|null;detectedTime:string|null;detectedCourt:string|null;movementType:string;suggestedSummary:string;correctedSummary:string|null;status:string;suggestionSource:"IA"|"REGLAS";confidence:"ALTA"|"MEDIA"|"BAJA";formatRecognized:boolean;missingFields:string[];edited:boolean;createdAt:string;reviewedAt:string|null; }
export interface IngestionReview { status:"CONFIRMED"|"REJECTED";summary?:string;caseId?:string;movementType?:string;detectedDate?:string|null;detectedTime?:string|null;court?:string|null; }
export interface AssistantMessage { id?:number;role:"USER"|"ASSISTANT";content:string;confidence?:number;createdAt?:string; }
export interface AssistantSession { conversationId:string;messages:AssistantMessage[];quota:{limit:number;used:number;remaining:number}; }
export interface ManagedUser { id:string;name:string;email:string;phone:string|null;role:string;active:boolean;office:string|null;lastLoginAt:string|null;createdAt:string;caseCount:number; }
export interface AuditEntry { id:number;entityType:string;entityId:string;entityLabel:string|null;action:string;occurredAt:string;actorName:string|null; }
