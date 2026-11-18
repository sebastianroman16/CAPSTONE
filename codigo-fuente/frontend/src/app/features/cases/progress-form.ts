import {
  afterNextRender,
  Component,
  HostListener,
  inject,
  Injector,
  OnDestroy,
  signal,
} from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { DatePipe } from "@angular/common";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { CasesService } from "../../core/cases.service";
import { errorMessage } from "../../core/auth.service";
import { UnsavedChangesService } from "../../core/unsaved-changes.service";
import { LegalCase, progressStages, stageLabel } from "../../core/models";
@Component({
  selector: "app-progress-form",
  imports: [ReactiveFormsModule, RouterLink, DatePipe],
  template: ` <a class="back-link" [routerLink]="['/causas', id]"
      >← Volver a la causa</a
    >
    <div class="page-head">
      <div>
        <p class="eyebrow">Seguimiento del equipo jurídico</p>
        <h1>Registrar avance</h1>
        <p class="muted">{{ item()?.title }}</p>
      </div>
    </div>
    <p class="supervision-note">
      El coordinador jurídico podrá consultar este avance. Usa las notas
      internas de la causa para información privada. Cada guardado agrega un
      registro al historial.
    </p>
    @if (loading()) {
      <p role="status">Cargando causa…</p>
    }
    @if (error()) {
      <div class="error" role="alert">
        {{ error() }}
        @if (!item()) {
          <button class="text-button" (click)="load()">Reintentar</button>
        }
      </div>
    }
    @if (conflict()) {
      <section class="conflict-panel" aria-labelledby="progress-conflict">
        <h2 id="progress-conflict" tabindex="-1">
          La causa cambió mientras registrabas el avance
        </h2>
        <p>
          Tu avance no se guardó. Conservamos lo que escribiste; revisa la
          información actual antes de descartarlo.
        </p>
        @if (latest(); as c) {
          <h3>Último avance guardado</h3>
          <p>
            {{ stageLabel(c.progressStage) }} ·
            {{
              c.progressUpdatedAt
                ? (c.progressUpdatedAt | date: "dd/MM/yyyy HH:mm")
                : "Sin fecha"
            }}
          </p>
          <p class="notes">{{ c.progressSummary || "Sin avance informado" }}</p>
          <p class="notes">
            <strong>Próxima acción:</strong>
            {{ c.nextAction || "Sin próxima acción" }}
          </p>
          <p>
            Estado actual: {{ c.status }}. Puedes copiar tu borrador antes de
            cargar esta información.
          </p>
        }
        @if (reviewError()) {
          <p role="alert">{{ reviewError() }}</p>
        }
        <div class="conflict-actions">
          <button class="button" (click)="review()" [disabled]="reviewBusy()">
            {{ reviewBusy() ? "Consultando…" : "Consultar de nuevo" }}
          </button>
          @if (latest() && !reviewBusy()) {
            @if (discardConfirm()) {
              <p>Se reemplazará el formulario con los datos consultados.</p>
              <button class="button" (click)="discardConfirm.set(false)">
                Conservar mi borrador</button
              ><button class="button" (click)="useLatest()">
                Descartar y cargar datos
              </button>
            } @else {
              <button class="button" (click)="discardConfirm.set(true)">
                Cargar datos actuales
              </button>
            }
          }
        </div>
      </section>
    }
    @if (item(); as c) {
      @if (c.status === "Archivada") {
        <p class="card">
          Esta causa está archivada. Puedes consultar su historial, pero no
          registrar nuevos avances.
        </p>
      } @else {
        @if (draftRestored()) {
          <div class="conflict-panel" role="status">
            <p>
              Recuperamos el avance que no alcanzaste a guardar antes de que tu
              sesión expirara. Revísalo antes de guardar.
            </p>
            <button type="button" class="button" (click)="discardRestoredDraft()">
              Descartar borrador
            </button>
          </div>
        }
        <form class="card case-form" [formGroup]="form" (ngSubmit)="submit()">
          <div class="field">
            <label for="progress-stage">Etapa de gestión</label
            ><select id="progress-stage" formControlName="stage">
              @for (s of stages; track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }</select
            ><small
              >Describe la gestión actual; no equivale a un porcentaje de
              resultado judicial.</small
            >
          </div>
          <div class="field">
            <label for="progress-summary">Avance realizado</label
            ><textarea
              id="progress-summary"
              rows="5"
              formControlName="summary"
              minlength="10"
              maxlength="2000"
              placeholder="Describe la gestión realizada y su resultado…"
            ></textarea
            ><small>Entre 10 y 2000 caracteres.</small>
            @if (
              form.controls.summary.touched && form.controls.summary.invalid
            ) {
              <span class="validation"
                >Describe el avance con al menos 10 caracteres.</span
              >
            }
          </div>
          <div class="field">
            <label for="progress-next">Próxima acción (opcional)</label
            ><textarea
              id="progress-next"
              rows="3"
              formControlName="nextAction"
              maxlength="1000"
              placeholder="Indica qué falta por hacer…"
            ></textarea>
          </div>
          <div class="form-actions">
            @if (form.dirty) {
              <span class="draft-status" role="status"
                >Cambios sin guardar</span
              >
            }
            <a class="button" [routerLink]="['/causas', id]">Cancelar</a
            ><button
              class="button primary"
              type="submit"
              [disabled]="busy() || conflict()"
            >
              {{ busy() ? "Guardando…" : "Guardar avance" }}
            </button>
          </div>
        </form>
      }
    }`,
})
export class ProgressForm implements OnDestroy {
  private readonly api = inject(CasesService);
  private readonly router = inject(Router);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly injector = inject(Injector);
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get("id")!;
  readonly item = signal<LegalCase | null>(null);
  readonly latest = signal<LegalCase | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  /** E15: hay un borrador recuperado tras una expiración por inactividad. */
  readonly draftRestored = signal(false);
  readonly conflict = signal(false);
  readonly reviewBusy = signal(false);
  readonly reviewError = signal("");
  readonly discardConfirm = signal(false);
  readonly stages = progressStages.filter((s) => s.value !== "NOT_REPORTED");
  readonly stageLabel = stageLabel;
  readonly form = inject(FormBuilder).nonNullable.group({
    stage: ["ASSESSMENT", Validators.required],
    summary: [
      "",
      [
        Validators.required,
        Validators.minLength(10),
        Validators.maxLength(2000),
      ],
    ],
    nextAction: ["", Validators.maxLength(1000)],
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
    return `avance:${this.id}`;
  }
  draftValue() {
    return this.form.getRawValue();
  }
  private restoreDraft() {
    const draft = this.unsaved.takeDraft<Partial<ReturnType<ProgressForm["form"]["getRawValue"]>>>(this.draftKey());
    if (!draft || this.item()?.status === "Archivada") return;
    this.form.patchValue(draft);
    this.form.markAsDirty();
    this.draftRestored.set(true);
  }
  discardRestoredDraft() {
    this.draftRestored.set(false);
    if (this.item()) this.apply(this.item()!);
    this.form.markAsPristine();
  }
  @HostListener("window:beforeunload", ["$event"]) beforeUnload(
    event: BeforeUnloadEvent,
  ) {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = "";
    }
  }
  private apply(c: LegalCase) {
    this.item.set(c);
    this.form.reset({
      stage:
        c.progressStage && c.progressStage !== "NOT_REPORTED"
          ? c.progressStage
          : "ASSESSMENT",
      summary: c.progressSummary ?? "",
      nextAction: c.nextAction ?? "",
    });
  }
  load() {
    if (this.form.dirty) return;
    this.loading.set(true);
    this.error.set("");
    this.api.get(this.id).subscribe({
      next: (c) => {
        this.apply(c);
        this.restoreDraft();
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }
  review() {
    if (this.reviewBusy()) return;
    this.reviewBusy.set(true);
    this.reviewError.set("");
    this.latest.set(null);
    this.discardConfirm.set(false);
    this.api.get(this.id).subscribe({
      next: (c) => {
        this.latest.set(c);
        this.reviewBusy.set(false);
      },
      error: (e) => {
        this.reviewError.set(errorMessage(e));
        this.reviewBusy.set(false);
      },
    });
  }
  useLatest() {
    if (!this.discardConfirm() || !this.latest() || this.reviewBusy()) return;
    this.apply(this.latest()!);
    this.latest.set(null);
    this.conflict.set(false);
    this.discardConfirm.set(false);
    this.error.set("");
  }
  submit() {
    if (
      this.busy() ||
      this.conflict() ||
      !this.item() ||
      this.item()!.status === "Archivada"
    )
      return;
    const data = this.form.getRawValue();
    data.summary = data.summary.trim();
    data.nextAction = data.nextAction.trim();
    if (this.form.invalid || data.summary.length < 10) {
      this.form.controls.summary.setValue(data.summary);
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set("");
    this.form.disable();
    this.api
      .saveProgress(this.id, { ...data, version: this.item()!.version })
      .subscribe({
        next: () => {
          this.form.enable();
          this.form.markAsPristine();
          this.busy.set(false);
          void this.router.navigate(["/causas", this.id]);
        },
        error: (e) => {
          this.form.enable();
          this.busy.set(false);
          this.error.set(errorMessage(e));
          if (e.status === 409 && e.error?.code === "CASE_VERSION_CONFLICT") {
            this.conflict.set(true);
            this.review();
            afterNextRender(
              () => document.getElementById("progress-conflict")?.focus(),
              { injector: this.injector },
            );
          }
        },
      });
  }
}
