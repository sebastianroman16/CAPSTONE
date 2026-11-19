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
});
