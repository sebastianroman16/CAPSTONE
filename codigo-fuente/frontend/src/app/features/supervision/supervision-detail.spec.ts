import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { AuthService } from "../../core/auth.service";
import { routes } from "../../app.routes";

// HU-26: el detalle supervisado muestra las reasignaciones con su motivo, sin datos de contacto.
describe("Detalle supervisado: reasignaciones (HU-26)", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
      ],
    });
    TestBed.inject(AuthService).user.set({
      id: "1",
      name: "Coordinador",
      email: "coordinador@example.test",
      role: "SUPERVISOR",
    });
  });

  const baseCase = {
    id: "case-1",
    reference: "LC-1",
    rit: "C-1-2026",
    title: "Causa supervisada",
    matter: "Civil",
    court: "Juzgado Civil",
    priority: "Media",
    status: "Activa",
    progressStage: "PREPARATION",
    progressSummary: "Resumen",
    nextAction: "",
    lawyerId: "lawyer-1",
    lawyerName: "Ana Abogada",
    clientName: "Cliente de prueba",
    nextDate: null,
    nextDateLabel: null,
    needsAttention: false,
    progressUpdatedAt: null,
    history: [],
  };

  it("muestra las reasignaciones con su motivo", async () => {
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create("/supervision/causas/case-1");
    http.expectOne("/api/admin/users").flush([]);
    http.expectOne("/api/supervision/cases/case-1").flush({
      ...baseCase,
      reassignments: [
        {
          createdAt: "2026-11-02T12:00:00Z",
          reason: "Licencia médica de la abogada responsable",
          fromLawyer: "Natalia Rojas",
          toLawyer: "María Ibáñez",
        },
      ],
    });
    harness.detectChanges();
    const text = harness.routeNativeElement!.textContent ?? "";
    expect(text).toContain("Reasignaciones");
    expect(text).toContain("Natalia Rojas → María Ibáñez");
    expect(text).toContain("Licencia médica de la abogada responsable");
    http.verify();
  });

  it("indica cuando la causa nunca fue reasignada", async () => {
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create("/supervision/causas/case-1");
    http.expectOne("/api/admin/users").flush([]);
    http.expectOne("/api/supervision/cases/case-1").flush({ ...baseCase, reassignments: [] });
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain("Esta causa no ha sido reasignada.");
    http.verify();
  });
  // HU-29: el formulario aparece con la causa cargada (antes solo se mostraba si la carga fallaba)
  // y ofrece únicamente abogados activos distintos del responsable actual.
  it("muestra el formulario de reasignación sin el abogado responsable", async () => {
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create("/supervision/causas/case-1");
    http.expectOne("/api/admin/users").flush([
      { id: "lawyer-1", name: "Ana Abogada", role: "LAWYER", active: true },
      { id: "lawyer-2", name: "Bruno Abogado", role: "LAWYER", active: true },
      { id: "lawyer-3", name: "Carla Inactiva", role: "LAWYER", active: false },
      { id: "client-1", name: "Cliente de prueba", role: "CLIENT", active: true },
    ]);
    http.expectOne("/api/supervision/cases/case-1").flush({ ...baseCase, reassignments: [] });
    harness.detectChanges();
    const select = harness.routeNativeElement!.querySelector<HTMLSelectElement>("#new-lawyer");
    expect(select).not.toBeNull();
    const options = Array.from(select!.options).map((o) => o.textContent?.trim());
    expect(options).toEqual(["Selecciona un abogado activo", "Bruno Abogado"]);
    http.verify();
  });

  it("envía la reasignación y recarga el detalle", async () => {
    const http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create("/supervision/causas/case-1");
    http.expectOne("/api/admin/users").flush([
      { id: "lawyer-2", name: "Bruno Abogado", role: "LAWYER", active: true },
    ]);
    http.expectOne("/api/supervision/cases/case-1").flush({ ...baseCase, reassignments: [] });
    harness.detectChanges();
    await harness.fixture.whenStable();
    const root = harness.routeNativeElement!;
    const select = root.querySelector<HTMLSelectElement>("#new-lawyer")!;
    select.value = "lawyer-2";
    select.dispatchEvent(new Event("change"));
    const reason = root.querySelector<HTMLTextAreaElement>("#reason")!;
    reason.value = "Redistribución de carga";
    reason.dispatchEvent(new Event("input"));
    harness.detectChanges();
    await harness.fixture.whenStable();
    select.closest("form")!.dispatchEvent(new Event("submit"));
    const req = http.expectOne("/api/admin/cases/case-1/reassign");
    expect(req.request.body).toEqual({ lawyerId: "lawyer-2", reason: "Redistribución de carga" });
    req.flush({ id: "case-1", lawyerId: "lawyer-2", reassigned: true });
    http.expectOne("/api/supervision/cases/case-1").flush({ ...baseCase, lawyerId: "lawyer-2", lawyerName: "Bruno Abogado", reassignments: [] });
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain("La causa quedó a cargo de Bruno Abogado.");
    http.verify();
  });
});
