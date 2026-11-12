# Repository Guidelines

## Project Structure & Module Organization

Mis estudios is a TypeScript and Preact application built with Vite. Work from the `mis-estudios/` repository root. `src/domain/` contains models and pure business rules; `src/data/` implements Drive, IndexedDB, and outbox access; `src/core/` holds shared infrastructure. UI components, pages, state, and CSS live under `src/presentation/`; PDF and OCR workers are in `src/workers/`. Static assets are in `public/`, design decisions in `docs/adr/`, and tests in `test/` and `test/e2e/`. Do not edit generated output such as `dist/`, `coverage/`, or `public/vendor/` by hand.

## Build, Test, and Development Commands

Use Node.js 24 or later and run `npm ci` to install dependencies.

- `npm run dev` starts the Vite development server; `npm run build` type-checks and builds the app. Both prepare vendor assets automatically.
- `npm start` previews the production build locally.
- `npm run typecheck` checks TypeScript; `npm run lint` runs ESLint and Stylelint.
- `npm test` runs Vitest; `npm run test:coverage` also measures coverage.
- `npm run test:e2e` runs Playwright. Use `npm run test:offline` and `npm run test:outbox` for their dedicated browser scenarios; `npm run test:lighthouse` checks Lighthouse metrics.

## Coding Style & Naming Conventions

Follow `.prettierrc`: two-space indentation, single quotes, semicolons, and a 100-character print width. Use TypeScript type-only imports where appropriate, as enforced by ESLint. Follow existing names: PascalCase for components (for example, `StudyRow.tsx`) and descriptive kebab-case for many domain, data, and test files. Keep CSS consistent with Stylelint and the existing design tokens.

**Code hygiene:** Remove unused exports, functions, and CSS selectors when refactoring. Delete empty modules instead of leaving them as empty files. Run `npm run lint` and `npm run typecheck` before committing; they catch unused code via ESLint/TypeScript.

## Testing Guidelines

Add Vitest tests as `*.test.ts` or `*.test.tsx` and Playwright tests under `test/e2e/` as `*.spec.ts`. Coverage thresholds for domain, data, and core are 80% lines, functions, and statements, and 70% branches. Exercise relevant offline and synchronization behavior when changing persistence or Drive integration.

## Commit & Pull Request Guidelines

Recent commits use imperative, descriptive subjects such as `Refactor study list and filtering logic`; follow that pattern. PRs should explain the change and its motivation, list checks run, link relevant issues, and include screenshots for visible UI changes.

## Configuration & Privacy

For real Drive testing, configure `GOOGLE_CLIENT_ID` at build time as described in `README.md`. Do not commit credentials, personal medical records, or real patient data in fixtures.
