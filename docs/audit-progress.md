# Ejecución del plan 1794433102891-comprehensive-audit-plan

Plan: `.kilo/plans/1794433102891-comprehensive-audit-plan.md`.

## Estado comprobado (2026-11-11)

- Rama existente `refactor/foundations`; árbol inicialmente limpio. Se continúa en este checkout para conservar el trabajo previo y el destino solicitado.
- Base: `npm test`: 14 archivos, 156 pruebas aprobadas.
- Fases 0–3 marcadas en el plan; falta auditar sus requisitos con evidencia al cierre.
- Fases 4–7 pendientes. No existen pruebas E2E todavía, aunque Playwright está configurado.
- Secuencia: workers PDF/OCR y cancelación → operaciones/portales/vistas/filtros → offline/outbox → pulido/documentación → auditoría completa y métricas.
- Decisiones de continuidad: conservar Preact + Signals y tokens CSS existentes; búsqueda local para mantener privacidad y no añadir servidor. No publicar ni cambiar de rama automáticamente.

## Fase 4

En curso. Preservar reglas de extracción y sugerencias manuales; mover lectura/render de páginas fuera del hilo de UI, RPC Comlink y eventos de progreso; AbortSignal termina workers y evita resultados tardíos.

## Verificación y avance (2026-11-12)

- La implementación existente de workers pasó 9 pruebas Playwright de PDF, cancelación y OCR en Chromium, Chrome móvil y Safari móvil. Esto no sustituye una auditoría completa de la fase.
- Atajos `/` para buscar y `n` para crear estudio, desactivados mientras se escribe o hay un diálogo abierto; pruebas de integración agregadas.
- Verificaciones: typecheck, lint, 159 pruebas unitarias y build aprobados.
- Pendiente: completar y verificar las fases 5–7, incluido CRUD y vistas de operaciones y portales, offline/outbox y métricas. Los atajos restantes y los estilos de impresión también están pendientes.

## Avance adicional (2026-11-12)

- Operaciones y portales se guardan en Drive; sus ediciones comprueban la revisión. Los estudios guardan `operationId` en Drive y en la caché, y el borrado de una operación comprueba que no tenga estudios vinculados. Esta comprobación no es transaccional frente a otro dispositivo que vincule un estudio al mismo tiempo.
- Hay vistas para cronología, categoría, portales y operaciones; se puede crear y editar fichas, vincular estudios desde el editor, filtrar y ordenar. La vista de categorías permite seleccionar varios tipos. Faltan partes del plan original (creación de operación desde el editor y ficha de detalle dedicada).
- La impresión prepara todas las filas filtradas aunque la lista esté virtualizada; Escape limpia filtros fuera de diálogos. Faltan los atajos de navegación con flechas y validación visual de impresión y de las vistas en móvil/escritorio.
- Verificados: 171 pruebas Vitest, 9 pruebas Playwright de PDF/OCR, typecheck, lint y build. Las pruebas de navegador no cubren todavía las vistas nuevas ni una cuenta real de Drive.
- Siguen pendientes la fase offline completa (service worker, sincronización y outbox), accesibilidad y métricas Lighthouse/coverage, y auditoría final de todas las fases marcadas previamente como completas.

## Avance posterior (2026-11-12)

- Se puede crear una operación desde el editor de estudio sin perder los campos, y la ficha de operación permite vincular y desvincular estudios existentes.
- Un service worker generado al compilar almacena solo recursos públicos del sitio. La prueba Playwright de producción comprueba la recarga sin conexión y que la caché no contenga respuestas de Drive.
- La caché de estudios se liga al hash del token de sesión, con comprobaciones transaccionales entre pestañas; un token diferente o vencido no puede leer la caché anterior. Una sesión vigente puede consultar la última copia sin red, aunque sea antigua. Los directorios que no se puedan actualizar no bloquean la lista y se reintentan al recuperar conexión.
- Comprobados: 176 pruebas Vitest, 9 pruebas de PDF/OCR, una prueba de recarga offline, typecheck, lint y build.
- Pendientes: cola de escrituras offline con identidad estable y resolución de conflictos, sincronización en segundo plano, caché de operaciones/portales, pruebas E2E de los nuevos flujos y revisión visual, flechas de navegación, Lighthouse/coverage y auditoría final. La caché está ligada al token, por lo que no sobrevive a la renovación de sesión; esto es deliberado hasta contar con identidad de cuenta verificada.

## Cola de estudios y navegación (2026-11-12)

