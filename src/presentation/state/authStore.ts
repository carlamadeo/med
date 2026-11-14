/**
 * Store para autenticación
 */
import {signal} from '@preact/signals';

// ------------------------------------------------------------------
// Estado primitivo - Auth
// ------------------------------------------------------------------

export const isSignedIn = signal(false);

// ------------------------------------------------------------------
// Acciones - Auth
// ------------------------------------------------------------------

export function setIsSignedIn(v: boolean): void {
    isSignedIn.value = v;
}