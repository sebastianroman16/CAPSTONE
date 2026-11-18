import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { Communication, TimelineEvent } from "../../core/models";
import { CaseWorkspace } from "./case-workspace";

// Mockups 07 y 13 · Tipo de mensaje, "Visto por el cliente" y línea de tiempo (HU-14, HU-15, HU-21).
describe("Comunicación y línea de tiempo de la causa", () => {
  let fixture: ComponentFixture<CaseWorkspace>;
  let http: HttpTestingController;
  const message = (overrides: Partial<Communication>): Communication => ({
    id: "m-1", message: "Se fijó audiencia de conciliación.", channel: "IN_APP", category: "STATUS_UPDATE",
    deliveryStatus: "DELIVERED", readAt: null, createdAt: "2026-09-05T14:20:00.000Z", authorName: "Abogada", ...overrides,
  });
  const event = (overrides: Partial<TimelineEvent>): TimelineEvent => ({
    kind: "MOVEMENT", title: "Audiencia", detail: "El tribunal fijó audiencia de conciliación.", court: "1° Juzgado de Familia",
    date: "2026-08-14", recordedAt: "2026-08-14T15:00:00.000Z", ...overrides,
  });

  function open(isLawyer: boolean, communications: Communication[] = [], timeline: TimelineEvent[] = []) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    fixture = TestBed.createComponent(CaseWorkspace);
    fixture.componentRef.setInput("caseId", "case-1");
    fixture.componentRef.setInput("clientId", "client-1");
    fixture.componentRef.setInput("isLawyer", isLawyer);
    fixture.detectChanges();
    http = TestBed.inject(HttpTestingController);
    http.expectOne("/api/cases/case-1/timeline").flush(timeline);
    http.expectOne("/api/cases/case-1/communications").flush(communications);
    http.expectOne("/api/cases/case-1/documents").flush([]);
    http.expectOne("/api/document-requests").flush([]);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  afterEach(() => http.verify());

  describe("caso feliz", () => {
    it("el abogado envía un recordatorio de audiencia con su tipo", () => {
      open(true);
      const component = fixture.componentInstance;
      component.message = "Recuerda llevar tus comprobantes.";
      component.category = "HEARING_REMINDER";
      component.send();
      const request = http.expectOne("/api/cases/case-1/communications");
      expect(request.request.method).toBe("POST");
      expect(request.request.body).toEqual({ message: "Recuerda llevar tus comprobantes.", channel: "IN_APP", category: "HEARING_REMINDER" });
      request.flush(message({ category: "HEARING_REMINDER" }));
      http.expectOne("/api/cases/case-1/timeline").flush([]);
      http.expectOne("/api/cases/case-1/communications").flush([]);
      http.expectOne("/api/cases/case-1/documents").flush([]);
      http.expectOne("/api/document-requests").flush([]);
      expect(component.category).toBe("STATUS_UPDATE");
    });
    it("el abogado ve qué mensajes vio el cliente y el cliente ve su línea de tiempo", () => {
      const lawyerView = open(true, [message({ readAt: "2026-09-05T23:04:00.000Z" }), message({ id: "m-2" })]);
      expect(lawyerView.textContent).toContain("Visto por el cliente el");
      expect(lawyerView.textContent).toContain("Pendiente de visualización");
    });
  });

  describe("caso triste", () => {
    it("el cliente no ve el formulario de envío ni el estado de lectura", () => {
      const clientView = open(false, [message({ readAt: null })], [event({})]);
      expect(clientView.querySelector("#communication-category")).toBeNull();
      expect(clientView.textContent).not.toContain("Pendiente de visualización");
      expect(clientView.textContent).toContain("El tribunal fijó audiencia de conciliación.");
    });
    it("sin hitos muestra un mensaje vacío", () => {
      expect(open(false).textContent).toContain("Sin hitos registrados.");
    });
  });

  describe("caso borde", () => {
    it("un mensaje anterior sin tipo se muestra como actualización de estado", () => {
      const view = open(true, [{ ...message({}), category: undefined as never }]);
      expect(view.textContent).toContain("Actualización de estado");
      expect(fixture.componentInstance.categoryOptions.map((option) => option.value)).toEqual(["STATUS_UPDATE", "HEARING_REMINDER", "INFO_REQUEST"]);
    });
    it("muestra el ingreso a LEX-CORPUS y el tribunal solo cuando existe", () => {
      const view = open(false, [], [
        event({}),
        event({ kind: "CASE_CREATED", title: "Causa ingresada a LEX-CORPUS", detail: "Tu causa fue registrada.", court: null, date: "2026-07-28" }),
      ]);
      const items = Array.from(view.querySelectorAll(".timeline")[0].querySelectorAll("li"));
      expect(items.map((item) => item.querySelector("strong")?.textContent?.trim())).toEqual(["14/08/2026 · Audiencia", "28/07/2026 · Causa ingresada a LEX-CORPUS"]);
      expect(items[1].querySelector("small")).toBeNull();
    });
  });
});
