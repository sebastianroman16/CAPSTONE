import { inject, Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { AppNotification, CaseDocument, Communication, Deadline, DocumentRequest, IngestionItem, User } from "./models";
@Injectable({providedIn:"root"})
export class ProductService{
  private http=inject(HttpClient);
  agenda(from:string,to:string){return this.http.get<Deadline[]>("/api/agenda",{params:{from,to}});}
  addDeadline(caseId:string,data:object){return this.http.post<Deadline>(`/api/cases/${caseId}/deadlines`,data);}
  deadlineStatus(id:string,status:string){return this.http.patch(`/api/deadlines/${id}`,{status});}
  communications(caseId:string){return this.http.get<Communication[]>(`/api/cases/${caseId}/communications`);}
  sendCommunication(caseId:string,message:string,channel:string){return this.http.post<Communication>(`/api/cases/${caseId}/communications`,{message,channel});}
  documents(caseId:string){return this.http.get<CaseDocument[]>(`/api/cases/${caseId}/documents`);}
  uploadDocument(caseId:string,file:File,meta:{title:string;description:string;category:string;visibility:string}){const f=new FormData();f.append("file",file);Object.entries(meta).forEach(([k,v])=>f.append(k,v));return this.http.post(`/api/cases/${caseId}/documents`,f);}
  requests(){return this.http.get<DocumentRequest[]>("/api/document-requests");}
  requestDocument(caseId:string,data:object){return this.http.post(`/api/cases/${caseId}/document-requests`,data);}
  notifications(){return this.http.get<AppNotification[]>("/api/notifications");}
  readNotification(id:string){return this.http.patch(`/api/notifications/${id}/read`,{});}
  ingestion(){return this.http.get<IngestionItem[]>("/api/ingestion");}
  ingestText(data:object){return this.http.post("/api/ingestion/text",data);}
  review(id:string,status:string,summary:string){return this.http.patch(`/api/ingestion/${id}/review`,{status,summary});}
  createClient(data:{name:string;email:string;phone:string}){return this.http.post<{id:string;name:string;email:string;temporaryPassword:string}>("/api/users/clients",data);}
  updateProfile(data:{name:string;email:string;phone:string}){return this.http.patch<User>("/api/users/me",data);}
}
