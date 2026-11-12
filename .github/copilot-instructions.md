# Copilot instructions

## Project overview

`mis-estudios` is a Vite + Preact + TypeScript single-page app published to GitHub Pages. It stores medical-study metadata and PDFs in the signed-in user's private Google Drive folder; the OAuth client ID is public configuration supplied as `GOOGLE_CLIENT_ID` (or `VITE_GOOGLE_CLIENT_ID` locally).

The application is intentionally usable offline after an account has been verified:

- `src/domain/` contains framework-independent models and pure rules for extraction, filtering, normalization, and repository contracts.
- `src/data/` implements the domain contracts against Google Drive and IndexedDB. Drive is the source of truth; IndexedDB caches the current account's studies, operations, portals, and PDF blobs.
- `src/core/` owns configuration, typed events, IndexedDB storage, and the service-worker template. `src/main.tsx` registers the generated service worker in production.
- `src/presentation/` contains the Preact app, reactive state, dialogs, library views, and offline/outbox UX. `src/presentation/pages/LibraryPage.tsx` coordinates loading, mutations, authentication, and outbox synchronization.
- `src/workers/` performs PDF parsing and conditional Spanish OCR outside the UI thread. PDF.js and Tesseract assets are copied from dependencies into `public/vendor/` by `scripts/vendor.mjs` and loaded by URL rather than bundled.

Drive records use `appProperties` markers to distinguish studies, operations, portals, and the app folder. Edits and deletes carry the Drive `version` as `revision`; repository methods must reject stale revisions with `DriveConflictError` rather than overwriting another tab/device's change. Offline writes go through `src/data/outbox.ts`, are scoped to the verified Drive account, and require `navigator.locks` for safe synchronization.

Use the Vite path aliases (`@core`, `@domain`, `@data`, `@presentation`, `@workers`, and `@`) consistently. Keep domain code independent of Preact, browser UI, and Google APIs; put persistence/API concerns in data/core layers and use the repository interfaces in `src/domain/repository.ts`.

## Commands

Use Node.js 24 (`package.json` requires `>=24`):

```sh
npm ci
npm run dev                 # Vite development server
npm run build               # type-check plus production build
npm start                   # preview the production build on port 4173
npm run typecheck           # tsc --noEmit
npm run lint                # ESLint and Stylelint
npm test                    # all Vitest tests
npm run test:coverage       # Vitest with V8 coverage thresholds
npm run test:e2e            # Playwright tests against a dev server
npm run test:offline        # build, then offline-shell browser tests
npm run test:outbox         # outbox/navigation browser tests
npm run test:lighthouse     # build, then Lighthouse CI
```

`dev` and `build` run `npm run vendor` automatically. Run `npm run vendor` explicitly only when working on vendor preparation or when generated public assets are missing. For real Drive development, set a valid client ID and authorize both `http://localhost` and `http://localhost:4173` in Google Cloud:

```sh
GOOGLE_CLIENT_ID='123456789-...apps.googleusercontent.com' npm run build
```

Run one unit test file or one test by name with Vitest:

```sh
npx vitest run test/library.test.ts
npx vitest run test/library.test.ts -t "filters"
```

Run one browser spec/project with Playwright:

```sh
npx playwright test test/e2e/navigation.spec.ts --project=chromium
npx playwright test test/e2e/outbox.spec.ts --config=playwright.outbox.config.ts --project=chromium
```

Vitest uses `jsdom`, fake IndexedDB, and MSW from `test/setup.ts`; the shared fake Drive server rejects unhandled requests. E2E tests use separate Vite ports/configurations for the normal, offline, and outbox suites. Install browsers when needed with `npx playwright install --with-deps chromium webkit`.

## Conventions that affect changes

- Keep TypeScript strictness intact (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`). Use `import type` for type-only imports; ESLint enforces this and unused parameters/variables are allowed only when prefixed with `_`.
- Treat IDs, Drive revisions, and account ownership as data-integrity boundaries. Do not reuse a cached record across accounts, bypass revision checks, or mutate the outbox without preserving idempotency and conflict status.
- Preserve the distinction between local cache and Drive state. Session-specific studies/PDFs are cleared or rebound atomically when the cache owner changes; operations and portals have their own cache records and Drive markers.
- New study edits should retain the existing `revision`; new offline creates should use a reserved `id`/`createId` so retries do not duplicate records. New mutations must use the outbox paths when offline and surface explicit errors to the UI.
- Keep PDF/OCR work cancellable and terminate workers after each analysis. Do not import PDF.js or Tesseract into the main UI bundle; resolve their static assets relative to the deployed base URL so GitHub Pages subpaths continue to work.
- Keep user-visible text and error handling consistent with the existing Spanish UI. Drive session expiry, stale revisions, unavailable offline locking, and synchronization conflicts are distinct states and should not be collapsed into generic success/failure fallbacks.
- When changing persisted records or Drive serialization, update the corresponding fake Drive/MSW handlers and focused tests. Pure extraction/filtering changes belong in `test/extract.test.ts` or `test/library.test.ts`; browser behavior belongs under `test/e2e/`.
- The production build must remain deployable from a GitHub Pages subpath (`base: './'`) and must continue emitting the offline shell/service worker. CI builds with `GOOGLE_CLIENT_ID` and fails if it is absent or malformed.
