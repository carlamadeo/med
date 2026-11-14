# Arquitectura de Mis Estudios

Visión general del sistema, capas, flujo de datos y decisiones clave.

---

## Dependencias entre capas

La interfaz consume reglas del dominio y repositorios concretos. Los repositorios usan el dominio para representar
registros y el núcleo para acceder al almacenamiento local. El dominio contiene contratos y reglas de negocio.
Drive conserva el estado remoto y los workers procesan documentos en el navegador.

## Capas

### 1. Domain (`src/domain/`)

**Responsabilidad**: Reglas de negocio puras, sin dependencias externas.

| Archivo | Propósito |
|---------|-----------|
| `models.ts` | Interfaces: `Study`, `Operation`, `Portal`, `MedicalEvent`, `Episode`, `Appointment`, `Filters`, `ViewMode` |
| `library.ts` | Reglas de filtrado, ordenación, sugerencias de portales |
| `validation/study.ts` | Validación de borradores de estudio |
| `extract.ts` | Extracción de metadatos de PDF (fecha, tipos, doctor, firma) |
| `search.ts` | Búsqueda y archivo de consultas |
| `summary.ts` | Agregaciones para gráficos/resumen |
| `appointments.ts` | Reglas de turnos |
| `document-compatibility.ts` | Compatibilidad de documentos adjuntos |
| `repository.ts` | **Interfaces** de repositorio (contratos) |
| `pdf-signatures.ts` | Detección de firmas en PDF |
| `utils.ts` | Utilidades puras (normalización, fechas) |

**Principio**: Código portable, testeable sin DOM ni APIs de Google.

---

### 2. Data (`src/data/`)

**Responsabilidad**: Implementaciones concretas de los repositorios + acceso a Drive/IndexedDB/Outbox.

| Archivo | Propósito |
|---------|-----------|
| `drive-api.ts` | Cliente Drive bajo nivel (`DriveClient`, `DriveError`, `DriveConflictError`) |
| `drive-auth-repository.ts` | Autenticación OAuth, verificación de cuenta |
| `drive-study-repository.ts` | CRUD estudios en Drive + caché IndexedDB |
| `drive-operation-repository.ts` | CRUD operaciones |
| `drive-portal-repository.ts` | CRUD portales |
| `drive-appointment-repository.ts` | CRUD turnos |
| `drive-medical-event-repository.ts` | CRUD eventos médicos |
| `drive-episode-repository.ts` | CRUD episodios |
| `drive-intake-repository.ts` | Listado y descarga de candidatos PDF de una carpeta de Drive |
| `drive-medical-event-list.ts` | Listado de eventos |
| `outbox.ts` | Cola de mutaciones offline (IndexedDB + Web Locks) |
| `pdf-analysis.ts` | Análisis de PDF (texto, OCR, firmas) |
| `recovery-window.ts` | Cálculo de elegibilidad para recuperar un registro eliminado |
| `study-types.ts` | Catálogo de tipos de estudio |

Las interfaces compartidas viven en [`domain/repository.ts`](../src/domain/repository.ts). Las instancias que usa la
interfaz se exponen desde [`data/index.ts`](../src/data/index.ts).

---

### 3. Core (`src/core/`)

**Responsabilidad**: Infraestructura transversal.

| Archivo | Propósito |
|---------|-----------|
| `config.ts` | Configuración de OAuth, Drive y límites de análisis y caché |
| [`storage.ts`](../src/core/storage.ts) | Caché en IndexedDB, control del dueño de la sesión y migraciones |
| [`service-worker.template`](../src/core/service-worker.template) | Plantilla del service worker de producción que genera Vite |

---

### 4. Presentation (`src/presentation/`)

**Responsabilidad**: UI completa.

```
presentation/
├── components/     # Componentes Preact (StudyRow, EditorDialog, FilterBar, etc.)
├── pages/          # Páginas (LibraryPage)
├── hooks/          # Hooks personalizados (useEditor, useLibraryData, useAuth, useOutbox)
├── state/          # Signals globales (store.ts, studiesStore.ts, authStore.ts, outboxStore.ts, uiStore.ts)
├── styles/         # CSS (design-tokens.css, components.css, app.css, dashboard.css)
└── utils/          # Utilidades de UI (focusTrap, enqueueOffline, driveErrorHandler, appointmentEditor, appointmentReminders)
```

**Patrón de estado**:
- **Global**: Signals en `state/` (reactivos, compartidos)
- **Derivado**: `computed` signals (ej. `filteredStudies`)
- **Local**: `useState`/`useReducer` en componente (borradores de formulario)

---

### 5. Workers (`src/workers/`)

**Responsabilidad**: Procesamiento pesado fuera del hilo principal.

