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
import { Observable } from "rxjs";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { CasesService } from "../../core/cases.service";
import { CaseOnboarding, Client, CreatedCase, LegalCase, SaveCase } from "../../core/models";
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
  readonly clientMode = signal<"existing" | "new">("existing");
  readonly onboarding = signal<CaseOnboarding | null>(null);
  readonly createdCaseId = signal("");
  readonly discardConfirm = signal(false);
  /** E15: hay un borrador recuperado tras una expiración por inactividad. */
  readonly draftRestored = signal(false);
  /** E12: una causa archivada es de solo lectura; se reactiva desde su detalle. */
  readonly archived = signal(false);
  private loadedItem: LegalCase | null = null;
  readonly form = inject(FormBuilder).nonNullable.group({
    title: [
      "",
      [Validators.required, Validators.minLength(3), Validators.maxLength(200)],
    ],
    clientId: ["", Validators.required],
    newClientName: ["", [Validators.maxLength(160)]],
    newClientEmail: ["", [Validators.email, Validators.maxLength(254)]],
    newClientPhone: ["", [Validators.maxLength(30)]],
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
  draftKey() {
    return `causa:${this.id ?? "nueva"}`;
  }
  draftValue() {
    return { clientMode: this.clientMode(), values: this.form.getRawValue() };
  }
  private restoreDraft() {
    const draft = this.unsaved.takeDraft<{ clientMode: "existing" | "new"; values: Partial<ReturnType<CaseForm["form"]["getRawValue"]>> }>(this.draftKey());
    if (!draft) return;
    if (!this.id && draft.clientMode === "new") this.setClientMode("new");
    this.form.patchValue(draft.values);
    this.form.markAsDirty();
    this.draftRestored.set(true);
  }
  discardRestoredDraft() {
    this.draftRestored.set(false);
    if (this.loadedItem) this.apply(this.loadedItem);
    else {
      this.setClientMode("existing");
      this.form.reset();
    }
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
      newClientName: "",
      newClientEmail: "",
      newClientPhone: "",
      rit: item.rit ?? "",
      matter: item.matter,
      court: item.court,
      priority: item.priority,
      nextDate: item.nextDate ?? "",
      nextDateLabel: item.nextDateLabel ?? "",
      internalNotes: item.internalNotes ?? "",
    };
  }
  setClientMode(mode: "existing" | "new") {
    if (this.id) return;
    this.clientMode.set(mode);
    const clientId = this.form.controls.clientId;
    const name = this.form.controls.newClientName;
    const email = this.form.controls.newClientEmail;
    if (mode === "new") {
      clientId.clearValidators();
      clientId.setValue("");
      name.setValidators([Validators.required, Validators.minLength(3), Validators.maxLength(160)]);
      email.setValidators([Validators.required, Validators.email, Validators.maxLength(254)]);
    } else {
      clientId.setValidators([Validators.required]);
      name.clearValidators();
      email.setValidators([Validators.email, Validators.maxLength(254)]);
      name.setValue("");
      email.setValue("");
      this.form.controls.newClientPhone.setValue("");
    }
    clientId.updateValueAndValidity();
    name.updateValueAndValidity();
    email.updateValueAndValidity();
    this.form.markAsDirty();
  }
  private apply(item: LegalCase) {
    this.loadedItem = item;
    this.archived.set(item.status === "Archivada");
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
              this.restoreDraft();
              this.loading.set(false);
            },
            error: (e) => this.failed(e),
          });
        else {
          this.restoreDraft();
          this.loading.set(false);
        }
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
    const data: SaveCase = {
      title: raw.title,
      rit: raw.rit,
      matter: raw.matter,
      court: raw.court,
      priority: raw.priority,
      nextDate: raw.nextDate || null,
      nextDateLabel: raw.nextDateLabel,
      internalNotes: raw.internalNotes,
      ...(this.clientMode() === "new" && !this.id
        ? {
            newClientName: raw.newClientName,
            newClientEmail: raw.newClientEmail,
            newClientPhone: raw.newClientPhone || undefined,
          }
        : { clientId: raw.clientId }),
    };
    this.form.disable();
    const request: Observable<LegalCase | CreatedCase> = this.id
      ? this.api.update(this.id, data, this.version())
      : this.api.create(data);
    request.subscribe({
      next: (item) => {
        this.form.enable();
        this.form.markAsPristine();
        this.busy.set(false);
        if (!this.id && "onboarding" in item && item.onboarding?.clientCreated) {
          this.onboarding.set(item.onboarding);
          this.createdCaseId.set(item.id);
        } else void this.router.navigate(["/causas", item.id]);
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
  openCreatedCase() {
    const id = this.createdCaseId();
    if (id) void this.router.navigate(["/causas", id]);
  }
}
