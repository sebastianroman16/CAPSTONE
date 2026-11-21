import { progressStages, stageLabel } from "./models";

// HU-27: las etapas se llaman igual que en la historia de usuario y en el DAS v2.
describe("Etapas de avance de gestión", () => {
  it("usa los nombres de la HU-27", () => {
    expect(progressStages.filter((s) => s.value !== "NOT_REPORTED").map((s) => s.label)).toEqual([
      "Evaluación",
      "Preparación",
      "En curso",
      "Seguimiento",
      "Completada",
    ]);
    expect(stageLabel(undefined)).toBe("Sin avance informado");
  });
});
