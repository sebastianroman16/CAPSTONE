import { Component, computed, inject, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { AuthService, errorMessage } from "../../core/auth.service";
import { CasesService } from "../../core/cases.service";
import { LegalCase, stageLabel } from "../../core/models";
@Component({
  selector: "app-case-list",
  imports: [RouterLink, FormsModule, DatePipe],
  templateUrl: "./case-list.html",
})
export class CaseList {
  readonly auth = inject(AuthService);
  private readonly api = inject(CasesService);
  readonly cases = signal<LegalCase[]>([]);
  readonly loading = signal(true);
  readonly error = signal("");
  readonly query = signal("");
  readonly matter = signal("");
  readonly priority = signal("");
  readonly status = signal("Activa");
  readonly stageLabel = stageLabel;
  readonly active = computed(() =>
    this.cases().filter((c) => c.status === "Activa"),
  );
  readonly urgent = computed(
    () => this.active().filter((c) => c.priority === "Alta").length,
  );
  readonly upcoming = computed(
    () => this.active().filter((c) => c.nextDate).length,
  );
  readonly filtered = computed(() => {
    const q = this.query().trim().toLocaleLowerCase("es");
    const matches = this.cases().filter(
      (c) =>
        (!this.status() || c.status === this.status()) &&
        (!this.matter() || c.matter === this.matter()) &&
        (!this.priority() || c.priority === this.priority()) &&
        (!q ||
          [c.title, c.clientName, c.reference, c.rit]
            .join(" ")
            .toLocaleLowerCase("es")
            .includes(q)),
    );
    if (this.auth.isLawyer()) return matches;
    return [...matches].sort((a, b) => {
      if (!a.nextDate) return 1;
      if (!b.nextDate) return -1;
      return a.nextDate.localeCompare(b.nextDate);
    });
  });
  constructor() {
    this.load();
  }
  load() {
    this.loading.set(true);
    this.error.set("");
    this.api.list().subscribe({
      next: (data) => {
        this.cases.set(data);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }
  reset() {
    this.query.set("");
    this.matter.set("");
    this.priority.set("");
    this.status.set("Activa");
  }
}
