import { Injectable, inject } from "@angular/core";
import { CanDeactivateFn } from "@angular/router";
export interface UnsavedEditor {
  hasUnsavedChanges(): boolean;
  discardPendingChanges(): void;
}
@Injectable({ providedIn: "root" })
export class UnsavedChangesService {
  private editor: UnsavedEditor | null = null;
  register(editor: UnsavedEditor) {
    this.editor = editor;
  }
  unregister(editor: UnsavedEditor) {
    if (this.editor === editor) this.editor = null;
  }
  confirmLeave(): boolean {
    return (
      !this.editor?.hasUnsavedChanges() ||
      window.confirm(
        "Tienes cambios sin guardar. ¿Quieres salir y descartarlos?",
      )
    );
  }
  discardAfterLogout() {
    this.editor?.discardPendingChanges();
  }
}
export const protectUnsavedChanges: CanDeactivateFn<UnsavedEditor> = () =>
  inject(UnsavedChangesService).confirmLeave();
