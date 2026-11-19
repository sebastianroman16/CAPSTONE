import { DatePipe } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { AdminService } from "../../core/admin.service";
import { errorMessage } from "../../core/auth.service";
import { AuditEntry, ManagedUser } from "../../core/models";
@Component({selector:"app-administration",imports:[DatePipe,FormsModule],template:`
<div class="page-head"><div><p class="eyebrow">Coordinación jurídica</p><h1>Administración y auditoría</h1><p class="muted">Activa o revoca accesos y consulta los cambios registrados.</p></div></div>
@if(error()){<div class="error" role="alert">{{error()}}</div>}@if(message()){<div class="success">{{message()}}</div>}
<section class="card"><h2>Usuarios</h2><div class="table-scroll"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Causas</th><th>Último acceso</th><th>Estado</th><th>Acción</th></tr></thead><tbody>@for(user of users();track user.id){<tr><td><strong>{{user.name}}</strong><small>{{user.email}}</small></td><td>{{role(user.role)}}</td><td>{{user.caseCount}}</td><td>{{user.lastLoginAt?(user.lastLoginAt|date:'dd/MM/yyyy HH:mm'):'Sin ingreso'}}</td><td>{{user.active?'Activo':'Revocado'}}</td><td><button class="text-button" (click)="toggle(user)">{{user.active?'Revocar':'Reactivar'}}</button></td></tr>}</tbody></table></div></section>
<section class="card"><h2>Auditoría reciente</h2><div class="field"><label for="audit-entity">Tipo</label><select id="audit-entity" name="entity" [ngModel]="entityFilter()" (ngModelChange)="filterAudit($event)"><option value="">Todos</option>@for(option of entityOptions;track option.value){<option [value]="option.value">{{option.label}}</option>}</select></div><ul class="timeline">@for(entry of audit();track entry.id){<li><strong>{{entry.occurredAt|date:'dd/MM/yyyy HH:mm'}} · {{entry.action}} {{entry.entityType}}</strong><p>{{entry.actorName||'Proceso del sistema'}} · {{entry.entityLabel||entry.entityId}}</p></li>}@empty{<li>Sin eventos registrados.</li>}</ul></section>`})
export class Administration{
 private api=inject(AdminService);readonly users=signal<ManagedUser[]>([]);readonly audit=signal<AuditEntry[]>([]);readonly error=signal("");readonly message=signal("");
 // HU-30: solo las entidades que la base audita (triggers de 004_domain_hardening.sql).
 readonly entityOptions=[{value:"users",label:"Usuarios"},{value:"cases",label:"Causas"},{value:"documents",label:"Documentos"}];
 readonly entityFilter=signal("");
 constructor(){this.load();}role(value:string){return value==="LAWYER"?"Abogado":value==="CLIENT"?"Cliente":"Coordinador";}
 filterAudit(value:string){this.entityFilter.set(value);this.loadAudit();}
 load(){this.api.users().subscribe({next:v=>this.users.set(v),error:e=>this.error.set(errorMessage(e))});this.loadAudit();}
 private loadAudit(){this.api.audit(this.entityFilter()||undefined).subscribe({next:v=>this.audit.set(v),error:e=>this.error.set(errorMessage(e))});}
 toggle(user:ManagedUser){if(!confirm(`${user.active?"Revocar":"Reactivar"} el acceso de ${user.name}?`))return;this.error.set("");this.api.setStatus(user.id,!user.active).subscribe({next:()=>{this.message.set("Estado de cuenta actualizado.");this.load();},error:e=>this.error.set(errorMessage(e))});}
}
