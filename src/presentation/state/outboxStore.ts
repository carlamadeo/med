/**
 * Store para outbox y sincronización
 */
import { signal } from '@preact/signals';
import type { OutboxEntry } from '@data/outbox';

// ------------------------------------------------------------------
// Estado primitivo - Outbox
// ------------------------------------------------------------------

export const pendingChanges = signal<OutboxEntry[]>([]);
export const syncMessage = signal('');
export const syncing = signal(false);

// ------------------------------------------------------------------
// Acciones - Outbox
// ------------------------------------------------------------------

// These will be implemented in the component that has access to the repos
// For now we just export the signals
export function setPendingChanges(entries: OutboxEntry[]): void {
  pendingChanges.value = entries;
}

export function setSyncMessage(msg: string): void {
  syncMessage.value = msg;
}

export function setSyncing(v: boolean): void {
  syncing.value = v;
}