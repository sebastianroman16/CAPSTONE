export interface User {
  id: string;
  name: string;
  email: string;
  role: "LAWYER" | "CLIENT" | "SUPERVISOR";
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
  clientId: string;
  rit: string;
  matter: string;
  court: string;
  priority: string;
  nextDate: string | null;
  nextDateLabel: string;
  internalNotes: string;
}

export type ImportField =
  | "clientEmail"
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
export interface ImportValidation {
  summary: { total: number; valid: number; errors: number; duplicates: number };
  rows: ImportPreviewRow[];
}
