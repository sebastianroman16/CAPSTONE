import { DatePipe } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { errorMessage } from "../../core/auth.service";
import { AppNotification } from "../../core/models";
import { ProductService } from "../../core/product.service";
import { CHANNEL_LABELS, label } from "../../core/labels";

export const NOTIFICATIONS_PAGE_SIZE = 30;

// E24: lista paginada por cursor; "Cargar más" pide las anteriores a la última recibida.
@Component({selector:"app-notifications",imports:[DatePipe,RouterLink],template:`<div class="page-head"><div><p class="eyebrow">Actualizaciones</p><h1>Notificaciones</h1></div></div>@if(error()){<div class="error" role="alert">{{error()}}</div>}<div class="portfolio-grid">@for(n of items();track n.id){<article class="card" [class.unread]="!n.readAt"><p class="eyebrow">{{n.createdAt|date:'dd/MM/yyyy HH:mm'}} · {{channelLabel(n.channel)}}</p><h2>{{n.title}}</h2><p>{{n.body}}</p>@if(n.caseId){<a [routerLink]="['/causas',n.caseId]">Abrir causa</a>}@if(!n.readAt){<button class="text-button" (click)="read(n)">Marcar leída</button>}</article>}@empty{@if(!loading()){<section class="card">No tienes notificaciones.</section>}}</div>@if(loading()){<p role="status">Cargando notificaciones…</p>}@else if(hasMore()){<div class="form-actions"><button class="button" (click)="loadMore()">Cargar más</button></div>}`})
export class Notifications{
  channelLabel(channel:string){return label(CHANNEL_LABELS,channel);}
  private api=inject(ProductService);
  readonly items=signal<AppNotification[]>([]);
  readonly error=signal("");
  readonly loading=signal(false);
  readonly hasMore=signal(false);
  constructor(){this.load();}
  load(){this.items.set([]);this.fetch();}
  loadMore(){const last=this.items().at(-1);if(last&&!this.loading())this.fetch(last);}
  private fetch(after?:AppNotification){
    this.loading.set(true);this.error.set("");
    this.api.notifications(NOTIFICATIONS_PAGE_SIZE,after).subscribe({
      next:page=>{this.items.update(list=>[...list,...page.filter(n=>!list.some(existing=>existing.id===n.id))]);this.hasMore.set(page.length===NOTIFICATIONS_PAGE_SIZE);this.loading.set(false);},
      error:e=>{this.error.set(errorMessage(e));this.loading.set(false);},
    });
  }
  read(n:AppNotification){this.api.readNotification(n.id).subscribe({next:r=>this.items.update(list=>list.map(item=>item.id===n.id?{...item,readAt:r?.readAt??new Date().toISOString()}:item)),error:e=>this.error.set(errorMessage(e))});}
}
