import { bootstrapApplication } from "@angular/platform-browser";
import { Component } from "@angular/core";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { provideRouter, RouterOutlet } from "@angular/router";
import { routes } from "./app/app.routes";
import { sessionInterceptor } from "./app/core/auth.service";
import { appLocaleProviders } from "./app/core/locale";
@Component({
  selector: "app-root",
  imports: [RouterOutlet],
  template: "<router-outlet />",
})
class App {}
bootstrapApplication(App, {
  providers: [
    ...appLocaleProviders,
    provideHttpClient(withInterceptors([sessionInterceptor])),
    provideRouter(routes),
  ],
}).catch(console.error);
