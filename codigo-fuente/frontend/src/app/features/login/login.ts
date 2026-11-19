import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { AuthService, errorMessage } from "../../core/auth.service";
@Component({
  selector: "app-login",
  imports: [ReactiveFormsModule],
  templateUrl: "./login.html",
  styleUrl: "./login.css",
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Ruta a la que volver tras una expiración con borrador guardado (E15). Solo rutas internas. */
  private readonly returnUrl = (() => {
    const value = inject(ActivatedRoute).snapshot.queryParamMap.get("volver") ?? "";
    return /^\/(?![\/\\])/.test(value) && !value.startsWith("/iniciar-sesion") ? value : null;
  })();
  readonly showPassword = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  /** Aviso tras cambiar la contraseña en el perfil: el perfil redirige aquí con ?passwordChanged=true. */
  readonly passwordChanged = inject(ActivatedRoute).snapshot.queryParamMap.get("passwordChanged") === "true";
  readonly form = inject(FormBuilder).nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    password: ["", Validators.required],
  });
  submit() {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set("");
    const { email, password } = this.form.getRawValue();
    this.auth.login(email.trim(), password).subscribe({
      next: (user) => {
        this.busy.set(false);
        void this.router.navigateByUrl(user.mustChangePassword ? "/perfil" : (this.returnUrl ?? this.auth.home()));
      },
      error: (error) => {
        this.busy.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }
}
