import { Component, inject, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { SupervisionService } from "../../core/supervision.service";
import { errorMessage } from "../../core/auth.service";
import { ProgressEvent, stageLabel, SupervisedCase } from "../../core/models";
import { ProgressHistory } from "./progress-history";
import { FormsModule } from "@angular/forms";
import { AdminService } from "../../core/admin.service";
import { ManagedUser } from "../../core/models";
@Component({
  selector: "app-supervision-detail",
  imports: [DatePipe, RouterLink, ProgressHistory, FormsModule],
  template: ` <a class="back-link" routerLink="/supervision"
      >← Volver a supervisión</a
    >
    @if (loading()) {
      <p role="status">Cargando seguimiento de la causa…</p>
    }
    @if (error()) {
      <div class="error" role="alert">
        {{ error() }}
        <button class="text-button" (click)="load()">Reintentar</button>
      </div>
      <section class="card"><h2>Reasignar responsable</h2><p class="muted">La reasignación queda registrada en el historial y conserva todos los datos de la causa.</p><form (ngSubmit)="reassign()"><div class="field"><label for="new-lawyer">Nuevo abogado</label><select id="new-lawyer" name="newLawyerId" [(ngModel)]="newLawyerId" required><option value="">Selecciona un abogado activo</option>@for(lawyer of lawyers();track lawyer.id){<option [value]="lawyer.id">{{lawyer.name}}</option>}</select></div><div class="field"><label for="reason">Motivo</label><textarea id="reason" name="reason" [(ngModel)]="reason" required minlength="5" maxlength="500"></textarea></div><button class="button" [disabled]="!newLawyerId||reason.trim().length<5">Confirmar reasignación</button></form></section>
    }
    @if (item(); as c) {
      <div class="page-head">
        <div>
          <p class="eyebrow">{{ c.reference }} · Supervisión y coordinación</p>
          <h1>{{ c.title }}</h1>
          <p class="muted">
            Responsable: {{ c.lawyerName
            }}{{ c.lawyerActive ? "" : " · Cuenta inactiva" }}
          </p>
        </div>
        <span class="badge" [class.high]="c.needsAttention">{{
          c.needsAttention ? "Revisar seguimiento" : c.status
        }}</span>
      </div>
      <div class="detail-grid">
        <section class="card">
          <h2>Información de la causa</h2>
          <dl>
            <div>
              <dt>Cliente</dt>
              <dd>{{ c.clientName }}</dd>
            </div>
            <div>
              <dt>RIT</dt>
              <dd>{{ c.rit || "Sin RIT registrado" }}</dd>
            </div>
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
              <dd>{{ c.priority }}</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>{{ c.status }}</dd>
            </div>
          </dl>
        </section>
        <section class="card">
          <p class="eyebrow">Etapa de gestión</p>
          <h2>{{ stageLabel(c.progressStage) }}</h2>
          <p class="notes">
            {{ c.progressSummary || "Sin avance informado por el abogado." }}
          </p>
          <h3>Próxima acción</h3>
          <p class="notes">
            {{ c.nextAction || "Sin próxima acción registrada" }}
          </p>
          <p class="footnote">
            Último avance:
            {{
              c.progressUpdatedAt
                ? (c.progressUpdatedAt | date: "dd/MM/yyyy HH:mm")
                : "Sin registro"
            }}
          </p>
          <p class="footnote">
            Fecha clave:
            {{ c.nextDate ? (c.nextDate | date: "dd/MM/yyyy") : "Sin fecha" }} ·
            {{ c.nextDateLabel || "Sin descripción" }}
          </p>
        </section>
      </div>
      <p class="footnote supervision-note">
        Las etapas son informadas por el abogado y no equivalen a un porcentaje
        ni a una resolución judicial. Las notas privadas del abogado no forman
        parte de esta vista.
      </p>
      <app-progress-history [events]="c.history" />
    }`,
})
export class SupervisionDetail {
  private readonly api = inject(SupervisionService);
  private readonly admin=inject(AdminService);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get("id")!;
  readonly item = signal<
    (SupervisedCase & { history: ProgressEvent[] }) | null
  >(null);
  readonly error = signal("");
  readonly loading = signal(false);
  readonly stageLabel = stageLabel;
  readonly lawyers=signal<ManagedUser[]>([]);newLawyerId="";reason="";
  constructor() {
    this.load();
    this.admin.users().subscribe({next:users=>this.lawyers.set(users.filter(user=>user.role==="LAWYER"&&user.active)),error:e=>this.error.set(errorMessage(e))});
  }
  load() {
    this.loading.set(true);
    this.error.set("");
    this.item.set(null);
    this.api.detail(this.id).subscribe({
      next: (c) => {
        this.item.set(c);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }
  reassign(){if(!this.newLawyerId||this.reason.trim().length<5)return;this.admin.reassign(this.id,this.newLawyerId,this.reason).subscribe({next:()=>{this.newLawyerId="";this.reason="";this.load();},error:e=>this.error.set(errorMessage(e))});}
}