| Worker | Función |
|--------|---------|
| `pdf.worker.ts` | Orquesta PDF.js + Tesseract, expone API Comlink |
| [`pdf-engine.ts`](../src/workers/pdf-engine.ts) | Extracción de texto, OCR y detección de firmas del PDF |
| [`ocr.worker.ts`](../src/workers/ocr.worker.ts) | OCR de imágenes JPEG y PNG en un worker independiente |

[`pdf-analysis.ts`](../src/data/pdf-analysis.ts) coordina las llamadas con Comlink y termina el worker si el análisis
se cancela. El selector y el guardado manual del editor admiten PDF.

---

## Flujos principales

### Cargar el historial

[`LibraryPage`](../src/presentation/pages/LibraryPage.tsx) monta los hooks de sesión y carga.
[`useAuth`](../src/presentation/hooks/useAuth.ts) establece la identidad y
[`useLibraryData`](../src/presentation/hooks/useLibraryData.ts) carga estudios y directorios. Los repositorios
consultan Drive o la caché según la conexión y la sesión. [`studiesStore`](../src/presentation/state/studiesStore.ts)
aplica cambios pendientes y filtros para producir las vistas derivadas de la biblioteca.

### Guardar un estudio

1. [`EditorDialog`](../src/presentation/components/EditorDialog.tsx) usa [`useEditor`](../src/presentation/hooks/useEditor.ts)
   para preparar el borrador, analizar el PDF y presentar sugerencias revisables.
2. `saveStudy` en [`LibraryPage`](../src/presentation/pages/LibraryPage.tsx) valida el borrador y comprueba la cuenta.
   En línea, reutiliza el ID reservado para un alta y llama a
   [`driveStudyRepo.save`](../src/data/drive-study-repository.ts). Tras guardar, actualiza el estado y recarga la lista.
3. Sin conexión, `saveStudy` usa [`enqueueOffline`](../src/presentation/utils/enqueueOffline.ts) para registrar el
   borrador y su adjunto. [`useOutbox`](../src/presentation/hooks/useOutbox.ts) llama a
   [`Outbox.sync`](../src/data/outbox.ts) al reconectar y recarga estudios y directorios tras procesar la cola.

### Exportar un ZIP

[`AppShell`](../src/presentation/components/AppShell.tsx) abre
[`ExportDialog`](../src/presentation/components/ExportDialog.tsx). El diálogo toma los estudios y directorios del
estado, obtiene los PDF seleccionados con el repositorio, genera el ZIP con JSZip y comprueba la sesión y la cuenta
antes de iniciar la descarga. Las brechas de selección y completitud registradas durante la auditoría se describen
en la [guía de verificación](verificacion.md#exportación-y-envío).

### Recuperar un registro eliminado

[`RecoveryDialog`](../src/presentation/components/RecoveryDialog.tsx) carga elementos de la papelera por tipo.
Cada repositorio comprueba la revisión y la [ventana de recuperación](../src/data/recovery-window.ts). Sin conexión,
el diálogo puede encolar la recuperación de un elemento elegible de la copia local. Al sincronizar, el repositorio
vuelve a consultar Drive y valida la elegibilidad antes de aplicar la recuperación.

## Decisiones

El [ADR 0001](adr/0001-offline-drive.md) reúne las reglas de sesión, caché, sincronización y conflictos, con el
alcance de las garantías entre pestañas y dispositivos.

## Convenciones transversales

### Imports
```typescript
// Capas - usar alias
import type {Study} from '@domain/models';
import {filterStudies} from '@domain/library';
import {driveStudyRepo} from '@data';
import {Outbox} from '@data/outbox';
```

### Errores
- `DriveError` - errores genéricos de API
- `DriveConflictError` - revisión obsoleta que requiere resolución
- `DriveSessionError` - token expirado/revocado

### Testing
- **Domain/Data**: Vitest + fake IndexedDB + MSW
- **Presentation**: Vitest (componentes) + Playwright (E2E)
- **Workers**: Pruebas de integración con PDF e imágenes sintéticos

---

## Extensibilidad

### Agregar nuevo tipo de entidad
1. Interface en `domain/models.ts`
2. Interfaz repositorio en `domain/repository.ts`
3. Implementación en `data/drive-X-repository.ts`
4. Signal en `presentation/state/` si es estado global
5. Componentes UI correspondientes
6. Tests unitarios + E2E

### Agregar nueva vista (ViewMode)
1. Agregar a `ViewMode` en `models.ts`
2. Lógica de filtrado/orden en `domain/library.ts` si aplica
3. Componente de vista en `presentation/components/`
4. Integrar en `LibraryTabs` y `LibraryPage`

---

## Referencias

- [CONTRIBUTING.md](../CONTRIBUTING.md) — Flujo de trabajo de desarrollo
- [README.md](../README.md) — Descripción general del proyecto
- [Guía de verificación](verificacion.md) — Pruebas por flujo
