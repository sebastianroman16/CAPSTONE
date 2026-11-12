import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import ExcelJS from "exceljs";
import { basename, extname } from "node:path";
import { SessionUser } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";

const MAX_ROWS = 500;
const MAX_COLUMNS = 30;
const fields = [
  "clientEmail",
  "title",
  "rit",
  "matter",
  "court",
  "priority",
  "nextDate",
  "nextDateLabel",
  "internalNotes",
] as const;
type ImportField = (typeof fields)[number];
type Mapping = Record<ImportField, number | null>;
type RawRow = Array<string | number | null>;
type Query = (text: string, values?: unknown[]) => Promise<any>;

const requiredFields: ImportField[] = [
  "clientEmail",
  "title",
  "matter",
  "court",
  "priority",
];

const aliases: Record<ImportField, string[]> = {
  clientEmail: ["correo cliente", "email cliente", "cliente correo", "correo", "email"],
  title: ["caratula", "titulo", "causa", "nombre causa"],
  rit: ["rit", "rit causa"],
  matter: ["materia", "tipo", "tipo causa"],
  court: ["tribunal", "juzgado", "corte"],
  priority: ["prioridad", "urgencia"],
  nextDate: ["proxima fecha", "proxima audiencia", "fecha clave", "fecha"],
  nextDateLabel: ["descripcion fecha", "detalle fecha", "tipo fecha"],
  internalNotes: ["notas internas", "notas", "observaciones", "comentarios"],
};

const normalized = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\*/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();

@Injectable()
export class CaseImportService {
  constructor(private readonly db: DatabaseService) {}

  private authorize(user: SessionUser) {
    if (user.role !== "LAWYER")
      throw new ForbiddenException("Solo un abogado puede importar causas.");
  }

  async upload(file: Express.Multer.File | undefined, user: SessionUser) {
    this.authorize(user);
    if (!file) throw new BadRequestException("Selecciona un archivo Excel.");
    if (file.size > 5 * 1024 * 1024)
      throw new BadRequestException("El archivo supera el máximo de 5 MB.");
    if (extname(file.originalname).toLowerCase() !== ".xlsx")
      throw new BadRequestException("Solo se aceptan archivos .xlsx sin macros.");
    if (file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b)
      throw new BadRequestException("El archivo no es un XLSX válido.");

    let workbook: ExcelJS.Workbook;
    try {
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException(
        "El XLSX no es compatible o está dañado. Descarga nuevamente la plantilla actualizada de LEX-CORPUS y evita usar una copia anterior.",
      );
    }
    const worksheet = workbook.worksheets.find((sheet) => sheet.actualRowCount > 0);
    if (!worksheet)
      throw new BadRequestException("La planilla no contiene filas.");

    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    for (let column = 1; column <= Math.min(headerRow.cellCount, MAX_COLUMNS); column++) {
      headers.push(String(this.cellValue(headerRow.getCell(column), 100, true) ?? ""));
    }
    while (headers.length && !headers.at(-1)) headers.pop();
    if (!headers.length)
      throw new BadRequestException("La primera fila debe contener encabezados.");
    if (headerRow.cellCount > MAX_COLUMNS)
      throw new BadRequestException(`La planilla admite hasta ${MAX_COLUMNS} columnas.`);
    const duplicateHeaders = headers.filter(
      (header, index) => header && headers.indexOf(header) !== index,
    );
    if (duplicateHeaders.length)
      throw new BadRequestException("Los encabezados de la planilla deben ser únicos.");

    const rows: RawRow[] = [];
    for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const values = headers.map((_, index) =>
        this.cellValue(row.getCell(index + 1), 5000, false),
      );
      if (values.some((value) => value !== null && value !== "")) rows.push(values);
      if (rows.length > MAX_ROWS)
        throw new BadRequestException(`La planilla admite hasta ${MAX_ROWS} causas.`);
    }
    if (!rows.length)
      throw new BadRequestException("La planilla no contiene causas para importar.");

