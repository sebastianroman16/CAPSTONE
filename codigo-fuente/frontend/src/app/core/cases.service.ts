import { inject, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Client, CreatedCase, LegalCase, SaveCase, ProgressEvent } from "./models";
@Injectable({ providedIn: "root" })
export class CasesService {
  private readonly http = inject(HttpClient);
  progress(id: string) {
    return this.http.get<ProgressEvent[]>(`/api/cases/${id}/progress`);
  }
  saveProgress(
    id: string,
    data: {
      stage: string;
      summary: string;
      nextAction: string;
      version: number;
    },
  ) {
    return this.http.patch<{ saved: boolean }>(
      `/api/cases/${id}/progress`,
      data,
    );
  }
  list() {
    return this.http.get<LegalCase[]>("/api/cases");
  }
  get(id: string) {
    return this.http.get<LegalCase>(`/api/cases/${id}`);
  }
  clients() {
    return this.http.get<Client[]>("/api/users/clients");
  }
  create(data: SaveCase) {
    return this.http.post<CreatedCase>("/api/cases", data);
  }
  update(id: string, data: SaveCase, version: number) {
    return this.http.put<LegalCase>(`/api/cases/${id}`, { ...data, version });
  }
  archive(id: string, version: number) {
    return this.http.patch<LegalCase>(`/api/cases/${id}/archive`, { version });
  }
}
