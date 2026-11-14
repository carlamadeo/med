# Contribuir a Mis Estudios

Gracias por tu interés en contribuir. Este documento describe el flujo de trabajo y las convenciones del proyecto.

## Configuración del entorno

### Requisitos
- Node.js 24 o superior
- npm (incluido con Node.js)

### Instalación
```bash
npm ci
```

## Scripts principales

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Inicia servidor de desarrollo Vite |
| `npm run build` | Type-check + build de producción |
| `npm run typecheck` | Verifica tipos TypeScript (`tsc --noEmit`) |
| `npm run lint` | Ejecuta ESLint y Stylelint |
| `npm test` | Ejecuta pruebas unitarias (Vitest) |
| `npm run test:coverage` | Pruebas con cobertura |
| `npm run test:e2e` | Pruebas end-to-end (Playwright) |
| `npm run test:offline` | Pruebas de recarga sin conexión |
| `npm run test:outbox` | Pruebas de sincronización/cola |
| `npm run test:lighthouse` | Métricas Lighthouse |
| `npm run docs:api` | Genera documentación API (TypeDoc) |

## Estructura del proyecto

```
src/
├── domain/           # Reglas de negocio puras (sin dependencias externas)
├── data/             # Implementaciones de repositorios (Drive, IndexedDB, Outbox)
├── core/             # Infraestructura compartida (config, storage)
├── presentation/     # UI (componentes, páginas, estado, hooks, estilos)
└── workers/          # Workers para PDF y OCR
```

## Convenciones de código

### TypeScript
- Usa `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` (ya en `tsconfig.json`)
- Imports de solo tipo con `import type` (forzado por ESLint)
- Alias de ruta: `@/`, `@domain/`, `@data/`, `@core/`, `@presentation/`, `@workers/`

### Estilo (Prettier)
- 2 espacios, comillas simples, punto y coma, ancho 100 caracteres
- Ejecuta `npm run lint` antes de commit (incluye `prettier --check`)

### Nomenclatura
- **Componentes**: PascalCase (`StudyRow.tsx`)
- **Dominio/Datos/Tests**: kebab-case descriptivo (`drive-study-repository.ts`)
- **CSS**: Tokens de diseño existentes, consistentes con Stylelint

### Estado
- **Compartido**: Preact Signals (`src/presentation/state/`)
- **Derivado**: `computed` signals
- **Local de formulario**: `useState` / `useReducer` en el componente

### Reglas de negocio
- Mantén reglas puras en `src/domain/` (independientes de Preact, DOM, Google APIs)
- Repositorios detrás de interfaces en `src/domain/repository.ts`

## Comportamiento offline y Drive

Ver [ADR 0001](docs/adr/0001-offline-drive.md):
- Drive = fuente de verdad
- Caché ligada a sesión verificada
- Outbox serializado con Web Locks
- Conflictos de `revision` → `DriveConflictError` (revisión manual)
- IDs reservados para reintentos de creación

## Testing

### Unitarias (Vitest + jsdom)
- Ubicación: `test/` y `test/e2e/`
- Setup: `test/setup.ts` (fake IndexedDB, MSW)
- Cobertura mínima: 80% líneas/funciones/statements, 70% branches

### E2E (Playwright)
- Configs: `playwright.config.ts`, `playwright.offline.config.ts`, `playwright.outbox.config.ts`
- Navegadores: Chromium, WebKit (mobile/desktop)

## Commits y PRs

### Mensajes de commit
Imperativo, descriptivo:
```
Refactor study list and filtering logic
Fix offline queue conflict resolution
Add OCR fallback for scanned PDFs
```

### Pull Requests
1. Explica el cambio y su motivación
2. Lista checks ejecutados (`typecheck`, `lint`, `test`, `build`)
3. Vincula issues relacionados
4. Incluye capturas para cambios visibles en UI

## Flujo de trabajo sugerido

1. Crea rama: `git checkout -b feature/nombre-corto`
2. Desarrolla con `npm run dev`
3. Verifica localmente:
   ```bash
   npm run typecheck && npm run lint && npm test && npm run build
   ```
4. Commit y push
5. Abre PR en GitHub

## Qué no hacer

- ❌ Editar `dist/`, `coverage/`, `public/vendor/` a mano
- ❌ Dejar exports, funciones o selectores CSS sin usar
- ❌ Dejar módulos vacíos (bórralos)
- ❌ Introducir secretos/credenciales en código
- ❌ Asumir librerías no presentes en `package.json`

## Recursos

- [README.md](../README.md) — Descripción general, publicación, prueba local
- [docs/adr/0001-offline-drive.md](../docs/adr/0001-offline-drive.md) — Decisiones de arquitectura offline
- [AGENTS.md](../AGENTS.md) — Guías para agentes IA (este proyecto)