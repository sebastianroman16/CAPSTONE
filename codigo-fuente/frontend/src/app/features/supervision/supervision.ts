import { Component, inject, OnDestroy, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { Subscription } from "rxjs";
import { SupervisionService } from "../../core/supervision.service";
import {
  progressStages,
  stageLabel,
  SupervisionDashboard,
} from "../../core/models";
import { errorMessage } from "../../core/auth.service";
@Component({
  selector: "app-supervision",
  imports: [FormsModule, RouterLink, DatePipe],
  templateUrl: "./supervision.html",
})
export class Supervision implements OnDestroy {
  private readonly api = inject(SupervisionService);
  private pending?: Subscription;
  readonly data = signal<SupervisionDashboard | null>(null);
  readonly loading = signal(false);
  readonly error = signal("");
  readonly stages = progressStages;
  readonly stageLabel = stageLabel;
  query = "";
  lawyerId = "";
  status = "Activa";
  stage = "";
  attention = "";
  page = 1;
  private applied: Record<string, string> = { status: "Activa" };
  constructor() {
    this.load();
  }
  apply() {
    this.applied = Object.fromEntries(
      Object.entries({
        q: this.query.trim(),
        lawyerId: this.lawyerId,
        status: this.status,
        stage: this.stage,
        attention: this.attention,
      }).filter(([, v]) => v),
    );
    this.page = 1;
    this.load();
  }
  selectLawyer(id: string) {
    this.lawyerId = id;
    this.apply();
  }
  reset() {
    this.query = "";
    this.lawyerId = "";
    this.status = "Activa";
    this.stage = "";
    this.attention = "";
    this.apply();
  }
  go(page: number) {
    this.page = page;
    this.load();
  }
  load() {
    this.pending?.unsubscribe();
    this.loading.set(true);
    this.error.set("");
    this.pending = this.api
      .dashboard({ ...this.applied, page: String(this.page) })
      .subscribe({
        next: (data) => {
          this.data.set(data);
          this.loading.set(false);
        },
        error: (e) => {
          this.error.set(errorMessage(e));
          this.loading.set(false);
        },
      });
  }
  ngOnDestroy() {
    this.pending?.unsubscribe();
  }
}
