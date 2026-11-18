import { searchText } from "./case-list";

// E20 · La búsqueda de causas ignora tildes, diéresis y mayúsculas.
describe("Búsqueda sin tildes", () => {
  const matches = (query: string, text: string) => searchText(text).includes(searchText(query.trim()));
  it("caso feliz: 'munoz' encuentra 'Muñoz' y 'pension' encuentra 'Pensión'", () => {
    expect(matches("munoz", "Ana Muñoz")).toBe(true);
    expect(matches("pension", "Pensión de alimentos")).toBe(true);
  });
  it("caso triste: un texto distinto no coincide", () => {
    expect(matches("perez", "Ana Muñoz")).toBe(false);
  });
  it("caso borde: búsqueda con tilde, mayúsculas, diéresis, valores nulos y espacios", () => {
    expect(matches("MUÑOZ", "ana munoz")).toBe(true);
    expect(matches("arguelles", "Argüelles")).toBe(true);
    expect(matches("  lc-1 ", "LC-1")).toBe(true);
    expect(searchText(null)).toBe("");
    expect(searchText(undefined)).toBe("");
  });
});
