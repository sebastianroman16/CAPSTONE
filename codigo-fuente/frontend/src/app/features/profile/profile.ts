import { Component, inject } from "@angular/core";
import { AuthService } from "../../core/auth.service";
@Component({
  selector: "app-profile",
  template: `<div class="page-head">
      <div>
        <p class="eyebrow">Tu cuenta</p>
        <h1>Mi perfil</h1>
        <p class="muted">Información de tu acceso a LEX-CORPUS.</p>
      </div>
    </div>
    <section class="card">
      <dl>
        <div>
          <dt>Nombre</dt>
          <dd>{{ auth.user()?.name }}</dd>
        </div>
        <div>
          <dt>Correo electrónico</dt>
          <dd>{{ auth.user()?.email }}</dd>
        </div>
        <div>
          <dt>Rol</dt>
          <dd>{{ auth.roleLabel() }}</dd>
        </div>
      </dl>
    </section>`,
})
export class Profile {
  readonly auth = inject(AuthService);
}
