# 0001. Copias locales y cambios pendientes de Drive

Decisión vigente desde el 12 de noviembre de 2026. Actualizada el 14 de noviembre de 2026.

## Contexto

La aplicación no tiene servidor propio. Drive es la fuente de verdad y los documentos pueden contener información médica. Una pérdida de red o un cambio de cuenta no deben enviar datos a otra cuenta ni borrar silenciosamente un cambio pendiente.

## Decisión

| Datos | Almacenamiento y alcance |
|---|---|
| Recursos públicos | El service worker de producción guarda la interfaz y recursos públicos como PDF.js y OCR. Las respuestas de Drive quedan fuera de su caché. |
| Credenciales | El token de acceso y su vencimiento original viven en memoria y, cuando está disponible, en el `sessionStorage` de la pestaña. La sesión restaurada conserva el identificador de cuenta si ya se había verificado con el mismo token. |
| Copia local consultada | IndexedDB (`mis-estudios`) liga la copia a un hash SHA-256 del identificador verificado y el token. Las transacciones comprueban el dueño de la caché al leer o escribir. Un cambio de sesión vuelve inaccesible la copia anterior y el cierre explícito de sesión limpia la caché. |
| Mutaciones y adjuntos pendientes | Una base separada (`mis-estudios-outbox`) asocia las entradas a `about.user.permissionId`. La cola sobrevive al cierre de sesión y vuelve a estar disponible para la misma cuenta verificada. Borrar los datos del sitio elimina la cola. |

[Sesión de Drive](../../src/data/drive-api.ts) · [Cierre de sesión](../../src/data/drive-auth-repository.ts) · [Caché en IndexedDB](../../src/core/storage.ts) · [Service worker](../../src/core/service-worker.template)

### Encolado y sincronización

- El encolado requiere una sesión vigente, una cuenta verificada previamente en línea y Web Locks. La cola puede guardar altas, ediciones, eliminaciones y recuperaciones de estudios, operaciones, portales, consultas, recetas, episodios y turnos. Una operación nueva debe sincronizarse antes de poder vincularle estudios.
- `enqueueOffline` y `Outbox.sync` usan el mismo bloqueo por cuenta. Al reconectar, se comprueba la sesión y la cuenta antes de enviar cambios. El envío procesa las entradas en orden y elimina cada una tras confirmar el resultado.
- Antes de enviar un alta, se guarda el ID reservado de Drive en la entrada para reutilizarlo en un reintento. Un 409 de creación exige verificar que corresponde al registro esperado. En un estudio con adjunto, se compara también el contenido.
- Una revisión obsoleta produce `DriveConflictError`. La cola conserva el conflicto y se detiene hasta que la persona lo revise. Un error de red conserva la entrada para reintentar. Si se perdió la respuesta de una eliminación, solo se acepta el éxito cuando Drive confirma que el mismo archivo de la aplicación está en la papelera.

[Encolado](../../src/presentation/utils/enqueueOffline.ts) · [Cola](../../src/data/outbox.ts) · [Coordinación desde la página](../../src/presentation/hooks/useOutbox.ts) · [Repositorio de estudios](../../src/data/drive-study-repository.ts)

## Límites

- La lectura sin conexión depende de una copia disponible y de la sesión vigente. Tras renovar el token, la app tiene que volver a cargar los datos. Los adjuntos remotos pueden requerir conexión.
- La sincronización requiere una página abierta y una sesión vigente o reconectada. Una cola local puede perderse si el navegador elimina datos del sitio. Los adjuntos pendientes consumen almacenamiento del dispositivo.
- Web Locks coordina pestañas del mismo origen en el navegador. La comprobación de versión y la escritura son operaciones separadas en Drive. Queda pendiente comprobar y resolver la carrera en la que dos dispositivos leen la misma revisión antes de escribir.
- Si Drive aplica una edición pero se pierde la respuesta, un reintento puede entrar en conflicto aunque el contenido remoto ya coincida. La entrada queda disponible para revisión.

[Guía de verificación](../verificacion.md)
