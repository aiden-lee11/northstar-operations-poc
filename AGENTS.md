# Northstar feature-flag reference

The only active showcase is feature-flag administration plus its synthetic customer preview. This is a standalone reference implementation, not a completed Power Apps add-on or a production flag platform. Preserve the existing visual design and evaluation/payment boundaries; do not expand scope or add dependencies/integrations.

## Commands

Run these commands from the repository root. The npm manifest and lockfile remain at the root; frontend configuration lives in `frontend/`.

- Install pinned frontend dependencies: `npm ci`
- Build the frontend: `npm run build`
- Run the built local demo: `python3 -m backend.app`
- Run on another local port: `python3 -m backend.app --port 8080`
- Type-check the frontend: `npm run typecheck`
- Run frontend tests once: `npm test`
- Run frontend tests in watch mode: `npm run test:watch`
- Run presentation control tests: `npm run test:slides`
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
- `backend/flags.py` owns environment-isolated in-memory flag state, validation, optimistic concurrency, rollback, audit events, and deterministic evaluation.
- `frontend/src/App.tsx` owns the two-view shell with flags as the default; `frontend/src/features/flags/FlagsView.tsx` owns administration; `frontend/src/features/preview/CustomerPreviewView.tsx` owns the synthetic flag consumer and renders only the decisions `backend/flags.py` returns. `frontend/src/components/SharedDialog.tsx` owns shared dialog and inline-state presentation.
- `frontend/src/lib/api.ts` and `frontend/src/lib/models.ts` own the typed same-origin API client and frontend API models. `frontend/src/lib/format.ts` owns shared formatting.
- `frontend/index.html` is the Vite entry document. `frontend/src/main.tsx` imports the shared presentation source, `frontend/src/styles.css`. Build and type-check configuration live in `frontend/vite.config.ts` and `frontend/tsconfig.json`.
- `legacy/refunds/` is an inactive historical archive of the former refund domain, view, obsolete tests, and shared-source snapshots, including the earlier `app.js`. Do not import, load, serve, or include it in Vite, TypeScript, or active test discovery. Do not restore its API routes. Preserve historical blocked-path regression tests even when source moves.
- `presentation/index.html`, `presentation/slides.css`, and `presentation/slides.js` provide a standalone, file-openable five-slide deck. `presentation/deck.test.mjs` tests its controls using the existing jsdom dependency. The Python server must not expose this source directory. Use the deck's Notes panel to change its demo link port instead of changing backend Origin checks.
- `docs/key-decisions.html` and `docs/key-decisions.pdf` are file-openable decision deliverables, not HTTP routes.
- `frontend/src/tests/App.test.tsx` owns React behavior coverage, including the default/two-view navigation, stale-response handling, and existing visual regression assertions. `backend/tests/test_app.py` owns HTTP integration, repository layout, and blocked historical/archive/document routes. `backend/tests/test_flags.py` owns domain, evaluator, and concurrency contracts.

Keep API adapters aligned with the domain method signatures. Do not duplicate domain rules in the server beyond request shape and transport validation. Use the fixed server-side actor `Demo operator`; do not add login or role claims.

The Python server may serve only built `dist/index.html` at `/` and `/index.html`, plus tightly constrained generated JavaScript and CSS files directly beneath `dist/assets/`. It must reject traversal, symlink escapes, source files, workspace files, configuration, manifests, maps, and the legacy `/app.js` and `/styles.css` routes. Keep mutation requests same-origin, JSON-only, and protected by `X-Demo-Request: 1`. Never add permissive CORS or weaken Origin validation.

## Demonstration boundaries

All customers, flags, timestamps, owners, and audit events displayed by this reference are synthetic. Checkout is an illustration: order buttons stay disabled, no payment details are collected, no provider is called, and no money moves.

Do not change evaluator semantics: `new_checkout_flow` uses the first eight bytes of SHA256(`key:environment:account_id`), interpreted big-endian, modulo 10,000. Assignment does not include rollout, version, time, or randomness. The backend decides; React renders. Preserve defensive snapshots under the store lock, environment isolation, required reason/expected_version, exact-key confirmation for production simulation, and rollback as a new version/history event. Staging Cedar bucket 1543 is included at 25%; Aurora bucket 9289 is excluded.

Feature flag changes are local simulations. Each server instance creates a fresh `FlagStore`; changes and audit history reset on restart and are never persisted. There is no authentication, production hardening, real payment provider, flag platform, analytics, or other external integration. The production environment is a local synthetic workflow only, not a live connection.
