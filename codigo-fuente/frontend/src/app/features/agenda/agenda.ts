import { DatePipe } from "@angular/common";
import { Component, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { errorMessage } from "../../core/auth.service";
import { PendingItem } from "../../core/models";
import { ProductService } from "../../core/product.service";

/** Fecha local AAAA-MM-DD: toISOString() usaría UTC y desde las 21:00 en Chile mostraría el día siguiente. */
export function localDate(offsetDays = 0, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export type AgendaTab = "today" | "week" | "all";
export interface AgendaGroup { key: "overdue" | "today" | "week" | "later"; title: string; items: PendingItem[]; }

const URGENCY_RANK: Record<string, number> = { Alta: 0, Media: 1, Baja: 2 };

/**
 * HU-13 (mockup 09): agrupa los pendientes en vencidos, hoy, los próximos 7 días y más adelante,
 * ordenados por día y, dentro del mismo día, por urgencia.
 */
export function groupPending(items: PendingItem[], now = new Date()): AgendaGroup[] {
  const today = localDate(0, now);
  const weekEnd = localDate(7, now);
  const groups: AgendaGroup[] = [
    { key: "overdue", title: "Vencidos sin realizar", items: [] },
    { key: "today", title: "Hoy", items: [] },
    { key: "week", title: "Esta semana", items: [] },
    { key: "later", title: "Más adelante", items: [] },
  ];
  for (const item of items) {
    const due = new Date(item.dueAt);
    const day = localDate(0, due);
    const group = due.getTime() < now.getTime() ? 0 : day === today ? 1 : day <= weekEnd ? 2 : 3;
    groups[group].items.push(item);
  }
  for (const group of groups)
    group.items.sort((a, b) => {
      const dayA = localDate(0, new Date(a.dueAt));
      const dayB = localDate(0, new Date(b.dueAt));
      if (dayA !== dayB) return dayA < dayB ? -1 : 1;
      const urgency = (URGENCY_RANK[a.urgency ?? ""] ?? 3) - (URGENCY_RANK[b.urgency ?? ""] ?? 3);
      return urgency || new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
  return groups;
}

const TAB_GROUPS: Record<AgendaTab, AgendaGroup["key"][]> = {
  today: ["overdue", "today"],
  week: ["week"],
  all: ["overdue", "today", "week", "later"],
};

@Component({
  selector: "app-agenda",
  imports: [DatePipe, RouterLink],
  template: `<div class="page-head"><div><p class="eyebrow">Organización</p><h1>Pendientes</h1>
      <p class="muted">Audiencias, plazos y solicitudes de documentos que requieren tu atención — hoy {{ todayLabel }}.</p></div></div>
    <div class="tabs" role="tablist" aria-label="Periodo de pendientes">
      @for (option of tabs; track option.value) {
        <button type="button" role="tab" class="tab" [class.active]="tab() === option.value" [attr.aria-selected]="tab() === option.value" (click)="tab.set(option.value)">
          {{ option.label }} <span class="count">{{ count(option.value) }}</span>
        </button>
      }
    </div>
    @if (error()) {<div class="error" role="alert">{{ error() }} <button class="text-button" (click)="load()">Reintentar</button></div>}
    @if (loading()) {<p role="status">Cargando…</p>} @else {
      @for (group of visibleGroups(); track group.key) {
        <section class="card">
          <h2>{{ group.title }} <small class="muted">· {{ group.items.length }} {{ group.items.length === 1 ? "pendiente" : "pendientes" }}</small></h2>
          <ul class="timeline">
            @for (item of group.items; track item.kind + item.id) {
              <li>
                <strong>{{ item.dueAt | date: "dd/MM/yyyy HH:mm" }} · {{ item.title }}</strong>
                <span class="badge">{{ kindLabel(item) }}</span>
                @if (item.urgency) {<span class="badge" [class.high]="item.urgency === 'Alta'">Urgencia {{ item.urgency.toLowerCase() }}</span>}
                <p>{{ item.clientName }} · {{ item.reference }} · {{ item.caseTitle }}</p>
                <a [routerLink]="['/causas', item.caseId]">Abrir causa</a>
                @if (item.kind === "DEADLINE") {<button class="text-button" (click)="complete(item)">Marcar realizado</button>}
              </li>
            }
          </ul>
        </section>
      } @empty {
        <section class="card"><p>Sin pendientes en este periodo.</p></section>
      }
    }`,
})
export class Agenda {
  private api = inject(ProductService);
  readonly todayLabel = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long" }).format(new Date());
  readonly items = signal<PendingItem[]>([]);
  readonly tab = signal<AgendaTab>("today");
  readonly loading = signal(true);
  readonly error = signal("");
  readonly tabs: Array<{ value: AgendaTab; label: string }> = [
    { value: "today", label: "Hoy" },
    { value: "week", label: "Esta semana" },
    { value: "all", label: "Todos" },
  ];
  readonly groups = computed(() => groupPending(this.items()));
  readonly visibleGroups = computed(() =>
    this.groups().filter((group) => TAB_GROUPS[this.tab()].includes(group.key) && group.items.length),
  );
  constructor() { this.load(); }
  load() {
    this.loading.set(true);
    this.error.set("");
    this.api.pending().subscribe({
      next: (items) => { this.items.set(items); this.loading.set(false); },
      error: (e) => { this.error.set(errorMessage(e)); this.loading.set(false); },
    });
  }
  count(tab: AgendaTab) {
    return this.groups().filter((group) => TAB_GROUPS[tab].includes(group.key)).reduce((total, group) => total + group.items.length, 0);
  }
  kindLabel(item: PendingItem) {
    if (item.kind === "DOCUMENT_REQUEST") return "Solicitud de documento";
    return item.deadlineType === "HEARING" ? "Audiencia" : item.deadlineType === "REMINDER" ? "Recordatorio" : "Plazo";
  }
  complete(item: PendingItem) {
    this.api.deadlineStatus(item.id, "COMPLETED").subscribe({ next: () => this.load(), error: (e) => this.error.set(errorMessage(e)) });
  }
}
