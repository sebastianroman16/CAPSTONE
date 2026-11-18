import { Injectable, inject } from "@angular/core";
import { CanDeactivateFn } from "@angular/router";
import { AuthService } from "./auth.service";
export interface UnsavedEditor {
  hasUnsavedChanges(): boolean;
  discardPendingChanges(): void;
  /** Identifica el borrador (por ejemplo "causa:<id>") para recuperarlo si la sesión expira (E15). */
  draftKey?(): string | null;
  draftValue?(): unknown;
}

const PREFIX = "lex-draft:";
const MAX_AGE_MS = 8 * 60 * 60 * 1000; // igual que la duración máxima de una sesión

/**
 * Borradores sin guardar cuando la sesión expira por inactividad (E15).
 * Se guardan en sessionStorage, que se borra al cerrar la pestaña, y solo los recupera el mismo usuario:
 * así no quedan datos de causas en el disco del equipo ni se mezclan entre cuentas.
 */
@Injectable({ providedIn: "root" })
export class UnsavedChangesService {
  private readonly auth = inject(AuthService);
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
  /** Cierre de sesión voluntario: se descartan los cambios y cualquier borrador guardado. */
  discardAfterLogout() {
    this.editor?.discardPendingChanges();
    this.clearDrafts();
  }
  /** Expiración por inactividad: guarda el borrador antes de descartarlo. Devuelve true si guardó algo. */
  preserveAfterExpiry(): boolean {
    const editor = this.editor;
    let saved = false;
    const userId = this.auth.user()?.id;
    const key = editor?.hasUnsavedChanges() ? editor.draftKey?.() : null;
    if (editor && userId && key && editor.draftValue) {
      saved = this.write(`${PREFIX}${userId}:${key}`, JSON.stringify({ savedAt: Date.now(), value: editor.draftValue() }));
    }
    editor?.discardPendingChanges();
    return saved;
  }
  /** Entrega una sola vez el borrador del usuario actual para esa clave, si no está vencido. */
  takeDraft<T>(key: string): T | null {
    const userId = this.auth.user()?.id;
    if (!userId) return null;
    const storageKey = `${PREFIX}${userId}:${key}`;
    const raw = this.read(storageKey);
    this.remove(storageKey);
    if (!raw) return null;
    try {
      const draft = JSON.parse(raw) as { savedAt: number; value: T };
      return Date.now() - draft.savedAt <= MAX_AGE_MS ? draft.value : null;
    } catch {
      return null;
    }
  }
  clearDrafts() {
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key);
      }
    } catch {
      /* almacenamiento no disponible: no hay borradores que limpiar */
    }
  }
  private write(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
  private read(key: string) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }
  private remove(key: string) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* sin almacenamiento */
    }
  }
}
export const protectUnsavedChanges: CanDeactivateFn<UnsavedEditor> = () =>
  inject(UnsavedChangesService).confirmLeave();