    const filename = basename(file.originalname).slice(0, 255);
    const result = await this.db.query(
      `INSERT INTO case_import_batches
       (lawyer_id,source_filename,worksheet_name,headers,rows,total_rows)
       VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6) RETURNING id,expires_at AS "expiresAt"`,
      [
        user.id,
        filename,
        worksheet.name.slice(0, 100),
        JSON.stringify(headers),
        JSON.stringify(rows),
        rows.length,
      ],
    );
    return {
      ...result.rows[0],
      filename,
      worksheet: worksheet.name,
      totalRows: rows.length,
      headers,
      samples: headers.map((_, index) => this.display(rows[0]?.[index])),
      suggestedMapping: this.suggestMapping(headers),
    };
  }

  private cellValue(cell: ExcelJS.Cell, maxLength: number, header: boolean): string | number | null {
    const value = cell.value;
    if (value === null || value === undefined) return header ? "" : null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? "Sí" : "No";
    if (typeof value === "object") {
      if ("formula" in value || "sharedFormula" in value)
        throw new BadRequestException(
          `No se aceptan fórmulas en la celda ${cell.address}. Reemplázala por su valor.`,
        );
      if ("hyperlink" in value)
        throw new BadRequestException(`No se aceptan enlaces en la celda ${cell.address}.`);
      if ("richText" in value)
        return this.limit(
          value.richText.map((part: { text: string }) => part.text).join(""),
          maxLength,
          cell.address,
        );
      if ("error" in value)
        throw new BadRequestException(`La celda ${cell.address} contiene un error.`);
    }
    return this.limit(String(value).trim(), maxLength, cell.address);
  }

  private limit(value: string, max: number, address: string) {
    if (value.length > max)
      throw new BadRequestException(`La celda ${address} supera ${max} caracteres.`);
    return value;
  }

  private suggestMapping(headers: string[]): Mapping {
    const mapping = Object.fromEntries(fields.map((field) => [field, null])) as Mapping;
    headers.forEach((header, index) => {
      const candidate = normalized(header);
      for (const field of fields) {
        if (mapping[field] === null && aliases[field].includes(candidate)) {
          mapping[field] = index;
          break;
        }
      }
    });
    return mapping;
  }

  async validate(id: string, rawMapping: Record<string, unknown>, user: SessionUser) {
    this.authorize(user);
    const batch = await this.getBatch(id, user.id);
    const mapping = this.validateMapping(rawMapping, batch.headers.length);
    const validation = await this.validateRows(
      batch.rows,
      mapping,
      user.id,
      (text, values) => this.db.query(text, values),
    );
    await this.db.query(
      `UPDATE case_import_batches SET mapping=$1::jsonb,status='VALIDATED'
       WHERE id=$2 AND lawyer_id=$3 AND status<>'IMPORTED'`,
      [JSON.stringify(mapping), id, user.id],
    );
    return {
      summary: validation.summary,
      rows: validation.rows.map((row) => {
        const { clientId: _clientId, ...data } = row.data;
        return { ...row, data };
      }),
    };
  }

  async confirm(id: string, user: SessionUser) {
    this.authorize(user);
    const connection = await this.db.pool.connect();
    try {
      await connection.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result = await connection.query(
        `SELECT * FROM case_import_batches
         WHERE id=$1 AND lawyer_id=$2 FOR UPDATE`,
        [id, user.id],
      );
      const batch = result.rows[0];
      if (!batch || new Date(batch.expires_at) <= new Date())
        throw new NotFoundException("La importación expiró. Vuelve a subir el archivo.");
      if (batch.status === "IMPORTED")
        throw new ConflictException("Esta planilla ya fue importada.");
      if (batch.status !== "VALIDATED" || !batch.mapping)
        throw new BadRequestException("Previsualiza la importación antes de confirmarla.");
      const validation = await this.validateRows(
        batch.rows,
        this.validateMapping(batch.mapping, batch.headers.length),
        user.id,
        (text, values) => connection.query(text, values),
      );
      for (const row of validation.rows.filter((item) => item.status === "VALID")) {
        await connection.query(
          `INSERT INTO cases
           (lawyer_id,client_id,rit,title,matter,court,priority,next_date,next_date_label,internal_notes)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            user.id,
            row.data.clientId,
            row.data.rit || null,
            row.data.title,
            row.data.matter,
            row.data.court,
            row.data.priority,
            row.data.nextDate || null,
            row.data.nextDateLabel || null,
            row.data.internalNotes || null,
          ],
        );
      }
      await connection.query(
        `UPDATE case_import_batches SET status='IMPORTED',imported_rows=$1,imported_at=now()
         WHERE id=$2`,
        [validation.summary.valid, id],
      );
      await connection.query("COMMIT");
      return {
        imported: validation.summary.valid,
        omitted: validation.summary.errors + validation.summary.duplicates,
        summary: validation.summary,
      };
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }

  private async getBatch(id: string, lawyerId: string) {
    const result = await this.db.query(
      `SELECT id,headers,rows,status FROM case_import_batches
       WHERE id=$1 AND lawyer_id=$2 AND expires_at>now()`,
      [id, lawyerId],
    );
    if (!result.rowCount)
      throw new NotFoundException("La importación expiró. Vuelve a subir el archivo.");
    if (result.rows[0].status === "IMPORTED")
      throw new ConflictException("Esta planilla ya fue importada.");
    return result.rows[0] as { id: string; headers: string[]; rows: RawRow[]; status: string };
  }

  private validateMapping(input: Record<string, unknown>, headerCount: number): Mapping {
    const unknown = Object.keys(input).filter((key) => !fields.includes(key as ImportField));
    if (unknown.length) throw new BadRequestException("El mapeo contiene campos no permitidos.");
    const mapping = Object.fromEntries(
      fields.map((field) => {
        const value = input[field];
        if (value === null || value === undefined || value === "") return [field, null];
        if (!Number.isInteger(value) || Number(value) < 0 || Number(value) >= headerCount)
          throw new BadRequestException("El mapeo contiene una columna inválida.");
        return [field, Number(value)];
      }),
    ) as Mapping;
    for (const field of requiredFields)
      if (mapping[field] === null)
        throw new BadRequestException(`Debes asignar el campo ${field}.`);
    const selected = Object.values(mapping).filter((value) => value !== null);
    if (new Set(selected).size !== selected.length)
      throw new BadRequestException("Una columna no puede asignarse a dos campos.");
    return mapping;
  }

  private async validateRows(
    rows: RawRow[],
    mapping: Mapping,
    lawyerId: string,
    query: Query,
  ) {
    const clients = await query(
      `SELECT id,name,email FROM users
       WHERE role='CLIENT' AND lawyer_id=$1 AND active=true`,
      [lawyerId],
    );
    const clientByEmail = new Map<string, any>(
      clients.rows.map((client: any) => [client.email.toLowerCase(), client]),
    );
    const existing = await query(
      `SELECT id,reference,rit,court FROM cases
       WHERE lawyer_id=$1 AND rit IS NOT NULL`,
      [lawyerId],
    );
    const existingKeys = new Map<string, any>(
      existing.rows.map((item: any) => [this.duplicateKey(item.rit, item.court), item]),
    );
    const seen = new Set<string>();
    const validated = rows.map((raw, index) => {
      const get = (field: ImportField) => {
        const column = mapping[field];
        return column === null ? null : raw[column];
      };
      const text = (field: ImportField) => String(get(field) ?? "").trim();
      const data: any = {
        clientEmail: text("clientEmail").toLowerCase(),
        title: text("title"),
        rit: text("rit"),
        matter: this.canonical(text("matter"), ["Familia", "Laboral", "Civil", "Penal"]),
        court: text("court"),
        priority: this.canonical(text("priority"), ["Alta", "Media", "Baja"]),
        nextDate: this.dateValue(get("nextDate")),
        nextDateLabel: text("nextDateLabel"),
        internalNotes: text("internalNotes"),
      };
      const errors: string[] = [];
      const client = clientByEmail.get(data.clientEmail);
      if (!data.clientEmail || !/^\S+@\S+\.\S+$/.test(data.clientEmail))
        errors.push("Correo del cliente inválido");
      else if (!client) errors.push("El cliente no pertenece a tu cartera activa");
      else {
        data.clientId = client.id;
        data.clientName = client.name;
      }
      if (data.title.length < 3 || data.title.length > 200)
        errors.push("La carátula debe tener entre 3 y 200 caracteres");
      if (!data.matter) errors.push("Materia no permitida");
      if (data.court.length < 3 || data.court.length > 200)
        errors.push("Tribunal inválido");
      if (!data.priority) errors.push("Prioridad no permitida");
      if (data.rit.length > 50) errors.push("El RIT supera 50 caracteres");
      if (data.nextDate === false) errors.push("Fecha inválida; usa AAAA-MM-DD");
      if (data.nextDateLabel.length > 200) errors.push("La descripción de fecha supera 200 caracteres");
      if (data.internalNotes.length > 5000) errors.push("Las notas superan 5000 caracteres");
      if (data.nextDate === false) data.nextDate = "";

      let status: "VALID" | "ERROR" | "DUPLICATE" = errors.length ? "ERROR" : "VALID";
      let detail = errors.join(" · ") || "Lista para importar";
      if (!errors.length && data.rit) {
        const key = this.duplicateKey(data.rit, data.court);
        const match = existingKeys.get(key);
        if (match) {
          status = "DUPLICATE";
          detail = `Coincide con ${match.reference}; no se importará`;
        } else if (seen.has(key)) {
          status = "DUPLICATE";
          detail = "RIT y tribunal repetidos dentro de la planilla";
        } else seen.add(key);
      }
      return { rowNumber: index + 2, status, detail, errors, data };
    });
    const summary = {
      total: validated.length,
      valid: validated.filter((row) => row.status === "VALID").length,
      errors: validated.filter((row) => row.status === "ERROR").length,
      duplicates: validated.filter((row) => row.status === "DUPLICATE").length,
    };
    return { summary, rows: validated };
  }

  private canonical(value: string, allowed: string[]) {
    const key = normalized(value);
    return allowed.find((item) => normalized(item) === key) ?? "";
  }

  private dateValue(value: string | number | null): string | false {
    if (value === null || value === "") return "";
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 1 || value > 100000) return false;
      const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
      return date.toISOString().slice(0, 10);
    }
    const text = String(value).trim();
    let iso = text;
    const local = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (local)
      iso = `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const date = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso
      ? iso
      : false;
  }

  private duplicateKey(rit: string, court: string) {
    return `${normalized(rit)}|${normalized(court)}`;
  }

  private display(value: string | number | null) {
    return value === null ? "" : String(value).slice(0, 120);
  }
}
