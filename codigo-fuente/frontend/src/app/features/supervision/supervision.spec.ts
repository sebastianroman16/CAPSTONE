import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { provideRouter, Router } from "@angular/router";
import {
  AuthService,
  caseAccess,
  lawyerOnly,
  supervisorOnly,
} from "../../core/auth.service";
import { Supervision } from "./supervision";
import { RouterTestingHarness } from "@angular/router/testing";
import { routes } from "../../app.routes";

describe("Navegación real de supervisión", () => {
  it("abre el detalle desde el enlace del panel", async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
      ],
    });
    const auth = TestBed.inject(AuthService);
    auth.user.set({
      id: "1",
      name: "Coordinador",
      email: "coordinador@example.test",
      role: "SUPERVISOR",
    });
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create("/supervision");
    http
      .expectOne((r) => r.url === "/api/supervision")
      .flush({
        asOf: "2026-10-11",
        summary: {
          active: 1,
          total: 1,
          archived: 0,
          highPriority: 0,
          needsAttention: 1,
        },
        lawyers: [],
        items: [
          {
            id: "case-1",
            title: "Causa de prueba",
            priority: "Media",
            progressStage: "NOT_REPORTED",
            status: "Activa",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    harness.detectChanges();
    const link =
      harness.routeNativeElement!.querySelector<HTMLAnchorElement>(
        "a.case-title",
      )!;
    expect(link.getAttribute("href")).toBe("/supervision/causas/case-1");
    link.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe("/supervision/causas/case-1");
    http
      .expectOne("/api/supervision/cases/case-1")
      .flush({ id: "case-1", history: [] });
    http.verify();
  });
});

describe("Acceso exclusivo a coordinación", () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }),
  );
  it("rechaza rutas de supervisión para abogados y clientes", () => {
    for (const role of ["LAWYER", "CLIENT"] as const) {
      TestBed.inject(AuthService).user.set({
        id: "1",
        name: "Usuario",
        email: "test@example.test",
        role,
      });
      const result = TestBed.runInInjectionContext(() =>
        supervisorOnly({} as any, {} as any),
      );
      expect(TestBed.inject(Router).serializeUrl(result as any)).toBe(
        "/causas",
      );
    }
  });
  it("dirige al coordinador a supervisión y bloquea la edición normal", () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set({
      id: "1",
      name: "Coordinador",
      email: "test@example.test",
      role: "SUPERVISOR",
    });
    expect(auth.home()).toBe("/supervision");
    expect(
      TestBed.runInInjectionContext(() => supervisorOnly({} as any, {} as any)),
    ).toBe(true);
    for (const guard of [lawyerOnly, caseAccess]) {
      const result = TestBed.runInInjectionContext(() =>
        guard({} as any, {} as any),
      );
      expect(TestBed.inject(Router).serializeUrl(result as any)).toBe(
        "/supervision",
      );
    }
  });
  it("restaura el rol del coordinador desde la sesión", async () => {
    const auth = TestBed.inject(AuthService);
    const pending = auth.restore();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne("/api/auth/me").flush({
      id: "1",
      name: "Coordinador",
      email: "test@example.test",
      role: "SUPERVISOR",
    });
    expect(await pending).toBe(true);
    expect(auth.isSupervisor()).toBe(true);
    http.verify();
  });
});

describe("Panel de supervisión", () => {
  let component: Supervision, http: HttpTestingController;
  const data = {
    asOf: "2026-10-11T12:00:00Z",
    summary: {
      active: 5,
      total: 6,
      archived: 1,
      highPriority: 2,
      needsAttention: 3,
      completed: 1,
    },
    lawyers: [
      {
        id: "a",
        name: "Abogado A",
        accountActive: true,
        active: 5,
        total: 6,
        archived: 1,
        highPriority: 2,
        needsAttention: 3,
        completed: 1,
      },
    ],
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    staleAfterDays: 14,
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Supervision],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    component = TestBed.runInInjectionContext(() => new Supervision());
    http.expectOne("/api/supervision?status=Activa&page=1").flush(data);
  });
  afterEach(() => {
    component.ngOnDestroy();
    http.verify();
  });
  it("combina filtros en servidor y conserva el resumen general del equipo", () => {
    component.query = "  referencia  ";
    component.stage = "PREPARATION";
    component.attention = "needed";
    component.selectLawyer("a");
    const req = http.expectOne((r) => r.url === "/api/supervision");
    expect(req.request.params.get("q")).toBe("referencia");
    expect(req.request.params.get("lawyerId")).toBe("a");
    expect(req.request.params.get("stage")).toBe("PREPARATION");
    expect(req.request.params.get("attention")).toBe("needed");
    expect(req.request.params.get("page")).toBe("1");
    req.flush(data);
    expect(component.data()?.summary.active).toBe(5);
    component.go(2);
    const page = http.expectOne((r) => r.params.get("page") === "2");
    expect(page.request.params.get("lawyerId")).toBe("a");
    page.flush({ ...data, page: 2 });
    component.reset();
    http.expectOne("/api/supervision?status=Activa&page=1").flush(data);
  });
  it("cancela peticiones anteriores para no mostrar filtros obsoletos", () => {
    component.load();
    const first = http.expectOne((r) => r.url === "/api/supervision");
    component.selectLawyer("a");
    expect(first.cancelled).toBe(true);
    http.expectOne((r) => r.params.get("lawyerId") === "a").flush(data);
    expect(component.loading()).toBe(false);
  });
  it("permite recuperar el panel tras un error de conexión", () => {
    component.load();
    http
      .expectOne((r) => r.url === "/api/supervision")
      .flush({}, { status: 503, statusText: "Unavailable" });
    expect(component.error()).toContain("servidor");
    expect(component.loading()).toBe(false);
    component.load();
    http.expectOne((r) => r.url === "/api/supervision").flush(data);
    expect(component.error()).toBe("");
  });
  it("renderiza estados vacíos y controles de consulta sin acciones de edición", () => {
    const fixture = TestBed.createComponent(Supervision);
    http.expectOne((r) => r.url === "/api/supervision").flush(data);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain("Supervisión de causas");
    expect(text).toContain("No hay causas con estos filtros");
    expect(text).toContain("Solo lectura");
    expect(text).not.toContain("Registrar causa");
    expect(text).not.toContain("Editar causa");
    fixture.destroy();
  });
});
