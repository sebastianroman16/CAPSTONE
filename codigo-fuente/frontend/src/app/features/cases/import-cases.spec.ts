import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";
import { ImportCases } from "./import-cases";
import { ImportBatch, ImportField, ImportValidation } from "../../core/models";

describe("Importación de causas", () => {
  let component: ImportCases;
  let http: HttpTestingController;
  const suggestedMapping: Record<ImportField, number | null> = {
    clientEmail: 0,
    title: 1,
    rit: 2,
    matter: 3,
    court: 4,
    priority: 5,
    nextDate: 6,
    nextDateLabel: 7,
    internalNotes: 8,
  };
  const batch: ImportBatch = {
    id: "batch-1",
    filename: "causas.xlsx",
    worksheet: "Causas",
    totalRows: 3,
    headers: [
      "Correo cliente*",
      "Carátula*",
      "RIT",
      "Materia*",
      "Tribunal*",
      "Prioridad*",
      "Próxima fecha",
      "Descripción fecha",
      "Notas internas",
    ],
    samples: ["cliente@example.test", "Cobro", "C-1", "Civil", "Tribunal", "Alta", "", "", ""],
    suggestedMapping,
    expiresAt: "2026-10-17T20:00:00.000Z",
  };
  const preview: ImportValidation = {
    summary: { total: 3, valid: 1, errors: 1, duplicates: 1 },
    rows: [
      {
        rowNumber: 2,
        status: "VALID",
        detail: "Lista para importar",
        errors: [],
        data: {
          clientEmail: "cliente@example.test",
          title: "Cobro",
          rit: "C-1",
          matter: "Civil",
          court: "Tribunal",
          priority: "Alta",
          nextDate: "",
          nextDateLabel: "",
          internalNotes: "",
        },
      },
    ],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    component = TestBed.runInInjectionContext(() => new ImportCases());
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it("carga, mapea, previsualiza y confirma únicamente filas válidas", () => {
    const file = new File(["xlsx"], "causas.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    component.fileSelected({ target: { files: [file] } } as unknown as Event);
    component.upload();
    const upload = http.expectOne("/api/case-imports");
    expect(upload.request.body).toBeInstanceOf(FormData);
    upload.flush(batch);
    expect(component.step()).toBe(2);
    expect(component.mappingComplete()).toBe(true);

    component.validate();
    const validation = http.expectOne("/api/case-imports/batch-1/validate");
    expect(validation.request.body.mapping).toEqual(suggestedMapping);
    validation.flush(preview);
    expect(component.step()).toBe(3);
    expect(component.preview()?.summary.valid).toBe(1);

    component.confirm();
    http.expectOne("/api/case-imports/batch-1/confirm").flush({
      imported: 1,
      omitted: 2,
      summary: preview.summary,
    });
    expect(component.imported()).toBe(1);
    expect(component.omitted()).toBe(2);
  });

  it("rechaza extensiones inseguras y evita asignar un campo dos veces", () => {
    const unsafe = new File(["xlsm"], "causas.xlsm");
    component.fileSelected({ target: { files: [unsafe] } } as unknown as Event);
    expect(component.file()).toBeNull();
    expect(component.error()).toContain(".xlsx");

    component.assignments.set(["clientEmail", "title"]);
    component.assign(1, "clientEmail");
    expect(component.assignments()).toEqual([null, "clientEmail"]);
  });
});
