import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ActivatedRoute, provideRouter } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { LegalCase } from "../../core/models";
import { UnsavedChangesService } from "../../core/unsaved-changes.service";
import { CaseDetail } from "./case-detail";
import { CaseForm } from "./case-form";

const base: LegalCase = {
  id: "case-1", reference: "LC-1", rit: null, title: "Causa archivada", clientId: "client-1", clientName: "Cliente",
  matter: "Civil", court: "Juzgado Civil", priority: "Media", status: "Archivada", nextDate: null, nextDateLabel: null,
  internalNotes: null, createdAt: "2026-10-10", updatedAt: "2026-10-10", version: 3,
};
const lawyer = { id: "abogada-1", name: "Abogada", email: "a@example.test", role: "LAWYER", phone: null, mustChangePassword: false };

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([["id", "case-1"]]) } } },
    ],
  });
  TestBed.inject(AuthService).user.set(lawyer as never);
  return TestBed.inject(HttpTestingController);
}

// E12 y E22 · En el detalle, una causa archivada no muestra "Editar" y ofrece "Reactivar causa".
describe("Detalle de una causa archivada", () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<CaseDetail>;
  beforeEach(() => {
    http = setup();
    fixture = TestBed.createComponent(CaseDetail);
    http.expectOne("/api/cases/case-1").flush(base);
    http.expectOne("/api/cases/case-1/progress").flush([]);
    fixture.detectChanges();
    http.match(() => true).forEach((request) => request.flush([])); // espacio de trabajo de la causa
  });
  afterEach(() => http.verify());
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? "";

  it("caso feliz: reactiva con confirmación y vuelve a mostrar 'Editar causa'", () => {
    expect(text()).not.toContain("Editar causa");
    expect(text()).toContain("Reactivar causa");
    fixture.componentInstance.confirmReactivate.set(true);
    fixture.componentInstance.reactivate();
    const request = http.expectOne("/api/cases/case-1/reactivate");
    expect(request.request.method).toBe("PATCH");
    expect(request.request.body).toEqual({ version: 3 });
    request.flush({ ...base, status: "Activa", version: 4 });
    fixture.detectChanges();
    http.match(() => true).forEach((pending) => pending.flush([]));
    expect(text()).toContain("Editar causa");
    expect(text()).toContain("Archivar causa");
  });
  it("caso triste: si otra sesión la cambió, marca conflicto y no la da por reactivada", () => {
    fixture.componentInstance.reactivate();
    http.expectOne("/api/cases/case-1/reactivate").flush({ message: "Esta causa cambió desde que la abriste." }, { status: 409, statusText: "Conflict" });
    expect(fixture.componentInstance.conflict()).toBe(true);
    expect(fixture.componentInstance.item()?.status).toBe("Archivada");
    expect(fixture.componentInstance.error()).toContain("cambió");
  });
  it("caso borde: ignora un segundo clic mientras la primera reactivación está en curso", () => {
    fixture.componentInstance.reactivate();
    fixture.componentInstance.reactivate();
    http.expectOne("/api/cases/case-1/reactivate").flush({ ...base, status: "Activa", version: 4 });
  });
});

// E12 y E15 · El formulario de edición no se muestra para una causa archivada y recupera borradores.
describe("Formulario de causa", () => {
  let http: HttpTestingController;
  let form: CaseForm;
  function open(item: LegalCase) {
    form = TestBed.runInInjectionContext(() => new CaseForm());
    http.expectOne("/api/users/clients").flush([{ id: "client-1", name: "Cliente", email: "c@example.test" }]);
    http.expectOne("/api/cases/case-1").flush(item);
  }
  beforeEach(() => { sessionStorage.clear(); http = setup(); });
  afterEach(() => { form.ngOnDestroy(); http.verify(); sessionStorage.clear(); });

  it("caso feliz: recupera el borrador guardado al expirar y lo marca como cambio pendiente", () => {
    sessionStorage.setItem("lex-draft:abogada-1:causa:case-1", JSON.stringify({ savedAt: Date.now(), value: { clientMode: "existing", values: { title: "Título a medio escribir" } } }));
    open({ ...base, status: "Activa" });
    expect(form.draftRestored()).toBe(true);
    expect(form.form.controls.title.value).toBe("Título a medio escribir");
    expect(form.hasUnsavedChanges()).toBe(true);
    expect(form.version()).toBe(3, );
  });
  it("caso triste: una causa archivada no muestra el formulario editable", () => {
    open(base);
    expect(form.archived()).toBe(true);
  });
  it("caso borde: descartar el borrador vuelve a los datos guardados", () => {
    sessionStorage.setItem("lex-draft:abogada-1:causa:case-1", JSON.stringify({ savedAt: Date.now(), value: { clientMode: "existing", values: { title: "Borrador" } } }));
    open({ ...base, status: "Activa" });
    form.discardRestoredDraft();
    expect(form.form.controls.title.value).toBe("Causa archivada");
    expect(form.hasUnsavedChanges()).toBe(false);
    expect(TestBed.inject(UnsavedChangesService).takeDraft("causa:case-1")).toBeNull();
  });
});