- La identidad de Drive se verifica con `about.user.permissionId`. La cola se almacena por cuenta en una base IndexedDB separada de la caché; cerrar sesión no borra cambios pendientes. Los IDs de Drive se reservan antes del envío y se conservan para reintentos. Los conflictos detienen la cola sin descartar cambios; el descarte es explícito. Web Locks serializa la sincronización y el descarte entre pestañas.
- Guardar y eliminar estudios sin red requieren una sesión vigente cuya cuenta ya haya sido verificada y un navegador compatible con Web Locks. La sincronización se inicia al recuperar conexión o al conectar la cuenta con la página abierta; no se ejecuta con la página cerrada. Operaciones y portales todavía no se encolan.
- Una prueba Playwright usa Drive simulado y recorre la creación offline y sincronización. Las pruebas unitarias cubren cuentas distintas, conflictos, archivos, reintentos, conservación al limpiar caché y duplicados concurrentes. CI incorpora las pruebas de navegador de PDF y de conexión.
- Las flechas desplazan el foco entre estudios de la lista; sigue pendiente validar su comportamiento con listas virtualizadas largas en navegador y realizar revisión visual móvil/escritorio. También siguen pendientes Lighthouse/coverage, caché offline de directorios, sincronización con la página cerrada y auditoría final.
- Verificación posterior: 187 pruebas Vitest, typecheck y lint aprobados; pruebas Playwright independientes de cola y recarga sin conexión aprobadas. El conjunto previo de nueve pruebas de PDF/OCR también pasó durante esta iteración.

## Métricas y revisión visual (2026-11-12)

- Se actualizaron Vite a 8 y Vitest a 5; CI incluye cobertura, Playwright y Lighthouse. Con Node 24, la cobertura global es 88,35 % de líneas (dominio 97,01 % y datos 91,59 %); los archivos que solo contienen tipos se excluyen del cómputo.
- Lighthouse sobre la pantalla de acceso sin cuenta configurada obtuvo 100 de rendimiento y 100 de accesibilidad en tres pasadas tras corregir el contraste del tema oscuro. No mide las pantallas autenticadas ni acredita por sí solo el cumplimiento WCAG.
- Se inspeccionó la cola con datos sintéticos en escritorio y móvil; se corrigieron estilos de desarrollo bloqueados por CSP, la introducción para que sea modal y el estado vacío con estudios pendientes. Con 200 estudios sintéticos se verificó navegación por flechas y ausencia de desbordamiento horizontal en Chrome, Chrome móvil y Safari móvil.
- La auditoría de npm no encontró alertas en dependencias de producción. Quedan 24 alertas en dependencias de desarrollo, 15 altas y ninguna crítica, incluidas dependencias transitivas de Lighthouse CI; no se aplicaron cambios automáticos incompatibles.
- Operaciones y portales consultados tienen copia local vinculada al token de sesión; sus modificaciones siguen requiriendo conexión. La cola solo cubre estudios y se procesa mientras la página está abierta. El ADR `docs/adr/0001-offline-drive.md` documenta el aislamiento y los límites.

## Continuación: directorios y preferencias (2026-11-12)

- La cola también admite altas, ediciones y eliminaciones de operaciones y portales. Las creaciones reservan un ID persistente antes del envío y son reintentables; los vínculos pendientes impiden encolar una eliminación incompatible. Una operación creada sin red debe sincronizarse antes de vincularle estudios.
- La usuaria eligió mantener la credencial exclusivamente en la pestaña. En consecuencia, la sincronización se realiza con la aplicación abierta y la cuenta conectada; no se implementa envío autónomo con la página cerrada.
- Las vistas de operaciones y portales se inspeccionaron en escritorio y móvil con datos sintéticos; las pruebas de navegación, cola y sincronización pasan en Chrome, Chrome móvil y Safari móvil. La cronología incorpora encabezados de mes y año, y hay búsquedas recientes y guardadas por cuenta.
- En una prueba local con 200 fichas sintéticas, restablecer el filtro hasta el segundo `requestAnimationFrame` tomó 27,9–34,0 ms en las tres configuraciones de navegador. Es una medición de una máquina de desarrollo, no una garantía de tiempo de pintado para todos los dispositivos.
- En la pantalla de acceso sin cuenta configurada, las últimas tres mediciones Lighthouse anteriores a los cambios de cola ampliada mostraron 100/100 de rendimiento y accesibilidad y un TTI aproximado de 1,51 s. El JS inicial de la compilación más reciente ocupa aproximadamente 42 KB comprimidos; no incluye los workers cargados bajo demanda.

## Revisión de integridad (2026-11-12)

- La revisión detectó y corrigió una selección de PDF residual entre aperturas del editor y una validación de tipos residual. El editor verifica la cuenta original del borrador antes de guardar o crear una operación; al perder sesión se limpian los directorios de la cuenta anterior. Una respuesta tardía de búsqueda de carpeta no se conserva tras cambiar de sesión.
- Se reconoce una biblioteca vacía sincronizada como caché válida y el service worker cambia de versión cuando cambian el catálogo de tipos o el ícono. Una eliminación ya confirmada en la papelera se puede reintentar; un 404 no se interpreta como éxito. Una edición aplicada cuya respuesta se perdió puede seguir mostrando conflicto y requiere revisión manual.
- Las pruebas de la cola y navegación pasaron en Chrome, Chrome móvil y Safari móvil, incluyendo selección y reapertura del PDF. La recarga offline de producción pasó, al igual que nueve pruebas de PDF/OCR. La verificación final registró 210 pruebas y 87,45 % de líneas globales; dominio 97,01 % y datos 91,46 %. Lighthouse pasó sus umbrales con 100/100 en rendimiento y accesibilidad en las tres pasadas, limitadas a la pantalla de acceso; no se probó una cuenta real de Drive.
