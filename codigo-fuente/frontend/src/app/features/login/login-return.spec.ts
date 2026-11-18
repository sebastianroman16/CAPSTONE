import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { UnsavedChangesService } from "../../core/unsaved-changes.service";
import { Shell } from "../../layout/shell";
import { Login } from "./login";

// E15 · Tras expirar con un borrador guardado, se vuelve al mismo formulario al ingresar.
describe("Volver al formulario después de iniciar sesión", () => {
  let http: HttpTestingController;
  const lawyer = { id: "abogada-1", name: "Abogada", email: "a@example.test", role: "LAWYER", phone: null, mustChangePassword: false };
  function login(volver: string | null, user: object = lawyer) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(volver === null ? {} : { volver }) } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true);
    const component = TestBed.runInInjectionContext(() => new Login());
    // Clave ficticia generada al ejecutar: la petición de login se intercepta y nunca llega a un servidor.
    component.form.setValue({ email: "a@example.test", password: crypto.randomUUID() });
    component.submit();
    http.expectOne("/api/auth/login").flush(user);
    return navigate;
  }
  afterEach(() => http.verify());

  it("caso feliz: vuelve a la ruta interna indicada", () => {
    expect(login("/causas/case-1/editar")).toHaveBeenCalledWith("/causas/case-1/editar");
  });
  it("caso triste: ignora destinos externos o mal formados (sin redirección abierta)", () => {
    for (const target of ["https://sitio-malicioso.test", "//sitio-malicioso.test", "/\\sitio-malicioso.test", "javascript:alert(1)"]) {
      TestBed.resetTestingModule();
      expect(login(target)).toHaveBeenCalledWith("/causas");
    }
  });
  it("caso borde: sin destino o con el propio login va al inicio, y el cambio de clave obligatorio tiene prioridad", () => {
    expect(login(null)).toHaveBeenCalledWith("/causas");
    TestBed.resetTestingModule();
    expect(login("/iniciar-sesion?volver=/causas")).toHaveBeenCalledWith("/causas");
    TestBed.resetTestingModule();
    expect(login("/causas/case-1/editar", { ...lawyer, mustChangePassword: true })).toHaveBeenCalledWith("/perfil");
  });
});

describe("Expiración por inactividad con un borrador", () => {
  let http: HttpTestingController;
  let shell: Shell;
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).user.set({ ...{ id: "abogada-1", name: "Abogada", email: "a@example.test", role: "LAWYER", phone: null, mustChangePassword: false } } as never);
    shell = TestBed.runInInjectionContext(() => new Shell());
  });
  afterEach(() => { shell.ngOnDestroy(); http.verify(); sessionStorage.clear(); vi.restoreAllMocks(); });

  it("caso feliz: guarda el borrador y envía al login con la ruta de regreso", () => {
    const navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    TestBed.inject(UnsavedChangesService).register({
      hasUnsavedChanges: () => true, discardPendingChanges: () => undefined,
      draftKey: () => "avance:case-1", draftValue: () => ({ summary: "Avance a medio escribir" }),
    });
    shell.expireSession();
    http.expectOne("/api/auth/logout").flush({});
    expect(navigate).toHaveBeenCalledWith(["/iniciar-sesion"], { queryParams: { volver: "/" } });
    expect(TestBed.inject(AuthService).user()).toBeNull();
    expect(Object.keys(sessionStorage).some((key) => key.startsWith("lex-draft:abogada-1:avance:case-1"))).toBe(true);
  });
  it("caso borde: sin cambios pendientes va al login sin ruta de regreso", () => {
    const navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    shell.expireSession();
    http.expectOne("/api/auth/logout").error(new ProgressEvent("error"));
    expect(navigate).toHaveBeenCalledWith(["/iniciar-sesion"], {});
  });
});
