import {
  Component,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from "@angular/core";
import {
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from "@angular/router";
import { AuthService, errorMessage } from "../core/auth.service";
import { UnsavedChangesService } from "../core/unsaved-changes.service";
import { AssistantWidget } from "./assistant-widget";
@Component({
  selector: "app-shell",
  imports: [RouterLink, RouterLinkActive, RouterOutlet, AssistantWidget],
  template: ` <a class="skip-link" href="#contenido">Saltar al contenido</a>
    <div class="shell" [class.client-shell]="!auth.isLawyer() && !auth.isSupervisor()">
      @if (auth.isLawyer() || auth.isSupervisor()) {
      <aside class="sidebar" [class.open]="menuOpen()">
        <div class="side-brand">LEX<span>·</span>CORPUS</div>
        <p class="side-role">
          {{ auth.roleLabel() }}
        </p>
        <button
          type="button"
          class="mobile-close text-button"
          (click)="menuOpen.set(false)"
        >
          Cerrar menú
        </button>
        <nav aria-label="Navegación principal">
          <p class="nav-caption">
            {{ auth.isSupervisor() ? "Equipo jurídico" : "Causas" }}
          </p>
          <a
            class="side-link"
            [routerLink]="auth.home()"
            routerLinkActive="active"
            (click)="menuOpen.set(false)"
            ><span aria-hidden="true">▤</span
            >{{
              auth.isSupervisor()
                ? "Supervisión de causas"
                : auth.isLawyer()
                  ? "Panel de causas"
                  : "Mis causas"
            }}</a
          >
          @if (auth.isSupervisor()) {
            <a class="side-link" routerLink="/administracion" routerLinkActive="active" (click)="menuOpen.set(false)">Administración y auditoría</a>
          }
          @if (auth.isLawyer()) {
            <a
              class="side-link"
              routerLink="/clientes"
              routerLinkActive="active"
              (click)="menuOpen.set(false)"
              >Mis clientes</a
            >
            <a
              class="side-link"
              routerLink="/causas/nueva"
              (click)="menuOpen.set(false)"
              ><span aria-hidden="true">＋</span>Registrar causa</a
            >
            <p class="nav-caption">Herramientas</p>
            <a
              class="side-link"
              routerLink="/causas/importar"
              routerLinkActive="active"
              (click)="menuOpen.set(false)"
              >Importar desde Excel</a
            >
            <a class="side-link" routerLink="/agenda" routerLinkActive="active" (click)="menuOpen.set(false)">Agenda y pendientes</a>
            <a class="side-link" routerLink="/ingesta" routerLinkActive="active" (click)="menuOpen.set(false)">Bandeja de movimientos</a>
          }
          <a class="side-link" routerLink="/notificaciones" routerLinkActive="active" (click)="menuOpen.set(false)">Notificaciones</a>
        </nav>
        <div class="sidebar-foot">
          <a
            class="side-link"
            routerLink="/perfil"
            routerLinkActive="active"
            (click)="menuOpen.set(false)"
            >Mi perfil</a
          ><button
            class="side-link"
            type="button"
            (click)="requestLogout()"
            [disabled]="busy()"
          >
            {{ busy() ? "Cerrando sesión…" : "Cerrar sesión" }}
          </button>
          <p class="footnote">Organiza tu trabajo.<br />Complementa al SAJ.</p>
        </div>
      </aside>
      }
      <div class="main">
        @if (auth.isLawyer() || auth.isSupervisor()) {
        <header class="topbar">
          <button
            class="menu-toggle text-button"
            type="button"
            (click)="menuOpen.set(!menuOpen())"
            [attr.aria-expanded]="menuOpen()"
          >
            ☰ Menú</button
          ><span class="muted">Tu espacio de gestión judicial</span
          ><span class="user-chip"
            ><span class="avatar">{{ auth.user()?.name?.slice(0, 1) }}</span
            >{{ auth.user()?.name }}</span
          >
        </header>
        } @else {
        <header class="client-topbar">
          <a class="client-brand" routerLink="/causas" aria-label="LEX CORPUS, inicio">LEX<span>·</span>CORPUS</a>
          <nav class="client-nav" aria-label="Navegación del cliente">
            <a routerLink="/causas" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Mis causas</a>
            <a routerLink="/perfil" routerLinkActive="active">Mi perfil</a>
            <a routerLink="/notificaciones" routerLinkActive="active">Notificaciones</a>
          </nav>
          <details class="client-account">
            <summary>
              <span class="avatar">{{ auth.user()?.name?.slice(0, 1) }}</span>
              <span>{{ auth.user()?.name }}</span>
            </summary>
            <div class="client-account-menu">
              <span>{{ auth.user()?.email }}</span>
              <a routerLink="/perfil">Ver mi perfil</a>
              <button type="button" class="text-button" (click)="requestLogout()" [disabled]="busy()">
                {{ busy() ? "Cerrando sesión…" : "Cerrar sesión" }}
              </button>
            </div>
          </details>
        </header>
        }
        <main id="contenido" class="page" [class.client-page]="!auth.isLawyer() && !auth.isSupervisor()" tabindex="-1">
          @if (error()) {
            <div class="error" role="alert">{{ error() }}</div>
          }
          <router-outlet />
        </main>
      </div>
    </div>
    <app-assistant-widget />
    @if (inactivityWarning()) {
      <div class="session-backdrop">
        <section
          class="session-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="session-title"
          aria-describedby="session-description"
        >
          <p class="eyebrow">Seguridad de la sesión</p>
          <h2 id="session-title">¿Sigues ahí?</h2>
          <p id="session-description">
            No hemos detectado actividad durante 3 minutos. La sesión se
            cerrará automáticamente en
            <strong>{{ secondsRemaining() }} segundos</strong>.
          </p>
          @if (renewalError()) {
            <div class="error" role="alert">{{ renewalError() }}</div>
          }
          <button
            class="button primary full"
            type="button"
            autofocus
            [disabled]="renewing()"
            (click)="continueSession()"
          >
            {{ renewing() ? "Renovando sesión…" : "Sí, continuar activo" }}
          </button>
          <button
            class="button full"
            type="button"
            [disabled]="renewing()"
            (click)="expireSession()"
          >
            Cerrar sesión ahora
          </button>
        </section>
      </div>
    } @else if (logoutConfirmation()) {
      <div class="session-backdrop">
        <section
          class="session-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="logout-title"
          aria-describedby="logout-description"
        >
          <p class="eyebrow">Cerrar sesión</p>
          <h2 id="logout-title">¿Estás seguro?</h2>
          <p id="logout-description">
            Tendrás que volver a ingresar tu correo y contraseña para acceder a
            tus causas.
          </p>
          <button
            class="button primary full"
            type="button"
            autofocus
            (click)="confirmLogout()"
          >
            Sí, cerrar mi sesión
          </button>
          <button class="button full" type="button" (click)="cancelLogout()">
            Cancelar y continuar
          </button>
        </section>
      </div>
    }`,
})
export class Shell implements OnInit, OnDestroy {
  private static readonly INACTIVITY_MS = 3 * 60 * 1000;
  private static readonly HEARTBEAT_MS = 60 * 1000;
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly unsaved = inject(UnsavedChangesService);
  readonly menuOpen = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly inactivityWarning = signal(false);
  readonly secondsRemaining = signal(10);
  readonly renewing = signal(false);
  readonly renewalError = signal("");
  readonly logoutConfirmation = signal(false);
  private inactivityTimer?: ReturnType<typeof setTimeout>;
  private countdownTimer?: ReturnType<typeof setInterval>;
  private lastServerActivity = Date.now();

  ngOnInit() {
    this.armInactivityTimer();
  }

  ngOnDestroy() {
    this.clearTimers();
  }

  @HostListener("document:pointerdown")
  @HostListener("document:keydown")
  @HostListener("document:scroll")
  recordActivity() {
    if (this.inactivityWarning() || this.busy()) return;
    this.armInactivityTimer();
    if (
      !this.renewing() &&
      Date.now() - this.lastServerActivity >= Shell.HEARTBEAT_MS
    ) {
      this.renewing.set(true);
      this.auth.extendSession().subscribe({
        next: () => {
          this.lastServerActivity = Date.now();
          this.renewing.set(false);
        },
        error: () => this.expireSession(),
      });
    }
  }

  private armInactivityTimer() {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(
      () => this.showInactivityWarning(),
      Shell.INACTIVITY_MS,
    );
  }

  private showInactivityWarning() {
    this.inactivityWarning.set(true);
    this.secondsRemaining.set(10);
    this.countdownTimer = setInterval(() => {
      const remaining = this.secondsRemaining() - 1;
      this.secondsRemaining.set(remaining);
      if (remaining <= 0) this.expireSession();
    }, 1000);
  }

  continueSession() {
    if (this.renewing()) return;
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.renewing.set(true);
    this.renewalError.set("");
    this.auth.extendSession().subscribe({
      next: () => {
        this.lastServerActivity = Date.now();
        this.renewing.set(false);
        this.inactivityWarning.set(false);
        this.armInactivityTimer();
      },
      error: () => {
        this.renewalError.set("La sesión ya no puede renovarse.");
        this.expireSession();
      },
    });
  }

  expireSession() {
    if (this.busy()) return;
    this.clearTimers();
    this.busy.set(true);
    // E15: el borrador se guarda antes de cerrar la sesión, porque logout() olvida al usuario
    // al responder y el borrador se asocia a su id. Tras ingresar se vuelve al mismo formulario.
    const returnUrl = this.router.url;
    const preserved = this.unsaved.preserveAfterExpiry();
    this.auth.logout().subscribe({
      next: () => this.finishExpiredSession(preserved, returnUrl),
      error: () => this.finishExpiredSession(preserved, returnUrl),
    });
  }

  private finishExpiredSession(preserved: boolean, returnUrl: string) {
    this.auth.user.set(null);
    this.busy.set(false);
    this.inactivityWarning.set(false);
    void this.router.navigate(["/iniciar-sesion"], preserved ? { queryParams: { volver: returnUrl } } : {});
  }

  private clearTimers() {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.inactivityTimer = undefined;
    this.countdownTimer = undefined;
  }

  requestLogout() {
    if (this.busy() || this.inactivityWarning()) return;
    this.clearTimers();
    this.logoutConfirmation.set(true);
  }

  cancelLogout() {
    this.logoutConfirmation.set(false);
    this.armInactivityTimer();
  }

  confirmLogout() {
    this.logoutConfirmation.set(false);
    this.logout();
    if (!this.busy()) this.armInactivityTimer();
  }

  logout() {
    if (this.busy() || !this.unsaved.confirmLeave()) return;
    this.clearTimers();
    this.busy.set(true);
    this.error.set("");
    this.auth.logout().subscribe({
      next: () => {
        this.unsaved.discardAfterLogout();
        this.busy.set(false);
        void this.router.navigateByUrl("/iniciar-sesion");
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(errorMessage(e));
      },
    });
  }
}
