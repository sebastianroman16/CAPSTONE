import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { CaseWorkspace } from "./case-workspace";

// P3 · Registro de plazos con urgencia y anticipación del recordatorio (HU-12, E17).
describe("Registro de fecha clave y recordatorio", () => {
  let fixture: ComponentFixture<CaseWorkspace>;
  let component: CaseWorkspace;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    fixture = TestBed.createComponent(CaseWorkspace);
    fixture.componentRef.setInput("caseId", "case-1");
    fixture.componentRef.setInput("clientId", "client-1");
    fixture.componentRef.setInput("isLawyer", true);
    fixture.detectChanges();
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    http.expectOne("/api/cases/case-1/deadlines").flush([]);
    http.expectOne("/api/cases/case-1/timeline").flush([]);
    http.expectOne("/api/cases/case-1/communications").flush([]);
    http.expectOne("/api/cases/case-1/documents").flush([]);
    http.expectOne("/api/document-requests").flush([]);
  });
  // Al agregar un plazo se recarga la lista de próximas fechas de la causa.
  afterEach(() => {
    http.match("/api/cases/case-1/deadlines").forEach((request) => request.flush([]));
    http.verify();
  });

  function fill(at = "2026-12-20T10:00", offset = 86400000) {
    component.deadlineTitle = "Audiencia preparatoria";
    component.deadlineAt = at;
    component.deadlineType = "HEARING";
    component.deadlineUrgency = "Alta";
    component.reminderOffset = offset;
  }

  describe("caso feliz", () => {
    it("calcula el recordatorio con la anticipación elegida y envía tipo y urgencia", () => {
      fill();
      component.addDeadline();
      const request = http.expectOne("/api/cases/case-1/deadlines");
      const due = new Date("2026-12-20T10:00");
      expect(request.request.body).toEqual({
        deadlineType: "HEARING", title: "Audiencia preparatoria", dueAt: due.toISOString(),
        reminderAt: new Date(due.getTime() - 86400000).toISOString(), urgency: "Alta",
      });
      request.flush({ id: "d-1" });
      expect(component.deadlineNotice()).toContain("Te avisaremos");
      expect(component.deadlineTitle).toBe("");
    });
    it("por defecto avisa un día antes con urgencia media", () => {
      expect(component.reminderOffset).toBe(86400000);
      expect(component.deadlineUrgency).toBe("Media");
    });
  });

  describe("caso triste", () => {
    it("no envía nada sin título o con una fecha inválida", () => {
      fill();
      component.deadlineTitle = "   ";
      component.addDeadline();
      fill("no-es-fecha");
      component.addDeadline();
      http.expectNone("/api/cases/case-1/deadlines");
    });
    it("muestra el error del servidor y conserva lo escrito", () => {
      fill();
      component.addDeadline();
      http.expectOne("/api/cases/case-1/deadlines").flush({ message: "El recordatorio no puede ser posterior al plazo." }, { status: 400, statusText: "Bad Request" });
      expect(component.error()).toContain("posterior al plazo");
      expect(component.deadlineTitle).toBe("Audiencia preparatoria");
      expect(component.deadlineNotice()).toBe("");
    });
  });

  describe("caso borde", () => {
    it("'Sin recordatorio' no envía fecha de aviso (antes se enviaba la misma hora del plazo)", () => {
      fill("2026-12-20T10:00", 0);
      component.addDeadline();
      const request = http.expectOne("/api/cases/case-1/deadlines");
      expect(request.request.body.reminderAt).toBeUndefined();
      request.flush({ id: "d-2" });
      expect(component.deadlineNotice()).toBe("Pendiente agregado a la agenda.");
    });
    it("un aviso de una hora antes cruza correctamente la medianoche", () => {
      fill("2027-01-01T00:30", 3600000);
      component.addDeadline();
      const request = http.expectOne("/api/cases/case-1/deadlines");
      expect(new Date(request.request.body.reminderAt).getTime()).toBe(new Date("2027-01-01T00:30").getTime() - 3600000);
      request.flush({ id: "d-3" });
    });
  });
});

// HU-17: el abogado elige categoría y visibilidad de cada documento; el cliente no puede elegir visibilidad interna.
describe("Carga de documentos con categoría y visibilidad (HU-17)", () => {
  let fixture: ComponentFixture<CaseWorkspace>;
  let component: CaseWorkspace;
  let http: HttpTestingController;

  function mount(isLawyer: boolean) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    fixture = TestBed.createComponent(CaseWorkspace);
    fixture.componentRef.setInput("caseId", "case-1");
    fixture.componentRef.setInput("clientId", "client-1");
    fixture.componentRef.setInput("isLawyer", isLawyer);
    fixture.detectChanges();
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    if (isLawyer) http.expectOne("/api/cases/case-1/deadlines").flush([]);
    http.expectOne("/api/cases/case-1/timeline").flush([]);
    http.expectOne("/api/cases/case-1/communications").flush([]);
    http.expectOne("/api/cases/case-1/documents").flush([]);
    http.expectOne("/api/document-requests").flush([]);
  }
  afterEach(() => http.verify());

  const file = () => new File(["%PDF-1.4 contenido"], "escrito.pdf", { type: "application/pdf" });

  it("caso feliz: el abogado envía la categoría y la visibilidad que eligió", () => {
    mount(true);
    component.file = file();
    component.title = "Demanda";
    component.documentCategory = "PLEADING";
    component.documentVisibility = "CLIENT";
    component.upload();
    const request = http.expectOne((r) => r.url === "/api/cases/case-1/documents");
    expect(request.request.body.get("category")).toBe("PLEADING");
    expect(request.request.body.get("visibility")).toBe("CLIENT");
    request.flush({ id: "d1" });
    http.match((r) => r.url.startsWith("/api/cases/case-1/")).forEach((r) => r.flush([]));
    http.match("/api/document-requests").forEach((r) => r.flush([]));
  });

  it("caso triste: por defecto el documento queda solo para el equipo jurídico", () => {
    mount(true);
    expect(component.documentVisibility).toBe("INTERNAL");
    expect(component.documentCategory).toBe("OTHER");
    component.file = file();
    component.upload();
    const request = http.expectOne((r) => r.url === "/api/cases/case-1/documents");
    expect(request.request.body.get("visibility")).toBe("INTERNAL");
    request.flush({ id: "d2" });
    http.match((r) => r.url.startsWith("/api/cases/case-1/")).forEach((r) => r.flush([]));
    http.match("/api/document-requests").forEach((r) => r.flush([]));
  });

  it("caso borde: el cliente no envía categoría ni visibilidad elegidas y siempre sube como CLIENT", () => {
    mount(false);
    component.documentVisibility = "INTERNAL";
    component.documentCategory = "EVIDENCE";
    component.file = file();
    component.upload();
    const request = http.expectOne((r) => r.url === "/api/cases/case-1/documents");
    expect(request.request.body.get("visibility")).toBe("CLIENT");
    expect(request.request.body.get("category")).toBe("OTHER");
    request.flush({ id: "d3" });
    http.match((r) => r.url.startsWith("/api/cases/case-1/")).forEach((r) => r.flush([]));
    http.match("/api/document-requests").forEach((r) => r.flush([]));
  });
});
