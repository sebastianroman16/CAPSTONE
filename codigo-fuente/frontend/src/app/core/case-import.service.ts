import { HttpClient } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import {
  ImportBatch,
  ImportedClient,
  ImportField,
  ImportValidation,
} from "./models";

@Injectable({ providedIn: "root" })
export class CaseImportService {
  private readonly http = inject(HttpClient);

  upload(file: File) {
    const body = new FormData();
    body.append("file", file, file.name);
    return this.http.post<ImportBatch>("/api/case-imports", body);
  }

  validate(id: string, mapping: Record<ImportField, number | null>) {
    return this.http.post<ImportValidation>(`/api/case-imports/${id}/validate`, {
      mapping,
    });
  }

  confirm(id: string) {
    return this.http.post<{
      imported: number;
      omitted: number;
      summary: ImportValidation["summary"];
      newClients: ImportedClient[];
      linkedClients: number;
    }>(`/api/case-imports/${id}/confirm`, {});
  }
}
