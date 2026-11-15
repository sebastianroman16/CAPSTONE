import { inject, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { AuditEntry, ManagedUser } from "./models";
@Injectable({providedIn:"root"})
export class AdminService{
  private http=inject(HttpClient);
  users(){return this.http.get<ManagedUser[]>("/api/admin/users");}
  setStatus(id:string,active:boolean){return this.http.patch(`/api/admin/users/${id}/status`,{active});}
  reassign(caseId:string,lawyerId:string,reason:string){return this.http.patch(`/api/admin/cases/${caseId}/reassign`,{lawyerId,reason});}
  audit(){return this.http.get<AuditEntry[]>("/api/admin/audit");}
}
