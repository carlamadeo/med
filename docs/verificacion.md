# Verificación por tipo de cambio

Ejecutá los comandos desde la raíz del repositorio con Node.js 24 o superior. Usá datos sintéticos para archivos,
cuentas simuladas y capturas. Elegí las pruebas según el flujo afectado y comprobá el comportamiento desde la
interfaz cuando el cambio llegue a ella.

## Drive, sesión y sincronización

- **Sesión y caché.** Verificá que una cuenta distinta o sin verificar no acceda a la copia anterior. Incluí
  cierre de sesión y restauración en la misma pestaña. Si cambia IndexedDB, probá la migración desde el formato
  anterior. [Identidad de la caché](../test/cache-owner-verification.test.ts) ·
  [Verificación de cuenta](../test/app-owner-verification.test.ts) ·
  [Migración](../test/storage-migration.test.ts)
- **Cola y conflictos.** Probá una mutación sin conexión y la reconexión con la misma cuenta. Según el cambio,
  comprobá un reintento con el mismo ID, una revisión que queda obsoleta mientras se revisa el conflicto y un
  navegador sin Web Locks. Para sincronización en navegador, usá `npm run test:outbox`.
  [Cola](../test/outbox.test.ts) · [Reintento](../test/save-retry.test.ts) ·
  [Revisión obsoleta](../test/app-conflict-stale.test.ts) · [Bloqueo de encolado](../test/enqueue-offline.test.ts)
- **Recuperación.** Comprobá eliminación, elegibilidad y restauración para la entidad afectada. Si modificás la
  recuperación sin conexión, verificá también el paso por la cola y la revisión remota al reconectar.
  [Recuperación por entidad](../test/directory-recovery.test.ts) · [Ventana](../test/recovery-window.test.ts) ·
  [Diálogo](../test/recovery-dialog.test.ts)

## Exportación y envío

Ejecutá `npx vitest run test/export-dialog.test.ts test/share-dialog.test.ts`. Las pruebas existentes comprueban
los bytes del PDF descargado, el cambio de cuenta durante la exportación y la selección de fuentes al compartir.

Al corregir el alcance o la completitud del ZIP, agregá casos al diálogo y descomprimí el archivo descargado.
Compará el manifiesto, los adjuntos y las entidades incluidas con el alcance acordado. Usá registros relacionados
y ajenos a la selección, enlaces desactivados, directorios incompletos y cambios pendientes. Comprobá que un
cambio de cuenta durante la preparación impida la descarga. La inclusión de episodios y turnos ajenos al filtro
y la descarga con directorios incompletos son brechas pendientes de corrección.
[Pruebas de exportación](../test/export-dialog.test.ts) · [Pruebas de compartir](../test/share-dialog.test.ts)

## PDF, OCR y rutas de producción

- **Editor.** Probá cancelar la lectura, reemplazar el archivo durante el análisis y cerrar o cambiar de sesión.
  Comprobá que los resultados tardíos se descarten y que las sugerencias respeten los campos editados a mano.
  [Editor y análisis](../test/app-analysis.test.ts) · [Cancelación de subida](../test/upload-cancellation.test.ts)
- **Workers.** Ejecutá `npm run test:e2e -- test/e2e/pdf-worker.spec.ts` para probar texto, OCR y cancelación en
  navegador. [Pruebas de workers](../test/e2e/pdf-worker.spec.ts)
- **Caché y subruta.** Para cambios de Vite, workers o service worker, ejecutá `npm run test:offline` y comprobá
  además la compilación servida bajo una subruta. Podés usar `npm run build` seguido de
  `npm run preview -- --base /med/` y abrir `http://localhost:4173/med/`. Confirmá que la interfaz, `sw.js` y los
  recursos de los workers resuelvan dentro de la subruta. Para probar una carga autenticada, usá la configuración
  de prueba de [OAuth local](../README.md#probar-en-la-computadora).
  [Prueba de recarga sin conexión](../test/e2e/offline-shell.spec.ts) · [Configuración de Vite](../vite.config.ts)

## Biblioteca e interfaz

Para filtros y orden, empezá con `npx vitest run test/library.test.ts test/search.test.ts` y comprobá la vista que
consume los resultados. Para cambios de navegación, foco o lista virtualizada, usá
`npx playwright test --config playwright.outbox.config.ts test/e2e/navigation.spec.ts --project=chromium`.
`npm run test:a11y` cubre infracciones serias y críticas en varias vistas y el editor. Revisá el contraste
en el navegador si cambia el diseño. [Prueba de navegación](../test/e2e/navigation.spec.ts) ·
[Pruebas de accesibilidad](../test/a11y.test.ts)
