import { Component, inject, signal } from "@angular/core";
import { ProfileSummary } from "../../core/models";
import { FormsModule } from "@angular/forms";
import { AuthService } from "../../core/auth.service";
import { errorMessage } from "../../core/auth.service";
import { ProductService } from "../../core/product.service";
import { Router } from "@angular/router";
@Component({
  selector: "app-profile",
  imports:[FormsModule],
  template:`<div class="page-head"><div><p class="eyebrow">Tu cuenta</p><h1>Mi perfil y seguridad</h1><p class="muted">Actualiza tus datos y protege el acceso.</p></div></div>
@if(auth.user()?.mustChangePassword){<div class="error" role="alert"><strong>Cambio obligatorio:</strong> usa la contraseña temporal recibida y define una nueva antes de acceder a tus causas.</div>}
@if(message()){<div class="success" role="status">{{message()}}</div>} @if(error()){<div class="error" role="alert">{{error()}}</div>}
@if(summary(); as info){<section class="card corporation-card" aria-labelledby="corporation-title"><h2 id="corporation-title">Información de la corporación</h2>
<dl><div><dt>Corporación</dt><dd>{{info.corporation}}</dd></div>@if(info.office){<div><dt>Oficina</dt><dd>{{info.office}}</dd></div>}
<div><dt>Causas activas</dt><dd>{{info.activeCases}}</dd></div><div><dt>Miembro desde</dt><dd>{{memberSince(info.memberSince)}}</dd></div></dl>
@if(info.lawyers.length){<h3>{{info.lawyers.length===1?'Abogado asignado':'Abogados asignados'}}</h3><ul class="plain-list">@for(lawyer of info.lawyers;track lawyer.email){<li><strong>{{lawyer.name}}</strong><br><small>{{lawyer.email}}@if(lawyer.phone){ · {{lawyer.phone}}}</small></li>}</ul>}</section>}
<div class="detail-grid"><form class="card" (ngSubmit)="saveProfile()"><h2>Datos de contacto</h2>
<div class="field"><label for="profile-name">Nombre</label><input id="profile-name" name="name" [(ngModel)]="name" required minlength="3"></div>
<div class="field"><label for="profile-email">Correo</label><input id="profile-email" name="email" type="email" [(ngModel)]="email" required></div>
<div class="field"><label for="profile-phone">Teléfono</label><input id="profile-phone" name="phone" [(ngModel)]="phone" placeholder="+56 9…"></div><button class="button primary" [disabled]="busy()">Guardar perfil</button></form>
<form class="card" (ngSubmit)="changePassword()"><h2>{{auth.user()?.mustChangePassword?'Cambia tu contraseña temporal':'Cambiar contraseña'}}</h2>
<div class="field"><label for="current-password">Contraseña actual</label><input id="current-password" name="current" type="password" [(ngModel)]="currentPassword" required></div>
<div class="field"><label for="new-password">Nueva contraseña</label><input id="new-password" name="new" type="password" [(ngModel)]="newPassword" required minlength="12"><small>Al menos 12 caracteres.</small></div><button class="button primary" [disabled]="busy()">Actualizar contraseña</button></form></div>`,
})
export class Profile {
  readonly auth = inject(AuthService);
  private router=inject(Router);
  private api=inject(ProductService);readonly busy=signal(false);readonly error=signal("");readonly message=signal("");
  readonly summary=signal<ProfileSummary|null>(null);
  constructor(){
    // Los datos de la corporación son informativos: si fallan (por ejemplo, durante el cambio obligatorio), el formulario sigue disponible.
    if(!this.auth.user()?.mustChangePassword)this.api.profileSummary().subscribe({next:v=>this.summary.set(v),error:()=>this.summary.set(null)});
  }
  memberSince(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?"—":new Intl.DateTimeFormat("es-CL",{month:"long",year:"numeric"}).format(date);}
  name=this.auth.user()?.name||"";email=this.auth.user()?.email||"";phone=this.auth.user()?.phone||"";currentPassword="";newPassword="";
  saveProfile(){if(this.busy())return;this.busy.set(true);this.clear();this.api.updateProfile({name:this.name,email:this.email,phone:this.phone}).subscribe({next:u=>{this.auth.user.set(u);this.busy.set(false);this.message.set("Perfil actualizado.");},error:e=>this.fail(e)});}
  changePassword(){if(this.busy()||this.newPassword.length<12)return;this.busy.set(true);this.clear();this.auth.changePassword(this.currentPassword,this.newPassword).subscribe({next:()=>{this.busy.set(false);this.auth.user.set(null);void this.router.navigate(["/iniciar-sesion"],{queryParams:{passwordChanged:"true"}});},error:e=>this.fail(e)});}
  private clear(){this.error.set("");this.message.set("");} private fail(e:any){this.busy.set(false);this.error.set(errorMessage(e));}
}
