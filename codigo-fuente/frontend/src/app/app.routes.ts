import { Routes } from "@angular/router";
import {
  authenticated,
  lawyerOnly,
  supervisorOnly,
  caseAccess,
} from "./core/auth.service";
import { protectUnsavedChanges } from "./core/unsaved-changes.service";
export const routes: Routes = [
  {
    path: "iniciar-sesion",
    loadComponent: () => import("./features/login/login").then((m) => m.Login),
  },
  {
    path: "",
    canActivate: [authenticated],
    loadComponent: () => import("./layout/shell").then((m) => m.Shell),
    children: [
      { path: "", pathMatch: "full", redirectTo: "causas" },
      {
        path: "supervision",
        canActivate: [supervisorOnly],
        loadComponent: () =>
          import("./features/supervision/supervision").then(
            (m) => m.Supervision,
          ),
      },
      {
        path: "supervision/causas/:id",
        canActivate: [supervisorOnly],
        loadComponent: () =>
          import("./features/supervision/supervision-detail").then(
            (m) => m.SupervisionDetail,
          ),
      },
      {
        path: "causas",
        canActivate: [caseAccess],
        loadComponent: () =>
          import("./features/cases/case-list").then((m) => m.CaseList),
      },
      {
        path: "clientes",
        canActivate: [lawyerOnly],
        loadComponent: () =>
          import("./features/clients/client-portfolio").then(
            (m) => m.ClientPortfolio,
          ),
      },
      {
        path: "causas/nueva",
        canActivate: [lawyerOnly],
        canDeactivate: [protectUnsavedChanges],
        loadComponent: () =>
          import("./features/cases/case-form").then((m) => m.CaseForm),
      },
      {
        path: "causas/importar",
        canActivate: [lawyerOnly],
        loadComponent: () =>
          import("./features/cases/import-cases").then((m) => m.ImportCases),
      },
      {
        path: "causas/:id/editar",
        canActivate: [lawyerOnly],
        canDeactivate: [protectUnsavedChanges],
        loadComponent: () =>
          import("./features/cases/case-form").then((m) => m.CaseForm),
      },
      {
        path: "causas/:id/avance",
        canActivate: [lawyerOnly],
        canDeactivate: [protectUnsavedChanges],
        loadComponent: () =>
          import("./features/cases/progress-form").then((m) => m.ProgressForm),
      },
      {
        path: "causas/:id",
        canActivate: [caseAccess],
        loadComponent: () =>
          import("./features/cases/case-detail").then((m) => m.CaseDetail),
      },
      {
        path: "perfil",
        loadComponent: () =>
          import("./features/profile/profile").then((m) => m.Profile),
      },
    ],
  },
  { path: "**", redirectTo: "causas" },
];
