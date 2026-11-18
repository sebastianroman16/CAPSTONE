import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { Deadline } from "../../core/models";
import { Agenda, localDate } from "./agenda";

// P3 · Agenda con fecha local y vencidos visibles (E16).
describe("Agenda de pendientes", () => {
  let http: HttpTestingController;
  const deadline = (overrides: Partial<Deadline>): Deadline => ({
    id: "d-1", caseId: "case-1", reference: "LC-1", caseTitle: "Causa", deadlineType: "FILING", title: "Escrito",
    description: null, dueAt: "2026-12-01T12:00:00.000Z", reminderAt: null, urgency: "Media", status: "PENDING", ...overrides,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function create() {
    const component = TestBed.runInInjectionContext(() => new Agenda());
    const requests = http.match((request) => request.url === "/api/agenda");
    expect(requests.length).toBe(2);
    return { component, range: requests[0], overdue: requests[1] };
  }

  describe("caso feliz", () => {
    it("consulta de hoy a 7 días con la fecha local y lista los pendientes", () => {
      const { component, range, overdue } = create();
      expect(range.request.params.get("from")).toBe(localDate());
      expect(range.request.params.get("to")).toBe(localDate(7));
      range.flush([deadline({ urgency: "Alta" })]);
      overdue.flush([]);
      expect(component.items()[0].urgency).toBe("Alta");
      expect(component.loading()).toBe(false);
    });
    it("muestra aparte los plazos vencidos que siguen pendientes", () => {
      const { component, range, overdue } = create();
      expect(overdue.request.params.get("from")).toBe("2000-01-01");
      expect(overdue.request.params.get("to")).toBe(localDate());
      range.flush([]);
      overdue.flush([deadline({ id: "vencido", dueAt: "2020-01-01T12:00:00.000Z" })]);
      expect(component.overdue().map((item) => item.id)).toEqual(["vencido"]);
    });
  });

  describe("caso triste", () => {
    it("muestra el error si la agenda no carga y deja de mostrar 'Cargando'", () => {
      const { component, range, overdue } = create();
      range.flush({ message: "No autorizado." }, { status: 401, statusText: "Unauthorized" });
      overdue.flush([]);
      expect(component.error()).not.toBe("");
      expect(component.loading()).toBe(false);
    });
  });

  describe("caso borde", () => {
    it("calcula hoy con la fecha local y no con UTC (noche y cambio de año)", () => {
      const lateNight = new Date(2026, 10, 18, 22, 30);
      expect(localDate(0, lateNight)).toBe("2026-11-18");
      expect(localDate(7, lateNight)).toBe("2026-11-25");
      expect(localDate(-1, new Date(2026, 0, 1, 0, 5))).toBe("2025-12-31");
      expect(localDate(1, new Date(2028, 1, 28, 23, 59))).toBe("2028-02-29");
    });
    it("excluye de vencidos los realizados y los que aún no vencen hoy", () => {
      const { component, range, overdue } = create();
      range.flush([]);
      overdue.flush([
        deadline({ id: "vencido", dueAt: "2020-01-01T12:00:00.000Z" }),
        deadline({ id: "realizado", dueAt: "2020-01-02T12:00:00.000Z", status: "COMPLETED" }),
        deadline({ id: "cancelado", dueAt: "2020-01-03T12:00:00.000Z", status: "CANCELLED" }),
        deadline({ id: "mas-tarde-hoy", dueAt: new Date(Date.now() + 3600000).toISOString() }),
      ]);
      expect(component.overdue().map((item) => item.id)).toEqual(["vencido"]);
    });
  });
});
