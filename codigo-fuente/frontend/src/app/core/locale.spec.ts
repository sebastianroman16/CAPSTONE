import { TestBed } from "@angular/core/testing";
import { LOCALE_ID } from "@angular/core";
import { DatePipe } from "@angular/common";
import { appLocaleProviders } from "./locale";

// Las fechas con nombre de mes se muestran en español (antes aparecía "03 Dec 2026").
describe("Idioma de la interfaz", () => {
  it("usa español de Chile para los meses", () => {
    TestBed.configureTestingModule({ providers: [...appLocaleProviders] });
    expect(TestBed.inject(LOCALE_ID)).toBe("es-CL");
    const pipe = new DatePipe(TestBed.inject(LOCALE_ID));
    const text = pipe.transform("2026-12-03", "dd MMM yyyy") ?? "";
    expect(text.toLowerCase()).toContain("dic");
    expect(text).not.toContain("Dec");
  });
});
