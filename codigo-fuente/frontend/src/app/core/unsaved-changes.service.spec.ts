import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { AuthService } from "./auth.service";
import { User } from "./models";
import { UnsavedChangesService, UnsavedEditor } from "./unsaved-changes.service";

// E15 · Borrador recuperable cuando la sesión expira por inactividad.
describe("Borradores tras expirar la sesión", () => {
  let service: UnsavedChangesService;
  let auth: AuthService;
  const user = (id: string) => ({ id, name: "Abogada", email: `${id}@example.test`, role: "LAWYER", phone: null, mustChangePassword: false }) as User;
  const editor = (dirty = true, key: string | null = "causa:case-1"): UnsavedEditor & { discarded: boolean } => ({
    discarded: false,
    hasUnsavedChanges: () => dirty,
    discardPendingChanges() { this.discarded = true; },
    draftKey: () => key,
    draftValue: () => ({ title: "Borrador sin guardar" }),
  });

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(UnsavedChangesService);
    auth = TestBed.inject(AuthService);
    auth.user.set(user("abogada-1"));
  });
  afterEach(() => { sessionStorage.clear(); vi.useRealTimers(); });

  describe("caso feliz", () => {
    it("guarda el borrador al expirar y lo entrega al mismo usuario una sola vez", () => {
      const form = editor();
      service.register(form);
      expect(service.preserveAfterExpiry()).toBe(true);
      expect(form.discarded).toBe(true);
      expect(service.takeDraft("causa:case-1")).toEqual({ title: "Borrador sin guardar" });
      expect(service.takeDraft("causa:case-1")).toBeNull();
    });
  });

  describe("caso triste", () => {
    it("otro usuario no recibe el borrador", () => {
      service.register(editor());
      service.preserveAfterExpiry();
      auth.user.set(user("abogado-2"));
      expect(service.takeDraft("causa:case-1")).toBeNull();
    });
    it("no guarda nada si no hay cambios, si el formulario no admite borradores o si no hay usuario", () => {
      service.register(editor(false));
      expect(service.preserveAfterExpiry()).toBe(false);
      service.register(editor(true, null));
      expect(service.preserveAfterExpiry()).toBe(false);
      auth.user.set(null);
      service.register(editor());
      expect(service.preserveAfterExpiry()).toBe(false);
      expect(sessionStorage.length).toBe(0);
    });
    it("el cierre de sesión voluntario borra los borradores", () => {
      service.register(editor());
      service.preserveAfterExpiry();
      service.discardAfterLogout();
      expect(service.takeDraft("causa:case-1")).toBeNull();
    });
  });

  describe("caso borde", () => {
    it("descarta borradores de más de 8 horas", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-18T08:00:00Z"));
      service.register(editor());
      service.preserveAfterExpiry();
      vi.setSystemTime(new Date("2026-11-18T16:00:01Z"));
      expect(service.takeDraft("causa:case-1")).toBeNull();
    });
    it("ignora un borrador dañado y lo elimina", () => {
      sessionStorage.setItem("lex-draft:abogada-1:causa:case-1", "{no es json");
      expect(service.takeDraft("causa:case-1")).toBeNull();
      expect(sessionStorage.length).toBe(0);
    });
    it("si el almacenamiento falla, igual descarta los cambios sin romper la expiración", () => {
      const form = editor();
      service.register(form);
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
      expect(service.preserveAfterExpiry()).toBe(false);
      expect(form.discarded).toBe(true);
    });
  });
});
