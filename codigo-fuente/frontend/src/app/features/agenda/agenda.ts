import { DatePipe } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { errorMessage } from "../../core/auth.service";
import { Deadline } from "../../core/models";
import { ProductService } from "../../core/product.service";

/** Fecha local AAAA-MM-DD: toISOString() usaría UTC y desde las 21:00 en Chile mostraría el día siguiente. */
export function localDate(offsetDays = 0, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

@Component({selector:"app-agenda",imports:[DatePipe,FormsModule,RouterLink],template:`<div class="page-head"><div><p class="eyebrow">Organización</p><h1>Pendientes y recordatorios</h1></div></div><section class="card"><div class="form-grid"><div class="field"><label for="from">Desde</label><input id="from" type="date" [(ngModel)]="from"></div><div class="field"><label for="to">Hasta</label><input id="to" type="date" [(ngModel)]="to"></div></div><button class="button" (click)="load()">Actualizar</button></section>@if(error()){<div class="error">{{error()}}</div>}@if(loading()){<p role="status">Cargando…</p>}@else{@if(overdue().length){<section class="card"><h2>{{overdue().length}} vencidos sin realizar</h2><ul class="timeline">@for(item of overdue();track item.id){<li><strong>{{item.dueAt|date:'dd/MM/yyyy HH:mm'}} · {{item.title}}</strong> <span class="badge" [class.high]="item.urgency==='Alta'">Urgencia {{item.urgency.toLowerCase()}}</span><p>{{item.reference}} · {{item.caseTitle}}</p><a [routerLink]="['/causas',item.caseId]">Abrir causa</a> <button class="text-button" (click)="complete(item)">Marcar realizado</button></li>}</ul></section>}<section class="card"><h2>{{items().length}} pendientes</h2><ul class="timeline">@for(item of items();track item.id){<li><strong>{{item.dueAt|date:'dd/MM/yyyy HH:mm'}} · {{item.title}}</strong> <span class="badge" [class.high]="item.urgency==='Alta'">Urgencia {{item.urgency.toLowerCase()}}</span><p>{{item.reference}} · {{item.caseTitle}}</p><p>{{item.description}}</p>@if(item.reminderAt){<p class="muted">Recordatorio: {{item.reminderAt|date:'dd/MM/yyyy HH:mm'}}</p>}<a [routerLink]="['/causas',item.caseId]">Abrir causa</a> @if(item.status==='PENDING'){<button class="text-button" (click)="complete(item)">Marcar realizado</button>}</li>}@empty{<li>Sin pendientes en este periodo.</li>}</ul></section>}`})
export class Agenda{
  private api=inject(ProductService);
  readonly items=signal<Deadline[]>([]);
  readonly overdue=signal<Deadline[]>([]);
  readonly loading=signal(true);
  readonly error=signal("");
  from=localDate();
  to=localDate(7);
  constructor(){this.load();}
  load(){
    this.loading.set(true);this.error.set("");
    this.api.agenda(this.from,this.to).subscribe({next:v=>{this.items.set(v);this.loading.set(false);},error:e=>{this.error.set(errorMessage(e));this.loading.set(false);}});
    // Los plazos vencidos y no realizados se muestran aparte para que no queden ocultos.
    const today=localDate();
    this.api.agenda("2000-01-01",today).subscribe({next:v=>this.overdue.set(v.filter(item=>item.status==="PENDING"&&new Date(item.dueAt).getTime()<Date.now())),error:e=>this.error.set(errorMessage(e))});
  }
  complete(i:Deadline){this.api.deadlineStatus(i.id,"COMPLETED").subscribe({next:()=>this.load(),error:e=>this.error.set(errorMessage(e))});}
}
