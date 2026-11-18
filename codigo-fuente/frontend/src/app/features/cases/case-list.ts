import { Component, computed, inject, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { AuthService, errorMessage } from "../../core/auth.service";
import { CasesService } from "../../core/cases.service";
import { LegalCase, stageLabel } from "../../core/models";
/** E20: compara sin tildes ni diéresis ("munoz" encuentra "Muñoz"). */
export function searchText(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}
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
  readonly sortBy = signal<"priority" | "client" | "matter" | "date">("priority");
  readonly sortDirection = signal<"asc" | "desc">("asc");
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
    const q = searchText(this.query().trim());
    const matches = this.cases().filter(
      (c) =>
        (!this.status() || c.status === this.status()) &&
        (!this.matter() || c.matter === this.matter()) &&
        (!this.priority() || c.priority === this.priority()) &&
        (!q ||
          searchText([c.title, c.clientName, c.reference, c.rit].join(" ")).includes(q)),
    );
    if (!this.auth.isLawyer()) return [...matches].sort((a, b) => {
      if (!a.nextDate) return 1;
      if (!b.nextDate) return -1;
      return a.nextDate.localeCompare(b.nextDate);
    });
    const priority = { Alta: 0, Media: 1, Baja: 2 } as const;
    const direction = this.sortDirection() === "asc" ? 1 : -1;
    return [...matches].sort((a, b) => {
      const comparison = this.sortBy() === "priority"
        ? priority[a.priority] - priority[b.priority]
        : this.sortBy() === "client"
          ? a.clientName.localeCompare(b.clientName, "es", { sensitivity: "base" })
          : this.sortBy() === "matter"
            ? a.matter.localeCompare(b.matter, "es", { sensitivity: "base" })
            : (a.nextDate ?? "9999-12-31").localeCompare(b.nextDate ?? "9999-12-31");
      return comparison * direction || a.reference.localeCompare(b.reference, "es", { numeric: true });
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
    this.sortBy.set("priority");
    this.sortDirection.set("asc");
  }
}
