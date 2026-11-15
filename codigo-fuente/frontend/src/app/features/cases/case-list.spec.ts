import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";
import { CaseList } from "./case-list";
import { LegalCase } from "../../core/models";
import { AuthService } from "../../core/auth.service";

describe("Panel de causas", () => {
  let component: CaseList;
  let http: HttpTestingController;
  const base: LegalCase = {
    version: 1,
    id: "1",
    reference: "LC-1",
    rit: null,
    title: "Pensión de alimentos",
    clientId: "c1",
    clientName: "Cliente de prueba",
    matter: "Familia",
    court: "Tribunal",
    priority: "Alta",
    status: "Activa",
    nextDate: "2026-12-20",
    nextDateLabel: "Audiencia",
    createdAt: "2026-10-10",
    updatedAt: "2026-10-10",
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    component = TestBed.runInInjectionContext(() => new CaseList());
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it("combina búsqueda y filtros sin alterar las cifras de la cartera activa", () => {
    http.expectOne("/api/cases").flush([
      base,
      {
        ...base,
        id: "2",
        reference: "LC-2",
        title: "Despido",
        matter: "Laboral",
        priority: "Media",
        nextDate: null,
      },
      { ...base, id: "3", status: "Archivada" },
    ]);
    expect(component.filtered().length).toBe(2);
    expect(component.active().length).toBe(2);
    expect(component.urgent()).toBe(1);
    component.matter.set("Familia");
    component.query.set("  ALIMENTOS  ");
    expect(component.filtered().map((c) => c.id)).toEqual(["1"]);
    component.status.set("Archivada");
    expect(component.filtered().map((c) => c.id)).toEqual(["3"]);
    component.reset();
    expect(component.filtered().length).toBe(2);
  });
  it("muestra error y permite reintentar cuando falla la API", () => {
    http
      .expectOne("/api/cases")
      .flush({}, { status: 503, statusText: "Unavailable" });
    expect(component.loading()).toBe(false);
    expect(component.error()).toContain("servidor");
    component.load();
    http.expectOne("/api/cases").flush([]);
    expect(component.error()).toBe("");
    expect(component.filtered()).toEqual([]);
  });
  it("ordena por cliente, materia y prioridad en ambas direcciones", () => {
    TestBed.inject(AuthService).user.set({id:"lawyer",name:"Abogada",email:"abogada@example.test",role:"LAWYER"});
    http.expectOne("/api/cases").flush([
      { ...base, id: "1", clientName: "Zoe", priority: "Alta", matter: "Familia" },
      { ...base, id: "2", clientName: "Ana", priority: "Baja", matter: "Civil" },
    ]);
    component.sortBy.set("client");
    component.sortDirection.set("asc");
    expect(component.filtered().map(item=>item.id)).toEqual(["2","1"]);
    component.sortDirection.set("desc");
    expect(component.filtered().map(item=>item.id)).toEqual(["1","2"]);
    component.sortBy.set("priority");
    component.sortDirection.set("asc");
    expect(component.filtered().map(item=>item.id)).toEqual(["1","2"]);
  });
});
