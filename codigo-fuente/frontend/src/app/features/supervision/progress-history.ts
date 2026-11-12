import { Component, input } from "@angular/core";
import { DatePipe } from "@angular/common";
import { ProgressEvent, stageLabel } from "../../core/models";
@Component({
  selector: "app-progress-history",
  imports: [DatePipe],
  template: ` <section class="card">
    <h2>Historial de avances</h2>
    <p class="muted">
      Hasta los últimos 100 registros, del más reciente al más antiguo.
    </p>
    <ol class="progress-history">
      @for (event of events(); track event.id) {
        <li>
          <p class="eyebrow">
            {{ event.createdAt | date: "dd/MM/yyyy HH:mm" }} ·
            {{ event.authorName }}
          </p>
          <h3>{{ stageLabel(event.stage) }}</h3>
          <p class="notes">{{ event.summary }}</p>
          <p class="notes">
            <strong>Próxima acción:</strong>
            {{ event.nextAction || "Sin próxima acción registrada" }}
          </p>
        </li>
      } @empty {
        <li>No hay avances registrados todavía.</li>
      }
    </ol>
  </section>`,
})
export class ProgressHistory {
  readonly events = input.required<ProgressEvent[]>();
  readonly stageLabel = stageLabel;
}
