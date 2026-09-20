# Northstar Operations POC

A local internal-tools demonstration built with React, TypeScript, Vite, and a Python standard-library backend. It contains **two workflows in one application**, not three independent apps or a replacement for Power Apps.

All customer records and operations are synthetic. No money moves, no real feature flags change, and no credentials or external integrations are required.

## What was built

| Workflow | Working behavior | Boundary |
| --- | --- | --- |
| Refunds dashboard | Search 20 seeded refunds, filter by status, view dataset summaries, and inspect payment references and historical timelines. | Read-only. No refund creation, execution, retry, or provider connection. |
| Feature-flag admin | Search six seeded flags per environment, review enabled/rollout changes, provide a reason, inspect audit events, and roll back the latest change for a flag. | In-memory simulation. Development, staging, and production are isolated demo states, not live environments. |
| KYC review queue | Not implemented. | No identity documents, verification, screening, or compliance decisions. |

Flag changes use expected versions to reject stale updates. Changes in the simulated production environment require typing the exact flag key. Rollback creates a new version and audit event rather than deleting history. These are selected safeguards, not production security or compliance guarantees.

## Run locally

Prerequisites: **Python 3.11+**, **Node.js 22.12+**, and npm. No Python packages need to be installed. The initial npm install requires registry access; the running demo does not need external services.

From the repository root:

```sh
npm ci
npm run build
python3 -m backend.app
```

Open **http://127.0.0.1:8000**. Use the sidebar to switch between Refunds and Feature flags. Stop the server with `Ctrl+C`.

For a different port:

```sh
python3 -m backend.app --port 8080
```

Then open **http://127.0.0.1:8080**.

The Python server serves both the built frontend and the API. Do not open `frontend/index.html` directly or run a separate Vite HTTP server. A missing frontend build produces a controlled `503 build_missing` response: run `npm run build` first.

Keep the server bound to `127.0.0.1`. Use its direct URL, not a preview proxy with a different browser Origin; mutation requests from an unexpected Origin are rejected. Do not weaken that check to make a proxy work.

## Repository layout

```text
frontend/
  index.html
  vite.config.ts
  tsconfig.json
  src/
    App.tsx
    main.tsx
    styles.css
    features/
      refunds/RefundsView.tsx
      flags/FlagsView.tsx
    components/SharedDialog.tsx
    lib/
      api.ts
      models.ts
      format.ts
    tests/
      App.test.tsx
      setup.ts
backend/
  __init__.py
  app.py
  refunds.py
  flags.py
  tests/
    __init__.py
    test_app.py
    test_refunds.py
    test_flags.py
legacy/
  app.js
package.json
package-lock.json
README.md
AGENTS.md
```

The separation is by responsibility and workflow, not independently deployed services. Both React views call a shared typed API client; the Python HTTP adapter delegates to the corresponding domain module.

| Area | Start here | Responsibility |
| --- | --- | --- |
| App shell | [frontend/src/App.tsx](frontend/src/App.tsx) | Shared navigation between workflows. |
| Refunds UI | [frontend/src/features/refunds/RefundsView.tsx](frontend/src/features/refunds/RefundsView.tsx) | Read-only search, filtering, summary, and historical detail. |
| Flag UI | [frontend/src/features/flags/FlagsView.tsx](frontend/src/features/flags/FlagsView.tsx) | Change/rollback review and audit history. |
| Shared frontend | [frontend/src/lib/](frontend/src/lib/), [frontend/src/components/](frontend/src/components/) | Typed HTTP calls, API models, formatting, dialogs, and inline states. |
| HTTP server | [backend/app.py](backend/app.py) | API routing, request validation, error mapping, and restricted built-asset serving. |
| Refund domain | [backend/refunds.py](backend/refunds.py) | Synthetic dataset, search/filtering, details, and summary. |
| Flag domain | [backend/flags.py](backend/flags.py) | Environment-isolated state, validation, versions, and audit events. |
| Tests | [frontend/src/tests/](frontend/src/tests/), [backend/tests/](backend/tests/) | React interactions, HTTP integration, domain contracts, and regression coverage. |
| Agent instructions | [AGENTS.md](AGENTS.md) | Development commands, ownership boundaries, and safeguards for coding agents. |

The npm manifest and lockfile stay at the root so all commands run from one directory. Frontend configuration lives in `frontend/`; Vite builds into root-level `dist/`, which the backend serves.

**Legacy file:** `legacy/app.js` is an unused pre-React reference. It is neither loaded nor served. Active frontend work belongs in `frontend/src/`.

Dependencies, generated `dist/`, caches, environment files, and local `.devin/` settings are excluded from Git.

## Data and state

- Refund fixtures live in `_REFUND_DATA` in `backend/refunds.py`. They are fixed historical records with USD amounts stored as integer cents. Summary cards describe the whole dataset, not just filtered results.
- Flag definitions live in `FlagStore._SEEDS` in `backend/flags.py`. Each environment starts with six flags; changes affect only the selected environment.
- There is no data-entry/import screen for creating refunds or flags. Changing the seeded records requires editing those Python fixtures and restarting the server.
- Flag configuration and audit history survive browser refreshes but **reset when the Python server restarts**. Audit history starts empty; seed records are not presented as operator actions.
- All API mutations use the fixed actor `Demo operator`. That label is not an authenticated identity.

## Try the workflows

1. In **Refunds**, search for `ref_0008` and open its details. Its provider timeout has an unconfirmed outcome; the text calls for reconciliation, not a retry. There is no payment-action button.
2. In **Feature flags**, leave the environment on **Staging**. Select **Review change** for a flag, change its rollout percentage, enter a reason, and confirm. Observe the new version and audit entry.
3. Select **Rollback**, enter a reason, and confirm restoration of the prior configuration. Observe that rollback adds another audit entry.
4. Switch to **Production**. Its state is separate, and applying a change requires exact flag-key confirmation. This still changes only local synthetic state.

## Development and verification

For frontend development, run `npm run dev` in one terminal and `python3 -m backend.app` in another. Here, `npm run dev` watches and rebuilds `dist/`; refresh the browser after a rebuild. Restart Python after backend changes.

Run checks from the repository root:

```sh
npm run typecheck
npm test
npm run build
python3 -m unittest discover -s backend/tests -t . -v
```

Frontend tests use Vitest and Testing Library. Backend tests use Python's built-in `unittest`. `npm run test:watch` starts frontend watch mode; `npm audit` checks dependency advisories.

## What this does not establish

There is no authentication, role-based authorization, persistent database, durable audit storage, payment-provider integration, flag-platform integration, deployment pipeline, or production operating model. The loopback server and request safeguards do not make this suitable for production or real customer data.

This baseline was built locally with Devin. Publishing it to GitHub is not evidence of Devin Cloud execution. Cloud execution, production readiness, and performance at scale have not been demonstrated by this repository.
