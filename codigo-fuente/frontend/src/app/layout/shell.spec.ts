import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { provideRouter, Router } from "@angular/router";
import { UnsavedChangesService } from "../core/unsaved-changes.service";
import { Shell } from "./shell";

describe("Cerrar sesión con un formulario pendiente", () => {
  let shell: Shell, http: HttpTestingController;
  const editor = {
    hasUnsavedChanges: () => true,
    discardPendingChanges: vi.fn(),
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    shell = TestBed.runInInjectionContext(() => new Shell());
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(UnsavedChangesService).register(editor);
    editor.discardPendingChanges.mockClear();
  });
  afterEach(() => {
    shell.ngOnDestroy();
    http.verify();
    vi.restoreAllMocks();
  });
  it("no revoca la sesión si se cancela el descarte", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    shell.logout();
    http.expectNone("/api/auth/logout");
    expect(editor.discardPendingChanges).not.toHaveBeenCalled();
  });
  it("solicita confirmación antes de cerrar desde la interfaz", () => {
    shell.requestLogout();
    expect(shell.logoutConfirmation()).toBe(true);
    http.expectNone("/api/auth/logout");
    shell.cancelLogout();
    expect(shell.logoutConfirmation()).toBe(false);
    http.expectNone("/api/auth/logout");
  });
  it("descarta solo después de cerrar la sesión correctamente", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true);
    shell.logout();
    expect(editor.discardPendingChanges).not.toHaveBeenCalled();
    http.expectOne("/api/auth/logout").flush({ ok: true });
    expect(editor.discardPendingChanges).toHaveBeenCalledOnce();
  });
  it("conserva el borrador cuando falla el cierre de sesión", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    shell.logout();
    http
      .expectOne("/api/auth/logout")
      .flush({}, { status: 503, statusText: "Unavailable" });
    expect(editor.discardPendingChanges).not.toHaveBeenCalled();
    expect(shell.error()).toBeTruthy();
  });
});

describe("Control de inactividad", () => {
  let shell: Shell, http: HttpTestingController;
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    shell = TestBed.runInInjectionContext(() => new Shell());
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true);
    shell.ngOnInit();
  });
  afterEach(() => {
    shell.ngOnDestroy();
    http.verify();
    vi.useRealTimers();
  });
  it("avisa tras 3 minutos y cierra 10 segundos después", () => {
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(shell.inactivityWarning()).toBe(true);
    expect(shell.secondsRemaining()).toBe(10);
    vi.advanceTimersByTime(10 * 1000);
    http.expectOne("/api/auth/logout").flush({ ok: true });
    expect(shell.inactivityWarning()).toBe(false);
  });
  it("renueva la sesión cuando la persona confirma actividad", () => {
    vi.advanceTimersByTime(3 * 60 * 1000);
    shell.continueSession();
    http.expectOne("/api/auth/extend").flush({
      ok: true,
      user: {
        id: "user-id",
        name: "Abogada",
        email: "abogada@example.test",
        role: "LAWYER",
      },
    });
    expect(shell.inactivityWarning()).toBe(false);
    expect(shell.renewing()).toBe(false);
    http.expectNone("/api/auth/logout");
  });
  it("una interacción vuelve a contar los 3 minutos", () => {
    vi.advanceTimersByTime(2 * 60 * 1000);
    shell.recordActivity();
    http.expectOne("/api/auth/extend").flush({
      ok: true,
      user: {
        id: "user-id",
        name: "Abogada",
        email: "abogada@example.test",
        role: "LAWYER",
      },
    });
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(shell.inactivityWarning()).toBe(false);
    vi.advanceTimersByTime(60 * 1000);
    expect(shell.inactivityWarning()).toBe(true);
  });
});
