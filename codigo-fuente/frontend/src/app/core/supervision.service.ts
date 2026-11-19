import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { CaseReassignment, ProgressEvent, SupervisedCase, SupervisionDashboard } from "./models";
@Injectable({ providedIn: "root" })
export class SupervisionService {
  private readonly http = inject(HttpClient);
  dashboard(params: Record<string, string>) {
    return this.http.get<SupervisionDashboard>("/api/supervision", { params });
  }
  detail(id: string) {
    return this.http.get<SupervisedCase & { history: ProgressEvent[]; reassignments: CaseReassignment[] }>(
      `/api/supervision/cases/${id}`,
    );
  }
}
