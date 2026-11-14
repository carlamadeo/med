# Copilot instructions

Read the repository-root [AGENTS.md](../AGENTS.md) for the project's implementation rules, development commands, and
testing guidance.

- Trace the affected behavior from the Preact component through the code it calls. Reuse the existing domain logic,
  components, and CSS tokens where they fit. Verify changes through the entry point the app uses.
- Treat Drive as the source of truth. Preserve session-scoped caches, account-scoped pending changes, revision checks,
  reserved IDs for retried creates, and the existing outbox and Web Locks flow. See
  the [offline and Drive ADR](../docs/adr/0001-offline-drive.md).
- Keep PDF/OCR work cancellable and in workers. Keep the service worker cache limited to public assets and preserve
  Vite's relative asset paths for GitHub Pages.
- Keep user-facing text in Spanish. Use synthetic fixtures and keep credentials and real medical records out of the
  repository.
- Use Node.js 24 or later. Run `npm run lint`, `npm run typecheck`, and the tests that exercise the changed behavior.
