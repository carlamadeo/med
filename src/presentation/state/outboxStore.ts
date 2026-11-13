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