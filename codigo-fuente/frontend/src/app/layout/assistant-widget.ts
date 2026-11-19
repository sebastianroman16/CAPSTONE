import { Component,ElementRef,inject,signal,ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { AssistantApi } from "../core/assistant.service";
import { errorMessage } from "../core/auth.service";
import { AssistantMessage } from "../core/models";
@Component({selector:"app-assistant-widget",imports:[FormsModule],template:`
<div class="lexi-widget" [class.open]="open()">
 @if(open()){
  <section id="lexi-chat" class="lexi-chat" role="dialog" aria-modal="false" aria-labelledby="lexi-title">
   <header class="lexi-header"><div class="lexi-mini" aria-hidden="true"><span>§</span></div><div><strong id="lexi-title">Lexi</strong><small>Asistente informativo simulado</small></div><button type="button" class="lexi-close" (click)="open.set(false)" aria-label="Cerrar asistente">×</button></header>
   <div class="lexi-disclaimer">Responde desde una base revisada. No entrega asesoría jurídica.</div>
   <div class="lexi-messages" #messages aria-live="polite">
    @if(loading()){<p class="lexi-status">Cargando conversación…</p>}
    @if(!loading()&&!items().length){<div class="lexi-message assistant"><p>¡Hola! Soy Lexi. Puedo ayudarte a usar LEX-CORPUS. Prueba preguntando por causas, documentos, agenda o contraseñas.</p></div>}
    @for(item of items();track $index){<div class="lexi-message" [class.user]="item.role==='USER'" [class.assistant]="item.role==='ASSISTANT'"><span>{{item.role==='USER'?'Tú':'Lexi'}}</span><p>{{item.content}}</p></div>}
   </div>
   @if(error()){<div class="lexi-error" role="alert">{{error()}}</div>}
   @if(items().length<2){<div class="lexi-suggestions"><button type="button" (click)="useSuggestion('¿Cómo importo causas desde Excel?')">Importar Excel</button><button type="button" (click)="useSuggestion('¿Cómo recupero mi contraseña?')">Recuperar acceso</button><button type="button" (click)="useSuggestion('¿Dónde veo los documentos?')">Documentos</button></div>}
   <form class="lexi-form" (ngSubmit)="send()"><label class="sr-only" for="lexi-question">Pregunta para Lexi</label><textarea id="lexi-question" name="question" [(ngModel)]="question" rows="2" maxlength="500" placeholder="Escribe tu pregunta…" (keydown.enter)="enter($event)" [disabled]="sending()||quota().remaining===0"></textarea><button type="submit" class="button primary" [disabled]="sending()||question.trim().length<2||quota().remaining===0">{{sending()?'…':'Enviar'}}</button></form>
   <footer class="lexi-footer"><span>{{quota().remaining}} de {{quota().limit}} preguntas disponibles hoy</span><button type="button" class="text-button" (click)="newConversation()">Nueva conversación</button></footer>
  </section>
 }
 <button type="button" class="lexi-character" (click)="toggle()" [attr.aria-expanded]="open()" aria-controls="lexi-chat" aria-label="Abrir asistente Lexi"><span class="lexi-hair" aria-hidden="true"></span><span class="lexi-face" aria-hidden="true"><i></i><b>⌣</b><i></i></span><span class="lexi-body" aria-hidden="true">§</span>@if(!open()){<span class="lexi-callout">¿Necesitas ayuda?</span>}</button>
</div>`})
export class AssistantWidget{
 private api=inject(AssistantApi);readonly open=signal(false);readonly loading=signal(false);readonly sending=signal(false);readonly error=signal("");readonly items=signal<AssistantMessage[]>([]);readonly quota=signal({limit:20,used:0,remaining:20});question="";private loaded=false;@ViewChild("messages")messages?:ElementRef<HTMLElement>;
 toggle(){this.open.set(!this.open());if(this.open()&&!this.loaded)this.load();setTimeout(()=>this.scroll(),0);}
 load(){this.loading.set(true);this.api.session().subscribe({next:r=>{this.items.set(r.messages);this.quota.set(r.quota);this.loading.set(false);this.loaded=true;setTimeout(()=>this.scroll(),0);},error:e=>{this.loading.set(false);this.error.set(errorMessage(e));}});}
 send(){const value=this.question.trim();if(value.length<2||this.sending()||!this.quota().remaining)return;this.question="";this.error.set("");this.items.update(v=>[...v,{role:"USER",content:value}]);this.sending.set(true);setTimeout(()=>this.scroll(),0);this.api.ask(value).subscribe({next:r=>{this.items.update(v=>[...v,{role:"ASSISTANT",content:r.content,confidence:r.confidence,createdAt:r.createdAt}]);this.quota.set(r.quota);this.sending.set(false);setTimeout(()=>this.scroll(),0);},error:e=>{this.sending.set(false);this.error.set(errorMessage(e));}});}
 enter(event:Event){const keyboard=event as KeyboardEvent;if(!keyboard.shiftKey){event.preventDefault();this.send();}}
 useSuggestion(value:string){this.question=value;this.send();}
 newConversation(){if(this.sending())return;this.api.newConversation().subscribe({next:r=>{this.items.set([]);this.quota.set(r.quota);this.error.set("");},error:e=>this.error.set(errorMessage(e))});}
 private scroll(){const el=this.messages?.nativeElement;if(el)el.scrollTop=el.scrollHeight;}
}
