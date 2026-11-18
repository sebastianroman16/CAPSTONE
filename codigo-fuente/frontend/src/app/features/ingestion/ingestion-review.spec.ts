import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { IngestionItem, LegalCase } from "../../core/models";
import { Ingestion } from "./ingestion";

// Mockups 10 y 11: cliente de la causa, texto original del aviso, fecha actual como referencia y "Ver causa" (HU-19, HU-20).
describe("Revisión de movimientos en la bandeja", () => {
  let fixture: ComponentFixture<Ingestion>;
  let http: HttpTestingController;
  const withDate = { id: "case-1", reference: "LC-1", title: "Divorcio", status: "Activa", nextDate: "2026-09-18", nextDateLabel: "Audiencia de conciliación" } as LegalCase;
  const withoutDate = { id: "case-2", reference: "LC-2", title: "Cobro", status: "Activa", nextDate: null, nextDateLabel: null } as LegalCase;
  const item = (overrides: Partial<IngestionItem> = {}): IngestionItem => ({
    id: "mov-1", caseId: "case-1", caseReference: "LC-1", clientName: "Pedro Vidal Ortega", sourceType: "EMAIL", sourceName: "Correo PJUD",
    sourceText: "Se cita a audiencia de conciliación para el 25 de septiembre de 2026.", sourceTruncated: false,
    detectedReference: "LC-1", detectedDate: "2026-09-25", detectedTime: "10:15", detectedCourt: "3° Juzgado de Familia de Santiago",
    movementType: "AUDIENCIA", suggestedSummary: "Audiencia reprogramada al 25-09-2026.", correctedSummary: null, status: "PENDING",
    suggestionSource: "REGLAS", confidence: "ALTA", formatRecognized: true, missingFields: [], edited: false,
    createdAt: "2026-11-18T12:00:00.000Z", reviewedAt: null, ...overrides,
  });
  function open(items: IngestionItem[]) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    fixture = TestBed.createComponent(Ingestion);
    http = TestBed.inject(HttpTestingController);
    http.expectOne("/api/cases").flush([withDate, withoutDate]);
    http.expectOne("/api/ingestion").flush(items);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  afterEach(() => http.verify());

  describe("caso feliz", () => {
    it("muestra el cliente de la causa, el texto original abierto y la fecha actual como referencia", () => {
      const view = open([item()]);
      expect(view.textContent).toContain("Causa LC-1 · Pedro Vidal Ortega");
      const source = view.querySelector("details.source-text") as HTMLDetailsElement;
      expect(source.open).toBe(true);
      expect(source.textContent).toContain("25 de septiembre de 2026");
      expect(view.textContent).toContain("Fecha actual de la causa (referencia): 18/09/2026 · Audiencia de conciliación");
      expect(view.textContent).toContain("Audiencia");
      expect(view.textContent).toContain("Correo ·");
    });
    it("al confirmar ofrece el enlace para ver la causa", () => {
      const view = open([item()]);
      fixture.componentInstance.review(fixture.componentInstance.items()[0], "CONFIRMED");
      http.expectOne("/api/ingestion/mov-1/review").flush({ id: "mov-1", status: "CONFIRMED" });
      http.expectOne("/api/ingestion").flush([item({ status: "CONFIRMED" })]);
      fixture.detectChanges();
      expect(view.textContent).toContain("se agregó a la línea de tiempo de la causa LC-1");
      expect((view.querySelector(".success a") as HTMLAnchorElement).getAttribute("href")).toBe("/causas/case-1");
    });
  });

  describe("caso triste", () => {
    it("al rechazar no ofrece 'Ver causa' y sin causa asociada no hay fecha de referencia", () => {
      const view = open([item({ caseId: null, caseReference: null, clientName: null })]);
      expect(view.textContent).not.toContain("Fecha actual de la causa");
      fixture.componentInstance.review(fixture.componentInstance.items()[0], "REJECTED");
      http.expectOne("/api/ingestion/mov-1/review").flush({ id: "mov-1", status: "REJECTED" });
      http.expectOne("/api/ingestion").flush([]);
      fixture.detectChanges();
      expect(view.querySelector(".success a")).toBeNull();
      expect(fixture.componentInstance.confirmedCaseId()).toBeNull();
    });
    it("una causa sin próxima fecha no muestra referencia", () => {
      expect(open([item({ caseId: "case-2", caseReference: "LC-2" })]).textContent).not.toContain("Fecha actual de la causa");
    });
  });

  describe("caso borde", () => {
    it("un texto recortado lo avisa y un movimiento ya revisado muestra el texto cerrado", () => {
      const view = open([item({ sourceTruncated: true }), item({ id: "mov-2", status: "CONFIRMED" })]);
      const [pending, done] = Array.from(view.querySelectorAll("details.source-text")) as HTMLDetailsElement[];
      expect(pending.textContent).toContain("Se muestran los primeros 5.000 caracteres.");
      expect(done.open).toBe(false);
    });
    it("los tipos se muestran con nombre legible y un tipo desconocido se conserva", () => {
      const component = open([]) && fixture.componentInstance;
      expect(component.movementTypes.map((t) => component.movementLabel(t))).toEqual(["Audiencia", "Resolución", "Sentencia", "Notificación", "Otro movimiento"]);
      expect(component.movementLabel("EMBARGO")).toBe("EMBARGO");
    });
  });
});
