import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { PendingItem } from "../../core/models";
import { Agenda, groupPending, localDate } from "./agenda";

// Mockup 09 · Pendientes con pestañas Hoy, Esta semana y Todos, con plazos y solicitudes (HU-13).
describe("Pendientes del abogado", () => {
  let http: HttpTestingController;
  const now = new Date(2026, 8, 10, 8, 0); // 10 de septiembre, 08:00 hora local
  const at = (day: number, hour = 12) => new Date(2026, 8, day, hour, 0).toISOString();
  const item = (overrides: Partial<PendingItem>): PendingItem => ({
    kind: "DEADLINE", id: "d-1", caseId: "case-1", reference: "LC-1", caseTitle: "Causa", clientName: "María",
    deadlineType: "FILING", title: "Vence plazo", dueAt: at(10), urgency: "Media", ...overrides,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function create(items: PendingItem[] | null, error = false) {
    const component = TestBed.runInInjectionContext(() => new Agenda());
    const request = http.expectOne("/api/pending");
    if (error) request.flush({ message: "No autorizado." }, { status: 403, statusText: "Forbidden" });
    else request.flush(items);
    return component;
  }

  describe("caso feliz", () => {
    it("separa hoy, esta semana y más adelante, con plazos y solicitudes de documentos", () => {
      const groups = groupPending([
        item({ id: "hoy" }),
        item({ id: "semana", kind: "DOCUMENT_REQUEST", deadlineType: null, urgency: null, dueAt: at(12) }),
        item({ id: "despues", dueAt: at(25) }),
      ], now);
      expect(Object.fromEntries(groups.map((group) => [group.key, group.items.map((entry) => entry.id)]))).toEqual({
        overdue: [], today: ["hoy"], week: ["semana"], later: ["despues"],
      });
    });
    it("la pestaña Hoy es la inicial y cada pestaña muestra solo sus grupos", () => {
      const component = create([item({ id: "a", dueAt: new Date(Date.now() + 60000).toISOString() }), item({ id: "b", dueAt: new Date(Date.now() + 3 * 86400000).toISOString() })]);
      expect(component.tab()).toBe("today");
      expect(component.visibleGroups().flatMap((group) => group.items.map((entry) => entry.id))).toContain("a");
      component.tab.set("week");
      expect(component.visibleGroups().flatMap((group) => group.items.map((entry) => entry.id))).toEqual(["b"]);
      component.tab.set("all");
      expect(component.count("all")).toBe(2);
    });
  });

  describe("caso triste", () => {
    it("muestra el error si los pendientes no cargan y deja de mostrar 'Cargando'", () => {
      const component = create(null, true);
      expect(component.error()).not.toBe("");
      expect(component.loading()).toBe(false);
    });
    it("solo los plazos se pueden marcar como realizados", () => {
      const component = create([]);
      component.complete(item({ id: "plazo" }));
      const request = http.expectOne("/api/deadlines/plazo");
      expect(request.request.body).toEqual({ status: "COMPLETED" });
      request.flush({});
      http.expectOne("/api/pending").flush([]);
      expect(component.kindLabel(item({ kind: "DOCUMENT_REQUEST" }))).toBe("Solicitud de documento");
    });
  });

  describe("caso borde", () => {
    it("los vencidos aparecen en Hoy y, el mismo día, la urgencia alta va primero", () => {
      const groups = groupPending([
        item({ id: "baja", dueAt: at(11, 9), urgency: "Baja" }),
        item({ id: "solicitud", dueAt: at(11, 8), kind: "DOCUMENT_REQUEST", urgency: null }),
        item({ id: "alta", dueAt: at(11, 18), urgency: "Alta" }),
        item({ id: "vencido", dueAt: at(9) }),
      ], now);
      expect(groups.find((group) => group.key === "week")!.items.map((entry) => entry.id)).toEqual(["alta", "baja", "solicitud"]);
      expect(groups.find((group) => group.key === "overdue")!.items.map((entry) => entry.id)).toEqual(["vencido"]);
    });
    it("el día 7 cuenta como esta semana y el 8 como más adelante; el día se calcula en hora local", () => {
      const groups = groupPending([item({ id: "dia7", dueAt: at(17, 23) }), item({ id: "dia8", dueAt: at(18, 0) })], now);
      expect(groups.find((group) => group.key === "week")!.items.map((entry) => entry.id)).toEqual(["dia7"]);
      expect(groups.find((group) => group.key === "later")!.items.map((entry) => entry.id)).toEqual(["dia8"]);
      const lateNight = new Date(2026, 10, 18, 22, 30);
      expect(localDate(0, lateNight)).toBe("2026-11-18");
      expect(localDate(-1, new Date(2026, 0, 1, 0, 5))).toBe("2025-12-31");
    });
  });
});
