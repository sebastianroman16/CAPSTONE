import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";
import { Administration } from "./administration";

// HU-30: el filtro por tipo de entidad solo ofrece las tablas que la base audita.
describe("Auditoría de administración (HU-30)", () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }),
  );

  it("carga la auditoría completa y luego la filtra por entidad", () => {
    const http = TestBed.inject(HttpTestingController);
    const component = TestBed.runInInjectionContext(() => new Administration());
    http.expectOne("/api/admin/users").flush([]);
    http.expectOne((r) => r.url === "/api/admin/audit").flush([]);

    component.filterAudit("cases");

    const filtered = http.expectOne((r) => r.url === "/api/admin/audit");
    expect(filtered.request.params.get("entityType")).toBe("cases");
    filtered.flush([
      {
        id: "a1",
        entityType: "cases",
        entityId: "c1",
        action: "UPDATE",
        occurredAt: "2026-11-01T10:00:00Z",
        actorName: "Coordinador",
      },
    ]);
    expect(component.audit().length).toBe(1);
    http.verify();
  });

  it("ofrece solo entidades auditadas: usuarios, causas y documentos", () => {
    const http = TestBed.inject(HttpTestingController);
    const component = TestBed.runInInjectionContext(() => new Administration());
    http.expectOne("/api/admin/users").flush([]);
    http.expectOne((r) => r.url === "/api/admin/audit").flush([]);
    expect(component.entityOptions.map((option) => option.value)).toEqual([
      "users",
      "cases",
      "documents",
    ]);
    http.verify();
  });
});
