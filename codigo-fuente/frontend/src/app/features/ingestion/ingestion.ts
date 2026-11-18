import { DatePipe } from "@angular/common";
import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { MOVEMENT_LABELS, SOURCE_TYPE_LABELS, label } from "../../core/labels";
import { errorMessage } from "../../core/auth.service";
import { CasesService } from "../../core/cases.service";
import { IngestionItem, LegalCase } from "../../core/models";
import { ProductService } from "../../core/product.service";

/** Valores que el abogado puede corregir antes de publicar (CU-02). */
interface ReviewDraft { caseId:string; movementType:string; date:string; time:string; court:string; summary:string; }

const STATUS_LABELS: Record<string,string> = { PENDING:"Pendiente", CONFIRMED:"Confirmado", REJECTED:"Rechazado" };
const CONFIDENCE_LABELS: Record<string,string> = { ALTA:"Confianza alta", MEDIA:"Confianza media", BAJA:"Confianza baja" };

@Component({
  selector: "app-ingestion",
  imports: [DatePipe, FormsModule, RouterLink],
  styles: [`
    .warning { background:#f6ecd4; border:1px solid #d9bf85; border-radius:6px; padding:14px 18px; margin-bottom:20px; color:#5c4513; }
    .success { background:#e3eedd; border:1px solid #a9c79a; border-radius:6px; padding:14px 18px; margin-bottom:20px; color:#2f4f22; }
    .badges { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 12px; }
    .review-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:0 16px; }
  `],
  template: `
    <div class="page-head"><div><p class="eyebrow">Revisión humana</p><h1>Bandeja de movimientos</h1><p class="muted">Procesa texto, correos, Excel o PDF. Nada se publica antes de tu confirmación.</p></div></div>
    @if(error()){<div class="error" role="alert">{{error()}}</div>}
    @if(message()){<div class="success" role="status">{{message()}}@if(confirmedCaseId(); as caseId){ <a [routerLink]="['/causas',caseId]">Ver causa</a>}</div>}
    @if(unrecognized()>0){
      <div class="warning" role="status">
        <strong>{{unrecognized()}} {{unrecognized()===1?'movimiento pendiente no tiene':'movimientos pendientes no tienen'}} un formato reconocible.</strong>
        Completa los datos a mano. Si se repite con avisos que antes se leían bien, es posible que el Poder Judicial haya cambiado el formato.
      </div>
    }
    <section class="card">
      <h2>Nuevo movimiento judicial</h2>
      <div class="field"><label for="case">Causa</label><select id="case" [(ngModel)]="caseId"><option value="">Detectar por RIT o referencia</option>@for(c of cases();track c.id){<option [value]="c.id">{{c.reference}} · {{c.title}}</option>}</select></div>
      <fieldset class="priority-options"><legend>Origen</legend><label><input type="radio" name="mode" value="text" [(ngModel)]="mode"> Pegar texto o correo</label><label><input type="radio" name="mode" value="file" [(ngModel)]="mode"> Cargar PDF o Excel</label></fieldset>
      @if(mode==='text'){
        <form (ngSubmit)="ingestText()"><div class="field"><label for="source-name">Origen</label><input id="source-name" name="sourceName" [(ngModel)]="sourceName" required maxlength="255"></div><div class="field"><label for="source-text">Contenido</label><textarea id="source-text" name="text" [(ngModel)]="sourceText" rows="8" required minlength="10" maxlength="100000"></textarea></div><button class="button primary" [disabled]="busy()">{{busy()?'Analizando…':'Analizar texto'}}</button></form>
      } @else {
        <form (ngSubmit)="ingestFile()"><div class="field"><label for="source-file">Archivo judicial</label><input id="source-file" type="file" accept=".pdf,.xlsx,.txt,.eml,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,message/rfc822" (change)="selectFile($event)" required><small>Máximo 10 MB. En un Excel cada fila se procesa como un movimiento. Los PDF deben contener texto seleccionable; los documentos escaneados requieren OCR.</small></div><button class="button primary" [disabled]="busy()||!file">{{busy()?'Extrayendo…':'Cargar y analizar'}}</button></form>
      }
    </section>
    <div class="portfolio-grid">
      @for(i of items();track i.id){
        <article class="card">
          <p class="eyebrow">{{sourceLabel(i.sourceType)}} · {{statusLabel(i.status)}} · {{i.createdAt|date:'dd/MM/yyyy HH:mm'}}</p>
          <h2>{{i.movementType?movementLabel(i.movementType):'Movimiento detectado'}}</h2>
          @if(i.caseReference){<p class="muted">Causa {{i.caseReference}}@if(i.clientName){ · {{i.clientName}}}</p>}
          <div class="badges">
            <span class="badge" [class.high]="i.confidence==='BAJA'">{{confidenceLabel(i.confidence)}}</span>
            <span class="badge">{{i.suggestionSource==='IA'?'Sugerencia de IA':'Sugerencia por reglas'}}</span>
            @if(!i.formatRecognized){<span class="badge high">Formato no reconocido</span>}
            @if(i.edited){<span class="badge">Editado por el abogado</span>}
          </div>
          <p class="muted">{{i.sourceName}} · Referencia detectada: {{i.detectedReference||'ninguna'}}</p>
          @if(i.missingFields.length){<p class="validation">No se detectó: {{i.missingFields.join(', ')}}.</p>}
          @if(i.sourceText){<details class="source-text" [open]="i.status==='PENDING'"><summary>Texto original del aviso</summary><pre>{{i.sourceText}}@if(i.sourceTruncated){…}</pre>@if(i.sourceTruncated){<small class="muted">Se muestran los primeros 5.000 caracteres.</small>}</details>}
          @if(i.status==='PENDING' && drafts[i.id]; as d){
            <form (ngSubmit)="review(i,'CONFIRMED')">
              <div class="field"><label [for]="'case-'+i.id">Causa</label>
                <select [id]="'case-'+i.id" [name]="'case-'+i.id" [(ngModel)]="d.caseId"><option value="">Sin asociar</option>@for(c of cases();track c.id){<option [value]="c.id">{{c.reference}} · {{c.title}}</option>}</select>
                @if(!d.caseId){<small class="validation">Asocia una causa para poder publicar el movimiento.</small>}
              </div>
              <div class="review-grid">
                <div class="field"><label [for]="'type-'+i.id">Tipo</label><select [id]="'type-'+i.id" [name]="'type-'+i.id" [(ngModel)]="d.movementType">@for(t of movementTypes;track t){<option [value]="t">{{movementLabel(t)}}</option>}</select></div>
                <div class="field"><label [for]="'date-'+i.id">Nueva fecha</label><input [id]="'date-'+i.id" [name]="'date-'+i.id" type="date" [(ngModel)]="d.date"></div>
                <div class="field"><label [for]="'time-'+i.id">Hora</label><input [id]="'time-'+i.id" [name]="'time-'+i.id" type="time" [(ngModel)]="d.time"></div>
              </div>
              @if(caseNextDate(d.caseId); as current){<p class="muted reference-date">Fecha actual de la causa (referencia): {{current.date|date:'dd/MM/yyyy':'UTC'}}@if(current.label){ · {{current.label}}}</p>}
              <div class="field"><label [for]="'court-'+i.id">Tribunal</label><input [id]="'court-'+i.id" [name]="'court-'+i.id" maxlength="200" [(ngModel)]="d.court"></div>
              <div class="field"><label [for]="'summary-'+i.id">Resumen para el cliente</label><textarea [id]="'summary-'+i.id" [name]="'summary-'+i.id" rows="6" minlength="10" maxlength="2000" [(ngModel)]="d.summary"></textarea></div>
              <div class="form-actions">
                <button class="button primary" [disabled]="!d.caseId||reviewing()===i.id">Confirmar y publicar</button>
                <button type="button" class="button" [disabled]="reviewing()===i.id" (click)="review(i,'REJECTED')">Rechazar</button>
              </div>
            </form>
          } @else {
            <p>{{i.caseReference?('Causa '+i.caseReference):'Sin causa asociada'}} · {{i.detectedDate?(i.detectedDate|date:'dd/MM/yyyy':'UTC'):'Sin fecha'}}{{i.detectedTime?(' '+i.detectedTime):''}} · {{i.detectedCourt||'Tribunal no detectado'}}</p>
            <p>{{i.correctedSummary||i.suggestedSummary}}</p>
          }
        </article>
      }@empty{<section class="card">No hay movimientos procesados.</section>}
    </div>
  `,
})
export class Ingestion {
  private readonly api=inject(ProductService);
  private readonly casesApi=inject(CasesService);
  readonly items=signal<IngestionItem[]>([]);
  readonly cases=signal<LegalCase[]>([]);
  readonly error=signal("");
  readonly message=signal("");
  readonly busy=signal(false);
  readonly reviewing=signal<string|null>(null);
  /** Causa del último movimiento confirmado, para ofrecer "Ver causa" (mockup 11). */
  readonly confirmedCaseId=signal<string|null>(null);
  readonly unrecognized=computed(()=>this.items().filter(i=>i.status==="PENDING"&&!i.formatRecognized).length);
  readonly movementTypes=["AUDIENCIA","RESOLUCIÓN","SENTENCIA","NOTIFICACIÓN","MOVIMIENTO"];
  drafts:Record<string,ReviewDraft>={};
  mode:"text"|"file"="text";
  sourceName="Correo del Poder Judicial";
  caseId="";
  sourceText="";
  file?:File;
  constructor(){this.load();this.casesApi.list().subscribe(v=>this.cases.set(v.filter(c=>c.status!=="Archivada")));}
  statusLabel(status:string){return STATUS_LABELS[status]??status;}
  confidenceLabel(confidence:string){return CONFIDENCE_LABELS[confidence]??confidence;}
  movementLabel(type:string){return label(MOVEMENT_LABELS,type);}
  sourceLabel(type:string){return label(SOURCE_TYPE_LABELS,type);}
  /** Mockup 11: la próxima fecha que hoy tiene la causa, para compararla con la nueva (no editable). */
  caseNextDate(caseId:string){const c=this.cases().find(item=>item.id===caseId);return c?.nextDate?{date:c.nextDate,label:c.nextDateLabel??""}:null;}
  load(){this.api.ingestion().subscribe({next:v=>{
    // Conserva lo que el abogado ya corrigió en movimientos que siguen pendientes.
    const drafts:Record<string,ReviewDraft>={};
    for(const i of v) if(i.status==="PENDING") drafts[i.id]=this.drafts[i.id]??{caseId:i.caseId??"",movementType:i.movementType,date:i.detectedDate??"",time:i.detectedTime??"",court:i.detectedCourt??"",summary:i.correctedSummary||i.suggestedSummary};
    this.drafts=drafts;this.items.set(v);
  },error:e=>this.error.set(errorMessage(e))});}
  private start(){this.busy.set(true);this.error.set("");this.message.set("");this.confirmedCaseId.set(null);}
  private completed(message:string){this.busy.set(false);this.message.set(message);this.load();}
  ingestText(){if(this.sourceText.trim().length<10||this.busy())return;this.start();this.api.ingestText({sourceType:"EMAIL",sourceName:this.sourceName,text:this.sourceText,caseId:this.caseId||undefined}).subscribe({next:()=>{this.sourceText="";this.completed("Movimiento analizado y agregado a la bandeja.");},error:e=>{this.busy.set(false);this.error.set(errorMessage(e));}});}
  selectFile(event:Event){this.file=(event.target as HTMLInputElement).files?.[0];}
  ingestFile(){if(!this.file||this.busy())return;this.start();this.api.ingestFile(this.file,this.caseId||undefined).subscribe({next:(result:any)=>{this.file=undefined;this.completed(typeof result?.count==="number"?`Planilla procesada: ${result.count} movimientos agregados a la bandeja.`:"Archivo procesado y agregado a la bandeja.");},error:e=>{this.busy.set(false);this.error.set(errorMessage(e));}});}
  review(item:IngestionItem,status:"CONFIRMED"|"REJECTED"){
    const d=this.drafts[item.id];if(!d||this.reviewing())return;
    if(status==="CONFIRMED"&&!d.caseId){this.error.set("Asocia una causa antes de confirmar el movimiento.");return;}
    this.reviewing.set(item.id);this.error.set("");this.message.set("");this.confirmedCaseId.set(null);
    const summary=d.summary.trim();
    this.api.review(item.id,{status,caseId:d.caseId||undefined,movementType:d.movementType,detectedDate:d.date||null,detectedTime:d.time||null,court:d.court.trim()||null,summary:summary.length>=10?summary:undefined}).subscribe({
      next:()=>{this.reviewing.set(null);
        if(status==="CONFIRMED"){const ref=this.cases().find(c=>c.id===d.caseId)?.reference;this.message.set(`Movimiento confirmado: se agregó a la línea de tiempo${ref?` de la causa ${ref}`:""} y quedó visible para el cliente.`);this.confirmedCaseId.set(d.caseId);}
        else this.message.set("Movimiento rechazado; no se publicó.");
        this.load();},
      error:e=>{this.reviewing.set(null);this.error.set(errorMessage(e));},
    });
  }
}
