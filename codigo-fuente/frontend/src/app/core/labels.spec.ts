import { CHANNEL_LABELS, DELIVERY_LABELS, MOVEMENT_LABELS, REQUEST_STATUS_LABELS, SOURCE_TYPE_LABELS, fileSize, label } from "./labels";

// Estados y canales legibles en vez de códigos internos (HU-16, HU-22, mockup 07).
describe("Textos visibles de los códigos internos", () => {
  it("caso feliz: traduce estados de solicitud, canales, entrega, origen y tipo de movimiento", () => {
    expect(label(REQUEST_STATUS_LABELS, "PENDING")).toBe("Pendiente");
    expect(label(REQUEST_STATUS_LABELS, "FULFILLED")).toBe("Recibido");
    expect(label(CHANNEL_LABELS, "IN_APP")).toBe("Bandeja interna");
    expect(label(DELIVERY_LABELS, "FAILED")).toBe("No entregado");
    expect(label(SOURCE_TYPE_LABELS, "EXCEL")).toBe("Excel");
    expect(label(MOVEMENT_LABELS, "RESOLUCIÓN")).toBe("Resolución");
  });
  it("caso triste: un código desconocido se muestra tal cual y un valor vacío no muestra nada", () => {
    expect(label(REQUEST_STATUS_LABELS, "NUEVO_ESTADO")).toBe("NUEVO_ESTADO");
    expect(label(CHANNEL_LABELS, null)).toBe("");
    expect(label(CHANNEL_LABELS, undefined)).toBe("");
  });
  it("caso borde: tamaños de archivo en KB y MB, y archivos vacíos", () => {
    expect(fileSize(412 * 1024)).toBe("412 KB");
    expect(fileSize(100)).toBe("1 KB");
    expect(fileSize(1024 * 1024)).toBe("1,0 MB");
    expect(fileSize(Math.round(1.25 * 1024 * 1024))).toBe("1,3 MB");
    expect(fileSize(0)).toBe("");
  });
});
