# Arquitectura de Mis Estudios

Visión general del sistema, capas, flujo de datos y decisiones clave.

---

## Diagrama de alto nivel

```
┌─────────────────────────────────────────────────────────────┐
│                      PRESENTATION                           │
│  Components (Preact) │ Hooks │ State (Signals) │ Styles    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                         CORE                                  │
│  Config │ Storage (IndexedDB wrappers) │ Error types        │
└──────────────────────────┬──────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│         DOMAIN          │   │          DATA           │
│  Models │ Rules │ Repo   │   │  Drive API │ Outbox    │
│  Interfaces             │◄──│  Repositories           │
└─────────────────────────┘   └─────────────────────────┘
           ▲                               │
           │                               ▼
           │                    ┌─────────────────────────┐
           └───────────────────►│      GOOGLE DRIVE       │
                                │  (Fuente de verdad)     │
                                └─────────────────────────┘
```

---

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
| `drive-intake-repository.ts` | Ingesta de PDFs (subida, reservar ID) |
| `drive-medical-event-list.ts` | Listado de eventos |
| `outbox.ts` | Cola de mutaciones offline (IndexedDB + Web Locks) |
| `pdf-analysis.ts` | Análisis de PDF (texto, OCR, firmas) |
| `recovery-window.ts` | Ventana de recuperación de sesión |
| `study-types.ts` | Catálogo de tipos de estudio |

**Patrón**: Cada repositorio implementa su interfaz de `domain/repository.ts`.

---

### 3. Core (`src/core/`)

**Responsabilidad**: Infraestructura transversal.

| Archivo | Propósito |
|---------|-----------|
| `config.ts` | Configuración runtime (client ID, feature flags) |
| `storage/` | Wrappers IndexedDB tipados (`StudyRecord`, `EpisodeRecord`, etc.) |

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
| `pdf-engine/` | Motor de análisis (extracción texto, OCR, detección firmas) |

**Comunicación**: Comlink (RPC) + `AbortSignal` para cancelación.

---

## Flujo de datos principal

### Carga inicial (online)
```
LibraryPage → useLibraryData → DriveStudyRepository.list()
    → Drive API (files.list con appProperties)
    → Mapea a Study[] → studiesStore.setAll()
    → filteredStudies (computed) → StudyList → StudyRow
```

### Crear estudio (online)
```
EditorDialog → useEditor.save() → DriveIntakeRepository.create()
    → reserveId() → sube PDF → crea archivo con appProperties
    → DriveStudyRepository.create() → studiesStore.add()
```

### Crear estudio (offline)
```
EditorDialog → useEditor.save() → enqueueOffline() → Outbox.enqueue()
    → IndexedDB (outbox DB) + Web Lock
    → UI muestra "pendiente" (syncStatus: 'pending')
    → Al recuperar conexión: Outbox.flush() → Drive API → resuelve/conflicto
```

### Sincronización (Outbox)
```
Outbox.flush() (Web Lock serializado)
    → Verifica cuenta (permissionId)
    → Para cada entrada: reintenta con revision guardada
    → Conflicto (409/revision mismatch) → syncStatus: 'conflict' → UI muestra diálogo
    → Éxito → limpia entrada → actualiza caché
```

---

## Decisiones clave (ADR)

### ADR 0001: Offline y Drive (`docs/adr/0001-offline-drive.md`)
- **Drive = fuente de verdad**
- **Caché** en IndexedDB ligada a hash de `sessionToken` + `permissionId`
- **Outbox** separada, ligada a `permissionId` verificado
- **Web Locks** serializa sincronización entre pestañas
- **Conflictos** detienen cola, requieren revisión manual
- **IDs reservados** para reintentos de creación idempotentes
- **Sesión** en `sessionStorage` (no persiste al cerrar pestaña)
- **Service Worker** solo cachea assets públicos (no respuestas Drive)

---

## Convenciones transversales

### Imports
```typescript
// Capas - usar alias
import type {Study} from '@domain/models';
import {filterStudies} from '@domain/library';
import {driveStudyRepo} from '@data/drive-study-repository';
import {outbox} from '@data/outbox';
```

### Errores
- `DriveError` - errores genéricos de API
- `DriveConflictError` - revision mismatch (requiere resolución)
- `DriveSessionError` - token expirado/revocado

### Testing
- **Domain/Data**: Vitest + fake IndexedDB + MSW
- **Presentation**: Vitest (componentes) + Playwright (E2E)
- **Workers**: Pruebas de integración con PDF reales

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
- [docs/adr/0001-offline-drive.md](../docs/adr/0001-offline-drive.md) — Decisiones offline