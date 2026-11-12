import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { LegalCase } from "../../core/models";
import { ClientPortfolio } from "./client-portfolio";

describe("Cartera de clientes", () => {
  let component: ClientPortfolio;
  let http: HttpTestingController;
  const legalCase: LegalCase = {
    id: "case-1",
    version: 1,
    reference: "LC-1",
    rit: "C-1-2026",
    title: "Cobro de pagaré",
    clientId: "client-1",
    clientName: "Ana Cliente",
    matter: "Civil",
    court: "Juzgado Civil",
    priority: "Media",
    status: "Activa",
    nextDate: "2026-12-01",
    nextDateLabel: "Audiencia",
    createdAt: "2026-10-01",
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
    component = TestBed.runInInjectionContext(() => new ClientPortfolio());
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it("agrupa únicamente las causas entregadas para cada cliente", () => {
    http.expectOne("/api/users/clients").flush([
      { id: "client-1", name: "Ana Cliente", email: "ana@example.test" },
      { id: "client-2", name: "Bruno Cliente", email: "bruno@example.test" },
    ]);
    http.expectOne("/api/cases").flush([legalCase]);

    expect(component.portfolio()[0].activeCases).toBe(1);
    expect(component.portfolio()[0].cases[0].reference).toBe("LC-1");
    expect(component.portfolio()[1].cases).toEqual([]);
  });

  it("busca por cliente, correo y datos de sus causas", () => {
    http.expectOne("/api/users/clients").flush([
      { id: "client-1", name: "Ana Cliente", email: "ana@example.test" },
    ]);
    http.expectOne("/api/cases").flush([legalCase]);

    component.query.set("C-1-2026");
    expect(component.filtered().map((client) => client.id)).toEqual([
      "client-1",
    ]);
    component.query.set("sin coincidencias");
    expect(component.filtered()).toEqual([]);
  });
});
