import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { IngestionItem, LegalCase } from "../../core/models";
import { Ingestion } from "./ingestion";

// P1 y P7 · Bandeja: asociar causa, corregir la sugerencia y avisar formatos no reconocidos (CU-02).
describe("Bandeja de movimientos", () => {
  let component: Ingestion;
  let http: HttpTestingController;
  const activeCase = { id: "case-1", reference: "LC-1", title: "Pensión de alimentos", status: "Activa" } as LegalCase;
  const archivedCase = { id: "case-2", reference: "LC-2", title: "Causa cerrada", status: "Archivada" } as LegalCase;
  const item = (overrides: Partial<IngestionItem> = {}): IngestionItem => ({
    id: "mov-1", caseId: null, caseReference: null, sourceType: "EMAIL", sourceName: "Correo PJUD",
    detectedReference: "C-1-2026", detectedDate: "2026-12-25", detectedTime: "10:30",
    detectedCourt: "3° Juzgado de Familia de Santiago", movementType: "AUDIENCIA",
    suggestedSummary: "Se cita a audiencia preparatoria.", correctedSummary: null, status: "PENDING",
    suggestionSource: "REGLAS", confidence: "MEDIA", formatRecognized: true, missingFields: [], edited: false,
    createdAt: "2026-11-18T12:00:00.000Z", reviewedAt: null, ...overrides,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    component = TestBed.runInInjectionContext(() => new Ingestion());
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function flush(items: IngestionItem[]) {
    http.expectOne("/api/ingestion").flush(items);
    http.expectOne("/api/cases").flush([activeCase, archivedCase]);
  }

  describe("caso feliz", () => {
    it("prepara el borrador con lo detectado y la causa asociada", () => {
      flush([item({ caseId: "case-1", caseReference: "LC-1" })]);
      expect(component.drafts["mov-1"]).toEqual({
        caseId: "case-1", movementType: "AUDIENCIA", date: "2026-12-25", time: "10:30",
        court: "3° Juzgado de Familia de Santiago", summary: "Se cita a audiencia preparatoria.",
      });
    });
    it("envía la causa y los datos corregidos al confirmar", () => {
      flush([item()]);
      const draft = component.drafts["mov-1"];
      draft.caseId = "case-1";
      draft.time = "11:00";
      draft.court = "  2° Juzgado de Familia de Santiago ";
      component.review(component.items()[0], "CONFIRMED");
      const request = http.expectOne("/api/ingestion/mov-1/review");
      expect(request.request.method).toBe("PATCH");
      expect(request.request.body).toEqual({
        status: "CONFIRMED", caseId: "case-1", movementType: "AUDIENCIA", detectedDate: "2026-12-25",
        detectedTime: "11:00", court: "2° Juzgado de Familia de Santiago", summary: "Se cita a audiencia preparatoria.",
      });
      request.flush({ id: "mov-1", status: "CONFIRMED" });
      http.expectOne("/api/ingestion").flush([item({ status: "CONFIRMED", caseId: "case-1" })]);
      expect(component.message()).toContain("publicado");
      expect(component.drafts["mov-1"]).toBeUndefined();
    });
    it("informa cuántos movimientos generó una planilla", () => {
      flush([]);
      component.file = new File(["x"], "movimientos.xlsx");
      component.ingestFile();
      http.expectOne("/api/ingestion/file").flush({ count: 3, items: [] });
      http.expectOne("/api/ingestion").flush([]);
      expect(component.message()).toContain("3 movimientos");
    });
  });

  describe("caso triste", () => {
    it("no confirma un movimiento sin causa asociada", () => {
      flush([item()]);
      component.review(component.items()[0], "CONFIRMED");
      http.expectNone((request) => request.url.includes("/review"));
      expect(component.error()).toContain("Asocia una causa");
    });
    it("muestra el error del servidor, libera el botón y conserva el borrador", () => {
      flush([item({ caseId: "case-1" })]);
      component.drafts["mov-1"].court = "Corte de Apelaciones de Santiago";
      component.review(component.items()[0], "CONFIRMED");
      http.expectOne("/api/ingestion/mov-1/review").flush({ message: "La causa archivada es de solo lectura." }, { status: 400, statusText: "Bad Request" });
      expect(component.error()).toContain("solo lectura");
      expect(component.reviewing()).toBeNull();
      expect(component.drafts["mov-1"].court).toBe("Corte de Apelaciones de Santiago");
    });
    it("ignora un segundo clic mientras se revisa", () => {
      flush([item({ caseId: "case-1" }), item({ id: "mov-2", caseId: "case-1" })]);
      component.review(component.items()[0], "CONFIRMED");
      component.review(component.items()[1], "CONFIRMED");
      http.expectOne("/api/ingestion/mov-1/review").flush({});
      http.expectNone("/api/ingestion/mov-2/review");
      http.expectOne("/api/ingestion").flush([]);
    });
  });

  describe("caso borde", () => {
    it("ofrece solo causas activas y cuenta solo los formatos no reconocidos pendientes", () => {
      flush([item(), item({ id: "mov-2", formatRecognized: false }), item({ id: "mov-3", formatRecognized: false, status: "REJECTED" })]);
      expect(component.cases().map((c) => c.id)).toEqual(["case-1"]);
      expect(component.unrecognized()).toBe(1);
    });
    it("rechazar no exige causa y los campos vacíos se envían como nulos", () => {
      flush([item({ detectedTime: null })]);
      const draft = component.drafts["mov-1"];
      draft.court = "   ";
      draft.date = "";
      draft.summary = "corto";
      component.review(component.items()[0], "REJECTED");
      const request = http.expectOne("/api/ingestion/mov-1/review");
      expect(request.request.body).toEqual({
        status: "REJECTED", caseId: undefined, movementType: "AUDIENCIA", detectedDate: null, detectedTime: null, court: null, summary: undefined,
      });
      request.flush({});
      http.expectOne("/api/ingestion").flush([]);
    });
    it("conserva las correcciones de otros movimientos al recargar la bandeja", () => {
      flush([item(), item({ id: "mov-2" })]);
      component.drafts["mov-2"].court = "Corte de Apelaciones de Santiago";
      component.load();
      http.expectOne("/api/ingestion").flush([item(), item({ id: "mov-2" })]);
      expect(component.drafts["mov-2"].court).toBe("Corte de Apelaciones de Santiago");
    });
  });
});
