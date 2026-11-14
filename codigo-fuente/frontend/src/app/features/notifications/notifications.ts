import { DatePipe } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { errorMessage } from "../../core/auth.service";
import { AppNotification } from "../../core/models";
import { ProductService } from "../../core/product.service";
@Component({selector:"app-notifications",imports:[DatePipe,RouterLink],template:`<div class="page-head"><div><p class="eyebrow">Actualizaciones</p><h1>Notificaciones</h1></div></div>@if(error()){<div class="error">{{error()}}</div>}<div class="portfolio-grid">@for(n of items();track n.id){<article class="card" [class.unread]="!n.readAt"><p class="eyebrow">{{n.createdAt|date:'dd/MM/yyyy HH:mm'}} · {{n.channel}}</p><h2>{{n.title}}</h2><p>{{n.body}}</p>@if(n.caseId){<a [routerLink]="['/causas',n.caseId]">Abrir causa</a>}@if(!n.readAt){<button class="text-button" (click)="read(n)">Marcar leída</button>}</article>}@empty{<section class="card">No tienes notificaciones.</section>}</div>`})
export class Notifications{private api=inject(ProductService);readonly items=signal<AppNotification[]>([]);readonly error=signal("");constructor(){this.load();}load(){this.api.notifications().subscribe({next:v=>this.items.set(v),error:e=>this.error.set(errorMessage(e))});}read(n:AppNotification){this.api.readNotification(n.id).subscribe({next:()=>this.load(),error:e=>this.error.set(errorMessage(e))});}}
