import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { AuthService, errorMessage } from "../../core/auth.service";

// Misma estructura visual que el inicio de sesión (login.css): panel de marca y tarjeta centrada.
@Component({
  selector: "app-password-recovery",
  imports: [FormsModule, RouterLink],
  styleUrl: "./login.css",
  template: `
    <div class="stage">
      <section class="brand">
        <div>
          <div class="wordmark">LEX<span>·</span>CORPUS</div>
          <p class="brand-tag">
            Organización y comunicación para abogados de asistencia judicial.
            Complementa al SAJ.
          </p>
        </div>
        <div class="brand-quote">
          <p>“Dura lex, sed lex.”</p>
          <span>La ley es dura, pero es la ley</span>
        </div>
        <p class="brand-foot">LEX-CORPUS · Acceso restringido</p>
      </section>
      <section class="panel">
        <div class="login-card">
          <p class="eyebrow">Seguridad de acceso</p>
          <h1>{{ token ? "Definir nueva contraseña" : "Recuperar contraseña" }}</h1>
          @if (message()) {
          <div class="success" role="status">{{ message() }}</div>
          } @if (error()) {
          <div class="error" role="alert">{{ error() }}</div>
          } @if (!done()) {
          <form (ngSubmit)="submit()">
            @if (!token) {
            <div class="field">
              <label for="recover-email">Correo electrónico</label>
              <input id="recover-email" name="email" type="email" [(ngModel)]="email" required placeholder="nombre@ejemplo.cl" />
            </div>
            } @else {
            <div class="field">
              <label for="recover-password">Nueva contraseña</label>
              <input id="recover-password" name="password" type="password" [(ngModel)]="password" minlength="12" required />
              <small>Al menos 12 caracteres.</small>
            </div>
            }
            <button class="button primary full" type="submit" [disabled]="busy()">
              {{ busy() ? "Procesando…" : token ? "Guardar contraseña" : "Enviar enlace" }}
            </button>
          </form>
          }
          <p><a routerLink="/iniciar-sesion">Volver a iniciar sesión</a></p>
        </div>
      </section>
    </div>
  `,
})
export class PasswordRecovery {
  private auth = inject(AuthService);
  token = inject(ActivatedRoute).snapshot.queryParamMap.get("token") || "";
  email = "";
  password = "";
  readonly busy = signal(false);
  readonly error = signal("");
  readonly message = signal("");
  readonly done = signal(false);

  submit() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set("");
    const request = this.token
      ? this.auth.resetPassword(this.token, this.password)
      : this.auth.forgotPassword(this.email);
    request.subscribe({
      next: (r: any) => {
        this.busy.set(false);
        this.done.set(true);
        this.message.set(
          this.token
            ? "Contraseña actualizada. Ya puedes iniciar sesión."
            : r.developmentToken
              ? `Entorno local: token de recuperación ${r.developmentToken}`
              : "Si la cuenta existe, recibirás las instrucciones.",
        );
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }
}
