import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ActivatedRoute, Router, provideRouter } from "@angular/router";
import { CaseForm } from "./case-form";
import { LegalCase } from "../../core/models";
import { UnsavedChangesService } from "../../core/unsaved-changes.service";

describe("Edición segura de causas", () => {
  let editor: CaseForm, http: HttpTestingController;
  const original: LegalCase = {
    id: "case-1",
    reference: "LC-1",
    rit: null,
    title: "Causa original",
    clientId: "client-1",
    clientName: "Cliente",
    matter: "Civil",
    court: "Tribunal de prueba",
    priority: "Media",
    status: "Activa",
    nextDate: null,
    nextDateLabel: null,
    internalNotes: null,
    createdAt: "2026-10-10",
    updatedAt: "2026-10-10",
    version: 1,
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
    editor = TestBed.runInInjectionContext(() => new CaseForm());
    http
      .expectOne("/api/users/clients")
      .flush([
        { id: "client-1", name: "Cliente", email: "cliente@example.test" },
      ]);
    http.expectOne("/api/cases/case-1").flush(original);
  });
  afterEach(() => {
    editor.ngOnDestroy();
    http.verify();
    vi.restoreAllMocks();
  });
  function draft() {
    editor.form.controls.title.setValue("Mi borrador");
    editor.form.markAsDirty();
  }
  function conflict() {
    draft();
    editor.submit();
    const save = http.expectOne({ url: "/api/cases/case-1", method: "PUT" });
    expect(save.request.body.version).toBe(1);
    expect(editor.form.disabled).toBe(true);
    save.flush(
      { code: "CASE_VERSION_CONFLICT" },
      { status: 409, statusText: "Conflict" },
    );
  }
  it("conserva los cambios y bloquea reintentos automáticos ante un conflicto", () => {
    conflict();
    http
      .expectOne({ url: "/api/cases/case-1", method: "GET" })
      .flush({ ...original, title: "Otra pestaña", version: 2 });
    expect(editor.form.controls.title.value).toBe("Mi borrador");
    expect(editor.hasUnsavedChanges()).toBe(true);
    expect(editor.conflict()).toBe(true);
    expect(editor.form.enabled).toBe(true);
    expect(editor.differences()).toContainEqual({
      label: "Carátula",
      local: "Mi borrador",
      saved: "Otra pestaña",
    });
    editor.submit();
    http.expectNone({ url: "/api/cases/case-1", method: "PUT" });
  });
  it("solo reemplaza el borrador tras confirmación y luego usa la versión revisada", () => {
    conflict();
    http
      .expectOne({ url: "/api/cases/case-1", method: "GET" })
      .flush({ ...original, title: "Guardado por otra pestaña", version: 2 });
    editor.useLatest();
    expect(editor.form.controls.title.value).toBe("Mi borrador");
    editor.discardConfirm.set(true);
    editor.useLatest();
    expect(editor.form.controls.title.value).toBe("Guardado por otra pestaña");
    expect(editor.version()).toBe(2);
    expect(editor.hasUnsavedChanges()).toBe(false);
    draft();
    const navigate = vi
      .spyOn(TestBed.inject(Router), "navigate")
      .mockResolvedValue(true);
    editor.submit();
    const save = http.expectOne({ url: "/api/cases/case-1", method: "PUT" });
    expect(save.request.body.version).toBe(2);
    save.flush({ ...original, title: "Mi borrador", version: 3 });
    expect(editor.hasUnsavedChanges()).toBe(false);
    expect(navigate).toHaveBeenCalled();
  });
  it("conserva el borrador si falla la comparación y permite volver a consultarla", () => {
    conflict();
    http
      .expectOne({ url: "/api/cases/case-1", method: "GET" })
      .flush({}, { status: 503, statusText: "Unavailable" });
    expect(editor.form.controls.title.value).toBe("Mi borrador");
    expect(editor.reviewError()).toBeTruthy();
    editor.reviewLatest();
    http.expectOne("/api/cases/case-1").flush({ ...original, version: 2 });
    expect(editor.reviewError()).toBe("");
  });
  it("no pierde cambios ni deja el formulario bloqueado al fallar el guardado", () => {
    draft();
    editor.submit();
    http
      .expectOne({ url: "/api/cases/case-1", method: "PUT" })
      .flush({}, { status: 503, statusText: "Unavailable" });
    expect(editor.form.controls.title.value).toBe("Mi borrador");
    expect(editor.hasUnsavedChanges()).toBe(true);
    expect(editor.busy()).toBe(false);
    expect(editor.form.enabled).toBe(true);
  });
  it("permite cancelar la salida con cambios y evita avisos en formularios intactos", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const unsaved = TestBed.inject(UnsavedChangesService);
    expect(unsaved.confirmLeave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    draft();
    expect(unsaved.confirmLeave()).toBe(false);
    expect(editor.hasUnsavedChanges()).toBe(true);
    confirm.mockReturnValue(true);
    expect(unsaved.confirmLeave()).toBe(true);
    unsaved.discardAfterLogout();
    expect(editor.hasUnsavedChanges()).toBe(false);
  });
  it("solicita protección del navegador al cerrar o recargar con cambios", () => {
    const clean = new Event("beforeunload", { cancelable: true });
    editor.beforeUnload(clean as BeforeUnloadEvent);
    expect(clean.defaultPrevented).toBe(false);
    draft();
    const dirty = new Event("beforeunload", { cancelable: true });
    editor.beforeUnload(dirty as BeforeUnloadEvent);
    expect(dirty.defaultPrevented).toBe(true);
  });
});
