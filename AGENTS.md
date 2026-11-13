# Repository Guidelines

## Project Structure & Module Organization

Mis estudios is a TypeScript and Preact application built with Vite and deployed to GitHub Pages. Work from the `mis-estudios/` repository root. `src/domain/` contains models and pure business rules, `src/data/` implements Drive, IndexedDB, and outbox access, and `src/core/` holds shared infrastructure. UI components, pages, state, and CSS live under `src/presentation/`. PDF and OCR workers are in `src/workers/`. Static assets are in `public/`, design decisions in `docs/adr/`, and tests in `test/` and `test/e2e/`. Do not edit generated output such as `dist/`, `coverage/`, or `public/vendor/` by hand.

## Build, Test, and Development Commands

Use Node.js 24 or later and run `npm ci` to install dependencies.

- `npm run dev` starts the Vite development server; `npm run build` type-checks and builds the app. Both prepare vendor assets automatically.
- `npm start` previews the production build locally.
- `npm run typecheck` checks TypeScript; `npm run lint` runs ESLint and Stylelint.
- `npm test` runs Vitest; `npm run test:coverage` also measures coverage.
- `npm run test:e2e` runs Playwright. Use `npm run test:offline` and `npm run test:outbox` for their dedicated browser scenarios; `npm run test:lighthouse` checks Lighthouse metrics.

Run `npx vitest run test/library.test.ts` for the library rules or `npx playwright test test/e2e/navigation.spec.ts --project=chromium` for a focused browser check. If Playwright browsers are missing, run `npx playwright install chromium webkit` (add `--with-deps` on Linux if system packages are needed).

## Coding Style & Naming Conventions

Follow `.prettierrc`: two-space indentation, single quotes, semicolons, and a 100-character print width. Use TypeScript type-only imports where appropriate, as enforced by ESLint. Follow existing names: PascalCase for components (for example, `StudyRow.tsx`) and descriptive kebab-case for many domain, data, and test files. Keep CSS consistent with Stylelint and the existing design tokens.

**Code hygiene:** Remove unused exports, functions, and CSS selectors when refactoring. Delete empty modules instead of leaving them as empty files. Run `npm run lint` and `npm run typecheck` before committing; they catch unused code via ESLint/TypeScript.

Keep the TypeScript checks in `tsconfig.json`, including `strict`, `noUncheckedIndexedAccess`, and `noImplicitOverride`. Follow the existing Vite path aliases for cross-layer imports. Keep user-facing text in Spanish. Session expiry, stale revisions, unavailable Web Locks, and sync conflicts each require distinct feedback.

## Implementation Guidelines

- **Reuse the active implementation.** Trace the affected flow from the Preact component to the code it calls before changing it. Extend existing domain rules, components, or CSS tokens where they fit. Keep the patch scoped to the behavior requested. For example, the library reads `filteredStudies` from the store, so changes to filtering must reach that path.
- **Keep state where it is used.** Use Preact Signals for shared state, `computed` for derived values, and component-local state for form drafts. Keep reusable business rules in `src/domain/` independent of Preact, the DOM, and Google APIs. Keep Drive and IndexedDB access behind the repository interfaces in `src/domain/repository.ts`.
- **Preserve Drive and offline behavior.** Follow the [offline and Drive ADR](docs/adr/0001-offline-drive.md). Keep Drive as the source of truth, the cache tied to the current session, and pending changes tied to the verified Drive account. Preserve the `appProperties` markers that distinguish the app folder, studies, operations, and portals. Route offline mutations through the existing outbox and serialize synchronization across tabs with Web Locks. Reject stale `revision` values with `DriveConflictError`. Keep reserved IDs for retried creates and retain pending entries when the result is uncertain or a conflict needs review. When changing persisted formats, handle existing records in Drive and IndexedDB.
- **Guard asynchronous editor work.** Reset attachments and validation when opening a fresh draft. Cancel PDF analysis when the dialog closes or the attachment changes. Before applying asynchronous results, verify that they still belong to the active draft and session where applicable. Preserve fields the user edited manually when applying OCR suggestions.
- **Keep production asset URLs relative to the Vite base.** Load PDF.js and Tesseract through the existing worker and vendor paths. Preserve worker cleanup and the service worker's public-assets-only cache. Verify changes to these paths against a production build served under a GitHub Pages-style subpath.

## Testing Guidelines

Add Vitest tests as `*.test.ts` or `*.test.tsx` and Playwright tests under `test/e2e/` as `*.spec.ts`. Vitest measures coverage across domain, data, and core together, with thresholds of 80% for lines, functions, and statements and 70% for branches.

Verify changed behavior through the entry point the app actually uses. Use `test/extract.test.ts` and `test/library.test.ts` for pure rules and the app integration tests for UI wiring. Vitest uses jsdom, fake IndexedDB, and MSW in `test/setup.ts`. For Drive or persistence changes, update the fake Drive handlers when the API payload changes and cover the affected offline, retry, conflict, or account-switch scenarios. Use `npm run test:offline` for production shell caching and `npm run test:outbox` for browser synchronization flows when those behaviors change.

## Commit & Pull Request Guidelines

Recent commits use imperative, descriptive subjects such as `Refactor study list and filtering logic`; follow that pattern. PRs should explain the change and its motivation, list checks run, link relevant issues, and include screenshots for visible UI changes.

## Configuration & Privacy

For real Drive testing, configure the public OAuth client ID as `GOOGLE_CLIENT_ID` at build time or `VITE_GOOGLE_CLIENT_ID` locally. See [local setup](README.md#probar-en-la-computadora) for the required OAuth origins. Use synthetic data in fixtures and keep credentials and real medical records out of the repository.
