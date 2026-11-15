/**
 * Store para autenticación
 */
import {signal} from '@preact/signals';

// ------------------------------------------------------------------
// Estado primitivo - Auth
// ------------------------------------------------------------------

export const isSignedIn = signal(false);
export const isLocalDemo = signal(false);

// ------------------------------------------------------------------
// Acciones - Auth
// ------------------------------------------------------------------

export function setIsSignedIn(v: boolean): void {
    isSignedIn.value = v;
}

export function setIsLocalDemo(v: boolean): void {
    isLocalDemo.value = v;
}