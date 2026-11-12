import { computed, inject, Injectable, signal } from "@angular/core";
import {
  HttpClient,
  HttpErrorResponse,
  HttpInterceptorFn,
} from "@angular/common/http";
import { CanActivateFn, Router } from "@angular/router";
import { catchError, firstValueFrom, tap, throwError } from "rxjs";
import { User } from "./models";
@Injectable({ providedIn: "root" })
export class AuthService {
  private readonly http = inject(HttpClient);
  readonly user = signal<User | null>(null);
  readonly isLawyer = computed(() => this.user()?.role === "LAWYER");
  readonly isSupervisor = computed(() => this.user()?.role === "SUPERVISOR");
  readonly roleLabel = computed(() =>
    this.isSupervisor()
      ? "Coordinador jurídico"
      : this.isLawyer()
        ? "Abogado"
        : "Cliente",
  );
  readonly home = computed(() =>
    this.isSupervisor() ? "/supervision" : "/causas",
  );
  login(email: string, password: string) {
    return this.http
      .post<User>("/api/auth/login", { email, password })
      .pipe(tap((user) => this.user.set(user)));
  }
  async restore() {
    if (this.user()) return true;
    try {
      this.user.set(await firstValueFrom(this.http.get<User>("/api/auth/me")));
      return true;
    } catch {
      this.user.set(null);
      return false;
    }
  }
  logout() {
    return this.http
      .post("/api/auth/logout", {})
      .pipe(tap(() => this.user.set(null)));
  }
  extendSession() {
    return this.http
      .post<{ ok: true; user: User }>("/api/auth/extend", {})
      .pipe(tap(({ user }) => this.user.set(user)));
  }
}
export const authenticated: CanActivateFn = async () => {
  const auth = inject(AuthService),
    router = inject(Router);
  return (await auth.restore()) || router.createUrlTree(["/iniciar-sesion"]);
};
export const lawyerOnly: CanActivateFn = () =>
  inject(AuthService).isLawyer() ||
  inject(Router).createUrlTree([inject(AuthService).home()]);
export const supervisorOnly: CanActivateFn = () =>
  inject(AuthService).isSupervisor() ||
  inject(Router).createUrlTree(["/causas"]);
export const caseAccess: CanActivateFn = () =>
  !inject(AuthService).isSupervisor() ||
  inject(Router).createUrlTree(["/supervision"]);
export const sessionInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService),
    router = inject(Router);
  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !req.url.endsWith("/auth/login")) {
        auth.user.set(null);
        void router.navigateByUrl("/iniciar-sesion");
      }
      return throwError(() => error);
    }),
  );
};
export function errorMessage(error: HttpErrorResponse): string {
  if (
    error.status === 0 ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504
  )
    return "No se pudo conectar con el servidor. Intenta nuevamente.";
  if (error.status === 429)
    return "Demasiados intentos. Espera un minuto antes de volver a intentar.";
  const message = error.error?.message;
  return Array.isArray(message)
    ? message.join(" · ")
    : typeof message === "string"
      ? message
      : "No se pudo completar la operación.";
}
