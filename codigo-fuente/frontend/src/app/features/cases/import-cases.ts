import { Component, computed, inject, signal, ViewChild, ElementRef } from "@angular/core";
import { RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { CaseImportService } from "../../core/case-import.service";
import { errorMessage } from "../../core/auth.service";
import {
  ImportBatch,
  ImportedClient,
  ImportField,
  ImportPreviewRow,
  ImportValidation,
} from "../../core/models";

type FieldOption = { value: ImportField; label: string; required: boolean };

@Component({
  selector: "app-import-cases",
  imports: [RouterLink, FormsModule],
  templateUrl: "./import-cases.html",
  styleUrl: "./import-cases.css",
})
export class ImportCases {
  @ViewChild("fileInput") fileInput?: ElementRef<HTMLInputElement>;
  private readonly api = inject(CaseImportService);
  readonly step = signal<1 | 2 | 3>(1);
  readonly file = signal<File | null>(null);
  readonly batch = signal<ImportBatch | null>(null);
  readonly assignments = signal<Array<ImportField | null>>([]);
  readonly preview = signal<ImportValidation | null>(null);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly dragging = signal(false);
  readonly imported = signal<number | null>(null);
  readonly omitted = signal(0);
  /** Cuentas creadas al confirmar (CU-01). Sus claves temporales solo se muestran en esta pantalla. */
  readonly newClients = signal<ImportedClient[]>([]);
  readonly linkedClients = signal(0);
  readonly fields: FieldOption[] = [
    { value: "clientEmail", label: "Correo del cliente", required: true },
    { value: "clientName", label: "Nombre del cliente (si es nuevo)", required: false },
    { value: "clientPhone", label: "Teléfono del cliente", required: false },
    { value: "title", label: "Carátula", required: true },
    { value: "rit", label: "RIT", required: false },
    { value: "matter", label: "Materia", required: true },
    { value: "court", label: "Tribunal", required: true },
    { value: "priority", label: "Prioridad", required: true },
    { value: "nextDate", label: "Próxima fecha clave", required: false },
    { value: "nextDateLabel", label: "Descripción de fecha", required: false },
    { value: "internalNotes", label: "Notas internas", required: false },
  ];
  readonly mappingComplete = computed(() =>
    this.fields
      .filter((field) => field.required)
      .every((field) => this.assignments().includes(field.value)),
  );

  pickFile() {
    this.fileInput?.nativeElement.click();
  }

  fileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.setFile(input.files?.[0] ?? null);
  }

  dropped(event: DragEvent) {
    event.preventDefault();
    this.dragging.set(false);
    this.setFile(event.dataTransfer?.files?.[0] ?? null);
  }

  dragOver(event: DragEvent) {
    event.preventDefault();
    this.dragging.set(true);
  }

  private setFile(file: File | null) {
    this.error.set("");
    this.batch.set(null);
    if (!file) {
      this.file.set(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      this.error.set("Selecciona un archivo .xlsx sin macros.");
      this.file.set(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.error.set("El archivo supera el máximo de 5 MB.");
      this.file.set(null);
      return;
    }
    this.file.set(file);
  }

  removeFile() {
    this.setFile(null);
    if (this.fileInput) this.fileInput.nativeElement.value = "";
  }

  upload() {
    const file = this.file();
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    this.api.upload(file).subscribe({
      next: (batch) => {
        this.batch.set(batch);
        const assignments: Array<ImportField | null> = batch.headers.map(() => null);
        for (const field of this.fields) {
          const column = batch.suggestedMapping[field.value];
          if (column !== null) assignments[column] = field.value;
        }
        this.assignments.set(assignments);
        this.step.set(2);
        this.busy.set(false);
      },
      error: (error) => {
        this.error.set(errorMessage(error));
        this.busy.set(false);
      },
    });
  }

  assign(column: number, value: string | null) {
    const field = value ? (value as ImportField) : null;
    const next = [...this.assignments()];
    if (field)
      for (let index = 0; index < next.length; index++)
        if (index !== column && next[index] === field) next[index] = null;
    next[column] = field;
    this.assignments.set(next);
  }

  validate() {
    const batch = this.batch();
    if (!batch || !this.mappingComplete() || this.busy()) return;
    const mapping = Object.fromEntries(
      this.fields.map((field) => [field.value, null]),
    ) as Record<ImportField, number | null>;
    this.assignments().forEach((field, index) => {
      if (field) mapping[field] = index;
    });
    this.busy.set(true);
    this.error.set("");
    this.api.validate(batch.id, mapping).subscribe({
      next: (preview) => {
        this.preview.set(preview);
        this.step.set(3);
        this.busy.set(false);
      },
      error: (error) => {
        this.error.set(errorMessage(error));
        this.busy.set(false);
      },
    });
  }

  confirm() {
    const batch = this.batch();
    if (!batch || !this.preview()?.summary.valid || this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    this.api.confirm(batch.id).subscribe({
      next: (result) => {
        this.imported.set(result.imported);
        this.omitted.set(result.omitted);
        this.newClients.set(result.newClients ?? []);
        this.linkedClients.set(result.linkedClients ?? 0);
        this.busy.set(false);
      },
      error: (error) => {
        this.error.set(errorMessage(error));
        this.busy.set(false);
      },
    });
  }

  downloadErrors() {
    const rows = this.preview()?.rows.filter((row) => row.status !== "VALID") ?? [];
    const safe = (value: unknown) => {
      let text = String(value ?? "");
      if (/^[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const csv = [
      ["Fila", "Estado", "Correo cliente", "Carátula", "RIT", "Detalle"],
      ...rows.map((row) => [
        row.rowNumber,
        this.statusLabel(row),
        row.data.clientEmail,
        row.data.title,
        row.data.rit,
        row.detail,
      ]),
    ]
      .map((row) => row.map(safe).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "errores-importacion-causas.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  clientActionLabel(row: ImportPreviewRow) {
    if (row.status !== "VALID") return "";
    return row.data.clientAction === "CREATE"
      ? "Cliente nuevo"
      : row.data.clientAction === "LINK"
        ? "Se asocia a tu cartera"
        : "";
  }

  deliveryLabel(client: ImportedClient) {
    return client.deliveryStatus === "DELIVERED"
      ? "Credenciales enviadas"
      : client.deliveryStatus === "FAILED"
        ? "El envío falló: entrégala tú"
        : "Entrégala tú al cliente";
  }

  statusLabel(row: ImportPreviewRow) {
    return row.status === "VALID"
      ? "Nueva"
      : row.status === "DUPLICATE"
        ? "Duplicada"
        : "Error";
  }

  formatBytes(size: number) {
    return size < 1024 * 1024
      ? `${Math.max(1, Math.round(size / 1024))} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
}
