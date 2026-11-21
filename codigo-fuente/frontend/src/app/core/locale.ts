import { LOCALE_ID, Provider } from "@angular/core";
import { registerLocaleData } from "@angular/common";
import localeEsCl from "@angular/common/locales/es-CL";

/**
 * Idioma de la interfaz: español de Chile. Sin esto Angular usa inglés
 * y los meses aparecían como "Dec" en la lista de causas.
 */
registerLocaleData(localeEsCl);

export const appLocaleProviders: Provider[] = [{ provide: LOCALE_ID, useValue: "es-CL" }];
