type Listener<T> = (payload: T) => void;

export class EventBus<EventMap extends Record<string, unknown>> {
  private listeners = new Map<keyof EventMap, Set<Listener<unknown>>>();

  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as Listener<unknown>);
    return () => this.off(event, listener);
  }

  off<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.listeners.get(event)?.forEach((l) => l(payload));
  }

  once<K extends keyof EventMap>(event: K): Promise<EventMap[K]> {
    return new Promise((resolve) => {
      const off = this.on(event, (payload) => {
        off();
        resolve(payload);
      });
    });
  }
}

export interface AppEvents {
  'auth:change': { signedIn: boolean };
  'studies:load': { studies: Study[] };
  'studies:change': { studies: Study[] };
  'study:add': { study: Study };
  'study:update': { study: Study };
  'study:delete': { id: string };
  'analysis:start': { file: File };
  'analysis:progress': { page: number; total: number };
  'analysis:complete': { study: StudyDraft };
  'analysis:error': { error: Error };
  'dialog:open': { id: string };
  'dialog:close': { id: string };
  'toast:show': { message: string; type: 'info' | 'success' | 'error' };
}

import type { Study, StudyDraft } from '@domain/models';
export type { Study, StudyDraft };