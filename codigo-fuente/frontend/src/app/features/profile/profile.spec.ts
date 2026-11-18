import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { ProfileSummary, User } from "../../core/models";
import { Profile } from "./profile";

// Mockup 04 · Perfil con los datos de la corporación, causas activas y abogado asignado (HU-05).
describe("Perfil con datos de la corporación", () => {
  let fixture: ComponentFixture<Profile>;
  let http: HttpTestingController;
  const summary: ProfileSummary = {
    corporation: "Corporación de Asistencia Judicial", office: "CAJ Metropolitana Sur", memberSince: "2026-03-10T12:00:00.000Z",
    activeCases: 3, lawyers: [{ name: "María Ibáñez", email: "m.ibanez@example.test", phone: "+56 9 1122 3344" }],
  };

  function open(user: Partial<User>) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    TestBed.inject(AuthService).user.set({ id: "u-1", name: "Cliente", email: "cliente@example.test", role: "CLIENT", mustChangePassword: false, ...user } as User);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Profile);
    fixture.detectChanges();
  }
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? "";
  afterEach(() => http.verify());

  it("caso feliz: muestra corporación, oficina, causas activas, antigüedad y abogado asignado", () => {
    open({});
    http.expectOne("/api/users/me/summary").flush(summary);
    fixture.detectChanges();
    expect(text()).toContain("Corporación de Asistencia Judicial");
    expect(text()).toContain("CAJ Metropolitana Sur");
    expect(text()).toContain("Abogado asignado");
    expect(text()).toContain("m.ibanez@example.test · +56 9 1122 3344");
    expect(fixture.componentInstance.memberSince(summary.memberSince)).toBe("marzo de 2026");
  });
  it("caso triste: si el resumen falla, el formulario de datos sigue disponible", () => {
    open({});
    http.expectOne("/api/users/me/summary").flush({ message: "Error" }, { status: 500, statusText: "Error" });
    fixture.detectChanges();
    expect(text()).not.toContain("Información de la corporación");
    expect((fixture.nativeElement as HTMLElement).querySelector("#profile-name")).not.toBeNull();
  });
  it("caso borde: durante el cambio obligatorio no se pide el resumen y un abogado no ve abogados asignados", () => {
    open({ mustChangePassword: true });
    http.expectNone("/api/users/me/summary");
    TestBed.resetTestingModule();
    open({ role: "LAWYER" });
    http.expectOne("/api/users/me/summary").flush({ ...summary, office: null, lawyers: [] });
    fixture.detectChanges();
    expect(text()).toContain("Causas activas");
    expect(text()).not.toContain("Abogado asignado");
    expect(text()).not.toContain("Oficina");
    expect(fixture.componentInstance.memberSince("no-es-fecha")).toBe("—");
  });
});
