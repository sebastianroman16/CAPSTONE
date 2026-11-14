import { Component, inject, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { AuthService, errorMessage } from "../../core/auth.service";
import { CasesService } from "../../core/cases.service";
import { LegalCase, ProgressEvent, stageLabel } from "../../core/models";
import { ProgressHistory } from "../supervision/progress-history";
import { CaseWorkspace } from "./case-workspace";
@Component({
  selector: "app-case-detail",
  imports: [RouterLink, DatePipe, ProgressHistory, CaseWorkspace],
  template: ` <a class="back-link" routerLink="/causas"
      >← Volver a mis causas</a
    >
    @if (error()) {
      <div class="error" role="alert">
        {{ error() }}
        <button class="text-button" (click)="load()">Actualizar causa</button>
      </div>
    }
    @if (loading()) {
      <p role="status">Cargando causa…</p>
    }
    @if (item(); as c) {
      <div class="page-head">
        <div>
          <p class="eyebrow mono">
            {{ c.reference }} · {{ c.rit || "Sin RIT registrado" }}
          </p>
          <h1>{{ c.title }}</h1>
          <p class="muted">{{ c.clientName }}</p>
        </div>
        @if (auth.isLawyer()) {
          <a class="button" [routerLink]="['/causas', c.id, 'editar']"
            >Editar causa</a
          >
        }
      </div>
      <div class="detail-grid">
        <section class="card">
          <h2>Información de la causa</h2>
          <dl>
            <div>
              <dt>Materia</dt>
              <dd>{{ c.matter }}</dd>
            </div>
            <div>
              <dt>Tribunal</dt>
              <dd>{{ c.court }}</dd>
            </div>
            <div>
              <dt>Prioridad</dt>
              <dd>
                <span class="badge" [class.high]="c.priority === 'Alta'">{{
                  c.priority
                }}</span>
              </dd>
            </div>
            <div>
              <dt>Estado en LEX-CORPUS</dt>
              <dd>{{ c.status }}</dd>
            </div>
          </dl>
          <p class="footnote">
            Esta información complementa el registro oficial del SAJ.
          </p>
        </section>
        <section class="card">
          <p class="eyebrow">Próxima fecha clave</p>
          <h2>
            {{
              c.nextDate
                ? (c.nextDate | date: "dd/MM/yyyy")
                : "Sin fecha registrada"
            }}
          </h2>
          <p class="muted">
            {{
              c.nextDateLabel || "No hay una descripción de fecha registrada."
            }}
          </p>
          <hr />
          <p class="footnote">
            Última actualización: {{ c.updatedAt | date: "dd/MM/yyyy HH:mm" }}
          </p>
        </section>
      </div>
      @if (auth.isLawyer()) {
        <section class="card">
          <div class="page-head">
            <div>
              <p class="eyebrow">Visible para coordinación jurídica</p>
              <h2>Avance de gestión</h2>
            </div>
            @if (c.status !== "Archivada") {
              <a class="button" [routerLink]="['/causas', c.id, 'avance']"
                >Registrar avance</a
              >
            }
          </div>
          <p>
            <strong>{{ stageLabel(c.progressStage) }}</strong>
          </p>
          <p class="notes">
            {{
              c.progressSummary || "Aún no registras un avance para esta causa."
            }}
          </p>
          <p class="notes">
            <strong>Próxima acción:</strong>
            {{ c.nextAction || "Sin próxima acción registrada" }}
          </p>
          <p class="footnote">
            Último avance:
            {{
              c.progressUpdatedAt
                ? (c.progressUpdatedAt | date: "dd/MM/yyyy HH:mm")
                : "Sin registro"
            }}. La etapa no equivale a un porcentaje judicial.
          </p>
        </section>
        @if (historyError()) {
          <div class="error" role="alert">
            {{ historyError() }}
            <button class="text-button" (click)="loadHistory()">
              Reintentar historial
            </button>
          </div>
        }
        @if (historyLoading()) {
          <p role="status">Cargando historial…</p>
        } @else {
          <app-progress-history [events]="history()" />
        }
        <section class="card">
          <h2>Notas internas</h2>
          <p class="muted">Solo visibles para el abogado responsable.</p>
          <p class="notes">{{ c.internalNotes || "Sin notas internas." }}</p>
        </section>
        @if (c.status !== "Archivada") {
          <div class="form-actions">
            @if (confirmArchive()) {
              <span>¿Archivar esta causa?</span
              ><button
                class="button"
                (click)="confirmArchive.set(false)"
                [disabled]="busy()"
              >
                Cancelar</button
              ><button
                class="button primary"
                (click)="archive()"
                [disabled]="busy()"
              >
                {{ busy() ? "Archivando…" : "Confirmar archivo" }}
              </button>
            } @else {
              <button
                class="button"
                (click)="confirmArchive.set(true)"
                [disabled]="loading() || conflict()"
              >
                Archivar causa
              </button>
            }
          </div>
        }
      }
      <app-case-workspace [caseId]="c.id" [clientId]="c.clientId" [isLawyer]="auth.isLawyer()" />
    }`,
})
export class CaseDetail {
  readonly auth = inject(AuthService);
  private readonly api = inject(CasesService);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get("id")!;
  readonly item = signal<LegalCase | null>(null);
  readonly loading = signal(true);
  readonly error = signal("");
  readonly confirmArchive = signal(false);
  readonly conflict = signal(false);
  readonly busy = signal(false);
  readonly history = signal<ProgressEvent[]>([]);
  readonly historyError = signal("");
  readonly historyLoading = signal(false);
  readonly stageLabel = stageLabel;
  constructor() {
    this.load();
    if (this.auth.isLawyer()) this.loadHistory();
  }
  loadHistory() {
    this.historyLoading.set(true);
    this.historyError.set("");
    this.api.progress(this.id).subscribe({
      next: (events) => {
        this.history.set(events);
        this.historyLoading.set(false);
      },
      error: (e) => {
        this.historyError.set(errorMessage(e));
        this.historyLoading.set(false);
      },
    });
  }
  load() {
    this.loading.set(true);
    this.error.set("");
    this.confirmArchive.set(false);
    this.api.get(this.id).subscribe({
      next: (data) => {
        this.item.set(data);
        this.conflict.set(false);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }
  archive() {
    if (this.busy() || this.loading() || this.conflict() || !this.item())
      return;
    this.busy.set(true);
    this.error.set("");
    this.api.archive(this.id, this.item()!.version).subscribe({
      next: (data) => {
        this.item.set(data);
        this.busy.set(false);
        this.confirmArchive.set(false);
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
        if (e.status === 409) {
          this.conflict.set(true);
          this.confirmArchive.set(false);
        }
      },
    });
  }
}
