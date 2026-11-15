import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { errorMessage } from "../../core/auth.service";
import { CasesService } from "../../core/cases.service";
import { IngestionItem, LegalCase } from "../../core/models";
import { ProductService } from "../../core/product.service";

@Component({
  selector: "app-ingestion",
  imports: [FormsModule],
  template: `
    <div class="page-head"><div><p class="eyebrow">Revisión humana</p><h1>Bandeja de movimientos</h1><p class="muted">Procesa texto, correos, Excel o PDF. Nada se publica antes de tu confirmación.</p></div></div>
    @if(error()){<div class="error" role="alert">{{error()}}</div>}
    @if(message()){<div class="success" role="status">{{message()}}</div>}
    <section class="card">
      <h2>Nuevo movimiento judicial</h2>
      <div class="field"><label for="case">Causa</label><select id="case" [(ngModel)]="caseId"><option value="">Sin asociar</option>@for(c of cases();track c.id){<option [value]="c.id">{{c.reference}} · {{c.title}}</option>}</select></div>
      <fieldset class="priority-options"><legend>Origen</legend><label><input type="radio" name="mode" value="text" [(ngModel)]="mode"> Pegar texto o correo</label><label><input type="radio" name="mode" value="file" [(ngModel)]="mode"> Cargar PDF o Excel</label></fieldset>
      @if(mode==='text'){
        <form (ngSubmit)="ingestText()"><div class="field"><label for="source-name">Origen</label><input id="source-name" name="sourceName" [(ngModel)]="sourceName" required maxlength="255"></div><div class="field"><label for="source-text">Contenido</label><textarea id="source-text" name="text" [(ngModel)]="sourceText" rows="8" required minlength="10" maxlength="100000"></textarea></div><button class="button primary" [disabled]="busy()">{{busy()?'Analizando…':'Analizar texto'}}</button></form>
      } @else {
        <form (ngSubmit)="ingestFile()"><div class="field"><label for="source-file">Archivo judicial</label><input id="source-file" type="file" accept=".pdf,.xlsx,.txt,.eml,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,message/rfc822" (change)="selectFile($event)" required><small>Máximo 10 MB. Los PDF deben contener texto seleccionable; los documentos escaneados requieren OCR.</small></div><button class="button primary" [disabled]="busy()||!file">{{busy()?'Extrayendo…':'Cargar y analizar'}}</button></form>
      }
    </section>
    <div class="portfolio-grid">@for(i of items();track i.id){<article class="card"><p class="eyebrow">{{i.sourceType}} · {{i.status}}</p><h2>{{i.movementType||'Movimiento detectado'}}</h2><p>{{i.detectedReference||'Sin referencia'}} · {{i.detectedCourt||'Tribunal no detectado'}}</p><textarea #summary rows="6">{{i.correctedSummary||i.suggestedSummary}}</textarea>@if(i.status==='PENDING'){<div class="form-actions"><button class="button primary" (click)="review(i,'CONFIRMED',summary.value)">Confirmar y publicar</button><button class="button" (click)="review(i,'REJECTED',summary.value)">Rechazar</button></div>}</article>}@empty{<section class="card">No hay movimientos procesados.</section>}</div>
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
  mode:"text"|"file"="text";
  sourceName="Correo del Poder Judicial";
  caseId="";
  sourceText="";
  file?:File;
  constructor(){this.load();this.casesApi.list().subscribe(v=>this.cases.set(v));}
  load(){this.api.ingestion().subscribe({next:v=>this.items.set(v),error:e=>this.error.set(errorMessage(e))});}
  private start(){this.busy.set(true);this.error.set("");this.message.set("");}
  private completed(message:string){this.busy.set(false);this.message.set(message);this.load();}
  ingestText(){if(this.sourceText.trim().length<10||this.busy())return;this.start();this.api.ingestText({sourceType:"EMAIL",sourceName:this.sourceName,text:this.sourceText,caseId:this.caseId||undefined}).subscribe({next:()=>{this.sourceText="";this.completed("Movimiento analizado y agregado a la bandeja.");},error:e=>{this.busy.set(false);this.error.set(errorMessage(e));}});}
  selectFile(event:Event){this.file=(event.target as HTMLInputElement).files?.[0];}
  ingestFile(){if(!this.file||this.busy())return;this.start();this.api.ingestFile(this.file,this.caseId||undefined).subscribe({next:()=>{this.file=undefined;this.completed("Archivo procesado y agregado a la bandeja.");},error:e=>{this.busy.set(false);this.error.set(errorMessage(e));}});}
  review(item:IngestionItem,status:string,summary:string){this.api.review(item.id,status,summary).subscribe({next:()=>this.load(),error:e=>this.error.set(errorMessage(e))});}
}
