import { DatePipe } from "@angular/common";
import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { forkJoin } from "rxjs";
import { errorMessage } from "../../core/auth.service";
import { CasesService } from "../../core/cases.service";
import { ProductService } from "../../core/product.service";
import { Client, LegalCase } from "../../core/models";

interface PortfolioClient extends Client {
  cases: LegalCase[];
  activeCases: number;
  archivedCases: number;
  nextDate: string | null;
}

@Component({
  selector: "app-client-portfolio",
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: "./client-portfolio.html",
})
export class ClientPortfolio {
  private readonly api = inject(CasesService);
  private readonly product = inject(ProductService);
  readonly loading = signal(true);
  readonly error = signal("");
  readonly query = signal("");
  readonly clients = signal<Client[]>([]);
  readonly cases = signal<LegalCase[]>([]);
  readonly temporaryPassword=signal("");
  /** Aviso cuando las credenciales llegaron por correo y la clave no se muestra. */
  readonly credentialsSent=signal("");
  clientName="";clientEmail="";clientPhone="";

  readonly portfolio = computed<PortfolioClient[]>(() =>
    this.clients()
      .map((client) => {
        const cases = this.cases()
          .filter((item) => item.clientId === client.id)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const upcomingDates = cases
          .filter((item) => item.status === "Activa" && item.nextDate)
          .map((item) => item.nextDate as string)
          .sort();
        return {
          ...client,
          cases,
          activeCases: cases.filter((item) => item.status === "Activa").length,
          archivedCases: cases.filter((item) => item.status === "Archivada")
            .length,
          nextDate: upcomingDates[0] ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
  );

  readonly filtered = computed(() => {
    const query = this.query().trim().toLocaleLowerCase("es");
    if (!query) return this.portfolio();
    return this.portfolio().filter((client) =>
      [
        client.name,
        client.email,
        ...client.cases.flatMap((item) => [item.title, item.reference, item.rit]),
      ]
        .join(" ")
        .toLocaleLowerCase("es")
        .includes(query),
    );
  });

  readonly activeCases = computed(() =>
    this.cases().filter((item) => item.status === "Activa").length,
  );
  readonly upcomingCases = computed(() =>
    this.cases().filter(
      (item) => item.status === "Activa" && Boolean(item.nextDate),
    ).length,
  );

  constructor() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set("");
    forkJoin({ clients: this.api.clients(), cases: this.api.list() }).subscribe({
      next: ({ clients, cases }) => {
        this.clients.set(clients);
        this.cases.set(cases);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(errorMessage(error));
        this.loading.set(false);
      },
    });
  }
  createClient(){this.error.set("");this.temporaryPassword.set("");this.credentialsSent.set("");this.product.createClient({name:this.clientName,email:this.clientEmail,phone:this.clientPhone}).subscribe({next:r=>{this.temporaryPassword.set(r.temporaryPassword??"");this.credentialsSent.set(r.temporaryPassword?"":`Se enviaron las credenciales a ${r.email}.`);this.clientName="";this.clientEmail="";this.clientPhone="";this.load();},error:e=>this.error.set(errorMessage(e))});}
}
