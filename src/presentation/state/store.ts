/**
 * Estado reactivo de la aplicación usando @preact/signals.
 *
 * Re-exporta desde sub-stores para compatibilidad hacia atrás.
 * Migración incremental: consumidores pueden importar directamente de los sub-stores.
 */
export * from './studiesStore';
export * from './uiStore';
export * from './outboxStore';
export * from './authStore';