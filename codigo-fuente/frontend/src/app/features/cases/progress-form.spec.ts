import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ActivatedRoute, provideRouter, Router } from "@angular/router";
import { UnsavedChangesService } from "../../core/unsaved-changes.service";
import { ProgressForm } from "./progress-form";
describe("Registro seguro de avances", () => {
  let form: ProgressForm, http: HttpTestingController;
  const original = {
    id: "case-1",
    title: "Causa ficticia",
    status: "Activa",
    version: 5,
    progressStage: "ASSESSMENT",
    progressSummary: "Evaluación inicial de antecedentes",
    nextAction: "Preparar documentación",
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([["id", "case-1"]]) } },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    form = TestBed.runInInjectionContext(() => new ProgressForm());
    http.expectOne("/api/cases/case-1").flush(original);
  });
  afterEach(() => {
    form.ngOnDestroy();
    http.verify();
    vi.restoreAllMocks();
  });
  function draft() {
    form.form.patchValue({
      stage: "PREPARATION",
      summary: "Nuevo avance preparado para revisión.",
    });
    form.form.markAsDirty();
  }
  it("envía la versión leída y sale sin aviso después de guardar", () => {
    const navigate = vi
      .spyOn(TestBed.inject(Router), "navigate")
      .mockResolvedValue(true);
    draft();
    form.submit();
    const req = http.expectOne({
      url: "/api/cases/case-1/progress",
      method: "PATCH",
    });
    expect(req.request.body.version).toBe(5);
    expect(req.request.body.stage).toBe("PREPARATION");
    expect(form.form.disabled).toBe(true);
    req.flush({ saved: true });
    expect(form.hasUnsavedChanges()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(["/causas", "case-1"]);
  });
  it("conserva el borrador ante un conflicto y exige confirmar para cargar la versión actual", () => {
    draft();
    form.submit();
    http
      .expectOne("/api/cases/case-1/progress")
      .flush(
        { code: "CASE_VERSION_CONFLICT" },
        { status: 409, statusText: "Conflict" },
      );
    http
      .expectOne("/api/cases/case-1")
      .flush({
        ...original,
        version: 6,
        progressSummary: "Avance que guardó otra sesión",
      });
    expect(form.form.controls.summary.value).toBe(
      "Nuevo avance preparado para revisión.",
    );
    expect(form.conflict()).toBe(true);
    form.submit();
    http.expectNone("/api/cases/case-1/progress");
    form.useLatest();
    expect(form.item()?.version).toBe(5);
    form.discardConfirm.set(true);
    form.useLatest();
    expect(form.item()?.version).toBe(6);
    expect(form.form.controls.summary.value).toBe(
      "Avance que guardó otra sesión",
    );
    expect(form.hasUnsavedChanges()).toBe(false);
  });
  it("conserva el avance si la API falla y permite cancelar la navegación", () => {
    draft();
    form.submit();
    http
      .expectOne("/api/cases/case-1/progress")
      .flush({}, { status: 503, statusText: "Unavailable" });
    expect(form.form.enabled).toBe(true);
    expect(form.hasUnsavedChanges()).toBe(true);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(TestBed.inject(UnsavedChangesService).confirmLeave()).toBe(false);
  });
  it("no permite enviar texto vacío ni nuevos avances de una causa archivada", () => {
    form.form.controls.summary.setValue("           ");
    form.submit();
    http.expectNone("/api/cases/case-1/progress");
    form.form.markAsPristine();
    form.load();
    http
      .expectOne("/api/cases/case-1")
      .flush({ ...original, status: "Archivada" });
    draft();
    form.submit();
    http.expectNone("/api/cases/case-1/progress");
  });
});
