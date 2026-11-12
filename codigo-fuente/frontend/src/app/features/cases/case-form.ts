import {
  Component,
  afterNextRender,
  Injector,
  HostListener,
  OnDestroy,
  inject,
  signal,
} from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { CasesService } from "../../core/cases.service";
import { Client, LegalCase, SaveCase } from "../../core/models";
import { errorMessage } from "../../core/auth.service";
import { UnsavedChangesService } from "../../core/unsaved-changes.service";
const fields: { key: keyof SaveCase; label: string }[] = [
  { key: "title", label: "Carátula" },
  { key: "clientId", label: "Cliente" },
  { key: "rit", label: "RIT" },
  { key: "matter", label: "Materia" },
  { key: "court", label: "Tribunal" },
  { key: "priority", label: "Prioridad" },
  { key: "nextDate", label: "Fecha clave" },
  { key: "nextDateLabel", label: "Descripción de la fecha" },
  { key: "internalNotes", label: "Notas internas" },
];
@Component({
  selector: "app-case-form",
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: "./case-form.html",
})
export class CaseForm implements OnDestroy {
  private readonly api = inject(CasesService);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly unsaved = inject(UnsavedChangesService);
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get("id");
  readonly clients = signal<Client[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly reference = signal("Se asigna al guardar");
  readonly version = signal(1);
  readonly conflict = signal(false);
  readonly latest = signal<LegalCase | null>(null);
  readonly reviewBusy = signal(false);
  readonly reviewError = signal("");
  readonly discardConfirm = signal(false);
  readonly form = inject(FormBuilder).nonNullable.group({
    title: [
      "",
      [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
    ],
    clientId: ["", Validators.required],
    rit: ["", Validators.maxLength(50)],
    matter: ["Familia", Validators.required],
    court: [
      "",
      [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
    ],
    priority: ["Media", Validators.required],
    nextDate: [""],
    nextDateLabel: ["", Validators.maxLength(200)],
    internalNotes: ["", Validators.maxLength(5000)],
  });
  constructor() {
    this.unsaved.register(this);
    this.load();
  }
  ngOnDestroy() {
    this.unsaved.unregister(this);
  }
  hasUnsavedChanges() {
    return this.form.dirty;
  }
  discardPendingChanges() {
    this.form.markAsPristine();
  }
  @HostListener("window:beforeunload", ["$event"])
  beforeUnload(event: BeforeUnloadEvent) {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = "";
    }
  }
  private values(item: LegalCase) {
    return {
      title: item.title,
      clientId: item.clientId,
      rit: item.rit ?? "",
      matter: item.matter,
      court: item.court,
      priority: item.priority,
      nextDate: item.nextDate ?? "",
      nextDateLabel: item.nextDateLabel ?? "",
      internalNotes: item.internalNotes ?? "",
    };
  }
  private apply(item: LegalCase) {
    this.reference.set(item.reference);
    this.version.set(item.version);
    this.form.reset(this.values(item));
  }
  load() {
    this.loading.set(true);
    this.loadError.set(false);
    this.error.set("");
    this.api.clients().subscribe({
      next: (clients) => {
        this.clients.set(clients);
        if (this.id)
          this.api.get(this.id).subscribe({
            next: (item) => {
              this.apply(item);
              this.loading.set(false);
            },
            error: (e) => this.failed(e),
          });
        else this.loading.set(false);
      },
      error: (e) => this.failed(e),
    });
  }
  private failed(e: HttpErrorResponse) {
    this.error.set(errorMessage(e));
    this.loading.set(false);
    this.loadError.set(true);
  }
  reviewLatest() {
    if (!this.id || this.reviewBusy()) return;
    this.reviewBusy.set(true);
    this.reviewError.set("");
    this.discardConfirm.set(false);
    this.api.get(this.id).subscribe({
      next: (item) => {
        this.latest.set(item);
        this.reviewBusy.set(false);
      },
      error: (e) => {
        this.reviewError.set(errorMessage(e));
        this.reviewBusy.set(false);
      },
    });
  }
  differences() {
    const latest = this.latest();
    if (!latest) return [];
    const local = this.form.getRawValue(),
      saved = this.values(latest);
    const display = (key: keyof SaveCase, value: string) =>
      key === "clientId"
        ? (this.clients().find((client) => client.id === value)?.name ??
          latest.clientName)
        : value || "Sin dato";
    return fields
      .filter((field) => local[field.key] !== saved[field.key])
      .map((field) => ({
        label: field.label,
        local: display(field.key, local[field.key]),
        saved: display(field.key, saved[field.key]),
      }));
  }
  useLatest() {
    const latest = this.latest();
    if (!latest || !this.discardConfirm() || this.reviewBusy()) return;
    this.apply(latest);
    this.conflict.set(false);
    this.latest.set(null);
    this.discardConfirm.set(false);
    this.error.set("");
  }
  submit() {
    if (
      this.form.invalid ||
      this.busy() ||
      this.loadError() ||
      this.conflict()
    ) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set("");
    const raw = this.form.getRawValue();
    const data: SaveCase = { ...raw, nextDate: raw.nextDate || null };
    this.form.disable();
    const request = this.id
      ? this.api.update(this.id, data, this.version())
      : this.api.create(data);
    request.subscribe({
      next: (item) => {
        this.form.enable();
        this.form.markAsPristine();
        this.busy.set(false);
        void this.router.navigate(["/causas", item.id]);
      },
      error: (e: HttpErrorResponse) => {
        this.form.enable();
        this.busy.set(false);
        if (e.status === 409 && e.error?.code === "CASE_VERSION_CONFLICT") {
          this.conflict.set(true);
          afterNextRender(
            () => document.getElementById("conflict-title")?.focus(),
            { injector: this.injector },
          );
          this.reviewLatest();
        } else this.error.set(errorMessage(e));
      },
    });
  }
}
