/**
 * Store para autenticación
 */
import { signal } from '@preact/signals';

// ------------------------------------------------------------------
// Estado primitivo - Auth
// ------------------------------------------------------------------

export const isSignedIn = signal(false);
export const sessionLost = signal(false);

// ------------------------------------------------------------------
// Acciones - Auth
// ------------------------------------------------------------------

export function setIsSignedIn(v: boolean): void {
  isSignedIn.value = v;
}

export function setSessionLost(v: boolean): void {
  sessionLost.value = v;
}