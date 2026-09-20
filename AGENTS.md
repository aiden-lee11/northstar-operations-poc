# Northstar Operations POC

## Commands

Run these commands from the repository root. The npm manifest and lockfile remain at the root; frontend configuration lives in `frontend/`.

- Install pinned frontend dependencies: `npm ci`
- Build the frontend: `npm run build`
- Run the built local demo: `python3 -m backend.app`
- Run on another local port: `python3 -m backend.app --port 8080`
- Type-check the frontend: `npm run typecheck`
- Run frontend tests once: `npm test`
- Run frontend tests in watch mode: `npm run test:watch`
- Rebuild the frontend on source changes: `npm run dev`
- Run all Python tests: `python3 -m unittest discover -s backend/tests -t . -v`
- Compile Python: `python3 -m compileall -q backend`
- Check dependency advisories: `npm audit`

For local development, run `npm run dev` in one terminal and `python3 -m backend.app` in another. The Vite workflow rebuilds root-level `dist/`; Python remains the only HTTP server needed for the demo and serves the frontend and API together at `http://127.0.0.1:8000`.

The server must remain bound to `127.0.0.1`. Treat it as a local demonstration server, not a production service.

Use the direct Python server URL for browser interaction. Preview proxies on another port change the browser Origin and can cause flag mutations to be rejected. Open the direct URL rather than weakening the backend's Origin checks.

## Architecture and ownership

The backend uses Python 3.11 or newer and the Python standard library only. Browser presentation uses React, TypeScript, and Vite with pinned npm dependencies. It uses no external fonts, CDNs, live network services, or persistent database.

- `backend/app.py` owns the HTTP server, constrained root-level `dist/` static serving, API routing, JSON validation, mutation request protections, and error mapping.
- `backend/refunds.py` owns the read-only synthetic refund domain and summary.
- `backend/flags.py` owns environment-isolated in-memory flag state, validation, optimistic concurrency, rollback, and audit events.
- `frontend/src/App.tsx` owns the shared shell; `frontend/src/features/refunds/RefundsView.tsx` and `frontend/src/features/flags/FlagsView.tsx` own the workflow views. `frontend/src/components/SharedDialog.tsx` owns shared dialog and inline-state presentation.
- `frontend/src/lib/api.ts` and `frontend/src/lib/models.ts` own the typed same-origin API client and frontend API models. `frontend/src/lib/format.ts` owns shared formatting.
- `frontend/index.html` is the Vite entry document. `frontend/src/main.tsx` imports the shared presentation source, `frontend/src/styles.css`. Build and type-check configuration live in `frontend/vite.config.ts` and `frontend/tsconfig.json`.
- `legacy/app.js` is an unused legacy reference. Do not load it, serve it, or treat it as active frontend source.
- `frontend/src/tests/App.test.tsx` owns React behavior coverage. `backend/tests/test_app.py` owns HTTP integration and repository-layout coverage. `backend/tests/test_refunds.py` and `backend/tests/test_flags.py` own domain contracts.

Keep API adapters aligned with the domain method signatures. Do not duplicate domain rules in the server beyond request shape and transport validation. Use the fixed server-side actor `Demo operator`; do not add login or role claims.

The Python server may serve only built `dist/index.html` at `/` and `/index.html`, plus tightly constrained generated JavaScript and CSS files directly beneath `dist/assets/`. It must reject traversal, symlink escapes, source files, workspace files, configuration, manifests, maps, and the legacy `/app.js` and `/styles.css` routes. Keep mutation requests same-origin, JSON-only, and protected by `X-Demo-Request: 1`. Never add permissive CORS or weaken Origin validation.

## Demonstration boundaries

All refunds, customers, flags, timestamps, owners, and audit events displayed by this POC are synthetic. Refunds are strictly read-only and the interface must not suggest that funds can be executed or retried. Provider timeouts represent an unconfirmed outcome that requires reconciliation before any retry.

Feature flag changes are local simulations. Each server instance creates a fresh `FlagStore`; changes and audit history reset on restart and are never persisted. There is no authentication, production hardening, real payment provider, flag platform, analytics, or other external integration. The production environment is a local synthetic workflow only, not a live connection.
