import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { CaseDocument, Communication, Deadline, DocumentRequest } from "../../core/models";
import { CaseWorkspace } from "./case-workspace";

// Detalle de la causa: documentos con fecha (HU-18), solicitudes y canales legibles (HU-16, HU-22) y próximas fechas (mockup 07).
describe("Detalle de la causa: documentos, solicitudes y próximas fechas", () => {
  let http: HttpTestingController;
  const doc: CaseDocument = { id: "d-1", title: "Demanda", description: null, category: "PLEADING", visibility: "CLIENT", versionId: "v-1", version: 1,
    originalName: "demanda.pdf", mimeType: "application/pdf", sizeBytes: 780 * 1024, uploadedBy: "María Ibáñez", createdAt: "2026-08-20T15:00:00.000Z" };
  const req = (overrides: Partial<DocumentRequest>): DocumentRequest => ({ id: "r-1", caseId: "case-1", reference: "LC-1", title: "Comprobantes de renta",
    description: null, dueAt: "2026-09-15T12:00:00.000Z", status: "PENDING", createdAt: "2026-09-05T12:00:00.000Z", ...overrides });
  const deadline = (overrides: Partial<Deadline>): Deadline => ({ id: "p-1", caseId: "case-1", reference: "LC-1", caseTitle: "Causa", deadlineType: "HEARING",
    title: "Audiencia de conciliación", description: null, dueAt: new Date(Date.now() + 8 * 86400000).toISOString(), reminderAt: null, urgency: "Alta", status: "PENDING", ...overrides });
  const message: Communication = { id: "m-1", message: "Se notificó la demanda.", channel: "EMAIL", category: "STATUS_UPDATE", deliveryStatus: "FAILED", deliveryError: "El cliente no tiene correo registrado.", readAt: null,
    createdAt: "2026-09-02T12:00:00.000Z", authorName: "María Ibáñez" };

  function open(isLawyer: boolean, data: { deadlines?: Deadline[]; documents?: CaseDocument[]; requests?: DocumentRequest[]; communications?: Communication[] } = {}, tab: "summary" | "communication" | "documents" = "summary") {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    const fixture = TestBed.createComponent(CaseWorkspace);
    fixture.componentRef.setInput("caseId", "case-1");
    fixture.componentRef.setInput("clientId", "client-1");
    fixture.componentRef.setInput("isLawyer", isLawyer);
    fixture.detectChanges();
    http = TestBed.inject(HttpTestingController);
    if (isLawyer) http.expectOne("/api/cases/case-1/deadlines").flush(data.deadlines ?? []);
    http.expectOne("/api/cases/case-1/timeline").flush([]);
    http.expectOne("/api/cases/case-1/communications").flush(data.communications ?? []);
    http.expectOne("/api/cases/case-1/documents").flush(data.documents ?? []);
    http.expectOne("/api/document-requests").flush(data.requests ?? []);
    fixture.componentInstance.activeTab.set(tab);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? "";
  }
  afterEach(() => http.verify());

  describe("caso feliz", () => {
    it("cada documento muestra quién lo subió, cuándo y su tamaño", () => {
      const text = open(true, { documents: [doc] }, "documents");
      expect(text).toContain("Subido por María Ibáñez · 20/08/2026");
      expect(text).toContain("780 KB");
    });
    it("las solicitudes muestran su estado en palabras y las fechas de solicitud y vencimiento", () => {
      const text = open(false, { requests: [req({}), req({ id: "r-2", title: "Certificado de matrimonio", status: "FULFILLED", dueAt: null })] }, "documents");
      expect(text).toContain("Pendiente");
      expect(text).toContain("Recibido");
      expect(text).toContain("Solicitado el 05/09/2026 · vence el 15/09/2026");
      expect(text).not.toContain("PENDING");
      expect(text).not.toContain("FULFILLED");
    });
    it("el abogado ve las próximas fechas de la causa con su tipo y urgencia", () => {
      const text = open(true, { deadlines: [deadline({})] }, "summary");
      expect(text).toContain("Próximas fechas");
      expect(text).toContain("Audiencia de conciliación");
      expect(text).toContain("Urgencia alta");
    });
  });

  describe("caso triste", () => {
    it("el cliente no pide ni ve los plazos internos", () => {
      expect(open(false, {}, "summary")).not.toContain("Próximas fechas");
    });
    it("un envío fallido se informa en palabras, sin códigos internos", () => {
      const text = open(true, { communications: [message] }, "communication");
      expect(text).toContain("Correo · No entregado");
      expect(text).not.toContain("FAILED");
    });
  });

  describe("caso borde", () => {
    it("un plazo vencido sin realizar se marca y una causa sin plazos lo indica", () => {
      expect(open(true, { deadlines: [deadline({ dueAt: new Date(Date.now() - 3600000).toISOString() })] }, "summary")).toContain("Vencido");
      TestBed.resetTestingModule();
      expect(open(true, {}, "summary")).toContain("Sin fechas pendientes en esta causa.");
    });
    it("una solicitud sin fecha límite muestra solo la fecha de solicitud", () => {
      const text = open(false, { requests: [req({ dueAt: null })] }, "documents");
      expect(text).toContain("Solicitado el 05/09/2026");
      expect(text).not.toContain("vence el");
    });
  });
});
