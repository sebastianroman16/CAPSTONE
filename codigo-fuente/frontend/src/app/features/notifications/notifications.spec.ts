import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";
import { AppNotification } from "../../core/models";
import { NOTIFICATIONS_PAGE_SIZE, Notifications } from "./notifications";

// E24 · Notificaciones paginadas con "Cargar más".
describe("Notificaciones paginadas", () => {
  let http: HttpTestingController;
  let component: Notifications;
  const notification = (n: number): AppNotification => ({
    id: `n-${n}`, caseId: null, type: "CASE_UPDATE", title: `Aviso ${n}`, body: "Cuerpo", channel: "IN_APP",
    deliveryStatus: "DELIVERED", readAt: null, createdAt: new Date(Date.UTC(2026, 10, 1, 12, 0, 0) - n * 1000).toISOString(),
  });
  const page = (from: number, size: number) => Array.from({ length: size }, (_, i) => notification(from + i));
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    component = TestBed.runInInjectionContext(() => new Notifications());
  });
  afterEach(() => http.verify());
  const first = () => http.expectOne((r) => r.url === "/api/notifications" && !r.params.has("before"));

  it("caso feliz: pide la página siguiente con el cursor de la última recibida y las acumula", () => {
    const request = first();
    expect(request.request.params.get("limit")).toBe(String(NOTIFICATIONS_PAGE_SIZE));
    request.flush(page(0, NOTIFICATIONS_PAGE_SIZE));
    expect(component.hasMore()).toBe(true);
    component.loadMore();
    const next = http.expectOne((r) => r.url === "/api/notifications" && r.params.has("before"));
    expect(next.request.params.get("beforeId")).toBe(`n-${NOTIFICATIONS_PAGE_SIZE - 1}`);
    expect(next.request.params.get("before")).toBe(notification(NOTIFICATIONS_PAGE_SIZE - 1).createdAt);
    next.flush(page(NOTIFICATIONS_PAGE_SIZE, 5));
    expect(component.items().length).toBe(NOTIFICATIONS_PAGE_SIZE + 5);
    expect(component.hasMore()).toBe(false);
  });
  it("caso triste: muestra el error y deja de cargar", () => {
    first().flush({ message: "No autorizado." }, { status: 401, statusText: "Unauthorized" });
    expect(component.error()).not.toBe("");
    expect(component.loading()).toBe(false);
  });
  it("caso borde: marcar leída actualiza solo esa notificación sin perder las páginas cargadas y no duplica", () => {
    first().flush(page(0, NOTIFICATIONS_PAGE_SIZE));
    component.loadMore();
    http.expectOne((r) => r.params.has("before")).flush([notification(NOTIFICATIONS_PAGE_SIZE - 1), ...page(NOTIFICATIONS_PAGE_SIZE, 2)]);
    expect(component.items().length).toBe(NOTIFICATIONS_PAGE_SIZE + 2);
    component.read(component.items()[0]);
    http.expectOne("/api/notifications/n-0/read").flush({ id: "n-0", readAt: "2026-11-18T12:00:00.000Z" });
    expect(component.items()[0].readAt).toBe("2026-11-18T12:00:00.000Z");
    expect(component.items().length).toBe(NOTIFICATIONS_PAGE_SIZE + 2);
    http.expectNone((r) => r.url === "/api/notifications");
  });
});
