// Anonimización previa al envío a Gemini (DAS 3.3 y términos del proveedor gratuito).
// Quita correos, RUT y teléfonos. Conserva fechas, horas, tribunales, referencias y RIT.
// LIMITACIÓN: NO quita nombres de personas. Detectarlos con expresiones regulares produce
// falsos positivos (nombres de tribunales y ciudades) y deja nombres sin detectar.
// shortcut: los nombres de partes viajan a Gemini sin anonimizar, revisar antes de publicar el informe.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// RUT chileno: 7-8 dígitos con puntos opcionales y dígito verificador (0-9 o K).
const RUT = /\b\d{1,2}(?:\.\d{3}){2}-[\dkK]\b|\b\d{7,8}-[\dkK]\b/g;
// Teléfonos chilenos y de otros formatos: +56 9 1234 5678, 9 1234 5678, (02) 2345 6789.
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}\b/g;

/** Devuelve el texto sin correos, RUT ni teléfonos. No modifica fechas, horas ni números de causa. */
export function anonymizeForAi(text: string): string {
  return text
    .replace(EMAIL, "[correo]")
    .replace(RUT, "[rut]")
    .replace(PHONE, (match, offset: number, whole: string) => {
      // No son teléfonos: fechas, horas, números de RIT o de causa (con letra antes o guion interno) ni cifras cortas.
      const digits = match.replace(/\D/g, "");
      const before = whole.slice(Math.max(0, offset - 2), offset);
      const isReference = /[A-Za-z]-?$/.test(before) || /\d[-/]\d/.test(match);
      if (digits.length < 8 || isReference) return match;
      return "[teléfono]";
    });
}
