import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { AuthService } from "../../core/auth.service";
import { errorMessage } from "../../core/auth.service";
import { ProductService } from "../../core/product.service";
@Component({
  selector: "app-profile",
  imports:[FormsModule],
  template:`<div class="page-head"><div><p class="eyebrow">Tu cuenta</p><h1>Mi perfil y seguridad</h1><p class="muted">Actualiza tus datos y protege el acceso.</p></div></div>
@if(message()){<div class="success" role="status">{{message()}}</div>} @if(error()){<div class="error" role="alert">{{error()}}</div>}
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
  private api=inject(ProductService);readonly busy=signal(false);readonly error=signal("");readonly message=signal("");
  name=this.auth.user()?.name||"";email=this.auth.user()?.email||"";phone=this.auth.user()?.phone||"";currentPassword="";newPassword="";
  saveProfile(){if(this.busy())return;this.busy.set(true);this.clear();this.api.updateProfile({name:this.name,email:this.email,phone:this.phone}).subscribe({next:u=>{this.auth.user.set(u);this.busy.set(false);this.message.set("Perfil actualizado.");},error:e=>this.fail(e)});}
  changePassword(){if(this.busy()||this.newPassword.length<12)return;this.busy.set(true);this.clear();this.auth.changePassword(this.currentPassword,this.newPassword).subscribe({next:()=>{this.busy.set(false);this.currentPassword="";this.newPassword="";this.message.set("Contraseña actualizada.");},error:e=>this.fail(e)});}
  private clear(){this.error.set("");this.message.set("");} private fail(e:any){this.busy.set(false);this.error.set(errorMessage(e));}
}
