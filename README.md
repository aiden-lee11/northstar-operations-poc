# Northstar Operations POC

A local internal-tools demonstration built with React, TypeScript, Vite, and a Python standard-library backend. It contains **two workflows in one application**, not three independent apps or a replacement for Power Apps.

All customer records and operations are synthetic. No money moves, no real feature flags change, and no credentials or external integrations are required.

## What was built

| Workflow | Working behavior | Boundary |
| --- | --- | --- |
| Refunds dashboard | Search 20 seeded refunds, filter by status, view dataset summaries, and inspect payment references and historical timelines. | Read-only. No refund creation, execution, retry, or provider connection. |
| Feature-flag admin | Search six seeded flags per environment, review enabled/rollout changes, provide a reason, inspect audit events, and roll back the latest change for a flag. | In-memory simulation. Development, staging, and production are isolated demo states, not live environments. |
| Customer preview | Evaluate `new_checkout_flow` for eight synthetic accounts against the current flag configuration and render the old or new checkout the backend selects, with the bucket, rollout, and configuration version behind each decision. | Local deterministic evaluation with a synthetic consumer. No configuration distribution to real clients, no customer data, no payment provider, and no money movement. |
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

Open **http://127.0.0.1:8000**. Use the sidebar to switch between Refunds, Feature flags, and Customer preview. Stop the server with `Ctrl+C`.

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
      preview/CustomerPreviewView.tsx
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

The separation is by responsibility and workflow, not independently deployed services. The React views call a shared typed API client; the Python HTTP adapter delegates to the corresponding domain module.

| Area | Start here | Responsibility |
| --- | --- | --- |
| App shell | [frontend/src/App.tsx](frontend/src/App.tsx) | Shared navigation between workflows. |
| Refunds UI | [frontend/src/features/refunds/RefundsView.tsx](frontend/src/features/refunds/RefundsView.tsx) | Read-only search, filtering, summary, and historical detail. |
| Flag UI | [frontend/src/features/flags/FlagsView.tsx](frontend/src/features/flags/FlagsView.tsx) | Change/rollback review and audit history. |
| Customer preview UI | [frontend/src/features/preview/CustomerPreviewView.tsx](frontend/src/features/preview/CustomerPreviewView.tsx) | Renders whichever checkout the backend evaluator selects and explains the decision. |
| Shared frontend | [frontend/src/lib/](frontend/src/lib/), [frontend/src/components/](frontend/src/components/) | Typed HTTP calls, API models, formatting, dialogs, and inline states. |
| HTTP server | [backend/app.py](backend/app.py) | API routing, request validation, error mapping, and restricted built-asset serving. |
| Refund domain | [backend/refunds.py](backend/refunds.py) | Synthetic dataset, search/filtering, details, and summary. |
| Flag domain | [backend/flags.py](backend/flags.py) | Environment-isolated state, validation, versions, audit events, and deterministic evaluation. |
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

## Flag evaluation

`backend/flags.py` evaluates `new_checkout_flow` for a synthetic account directly from `FlagStore`, the single source of configuration. There is no second store and no eligibility logic in React; the preview renders only what the backend returns.

A bucket is the first eight bytes of `sha256("<key>:<environment>:<account_id>")` modulo 10,000, so it is an integer from 0 through 9,999. Nothing else feeds the hash — not the configuration version, rollout percentage, a timestamp, `random()`, or Python's process-randomized `hash()` — so an account keeps its bucket across requests, configuration changes, and server restarts. An account is included when `bucket < rollout_percent * 100`, which is why raising the rollout keeps every previously included account, and why each environment assigns its own buckets.

Each response is one snapshot taken under the store lock, with an explicit reason:

| Reason | Meaning |
| --- | --- |
| `flag_disabled` | The flag is off in that environment; the bucket is not consulted. |
| `rollout_zero` | Enabled at 0%, so no bucket qualifies. |
| `bucket_within_rollout` | The bucket falls inside the rollout window. |
| `bucket_outside_rollout` | The bucket falls outside it. |

`GET /api/flags/<key>/evaluations?environment=<environment>&account=<account_id>` returns the flag snapshot, the synthetic account list, and one evaluation per account with the decision, reason, bucket, threshold, rollout percentage, and configuration version. It is read-only: it never changes a flag and never appends an audit event. The `account` parameter is optional and narrows the response to a single account. Unknown or repeated query parameters, invalid environments, and malformed account IDs are rejected as elsewhere in the API.

## Try the workflows

1. In **Refunds**, search for `ref_0008` and open its details. Its provider timeout has an unconfirmed outcome; the text calls for reconciliation, not a retry. There is no payment-action button.
2. In **Feature flags**, leave the environment on **Staging**. Select **Review change** for a flag, change its rollout percentage, enter a reason, and confirm. Observe the new version and audit entry.
3. Select **Rollback**, enter a reason, and confirm restoration of the prior configuration. Observe that rollback adds another audit entry.
4. Switch to **Production**. Its state is separate, and applying a change requires exact flag-key confirmation. This still changes only local synthetic state.

### Watch an admin change reach the customer

Keep the environment on **Staging** throughout. Every step uses the existing review flow and requires a reason.

1. In **Feature flags**, review `new_checkout_flow` and disable it. In **Customer preview**, every demo account shows the old checkout with the reason `flag_disabled`.
2. Back in **Feature flags**, enable it at **25%**. In the preview, some accounts now show the new express checkout while others keep the old one; select an account to read its bucket against the rollout window.
3. Select **Refresh decisions**, or leave the preview and return to it. Each account keeps its bucket and therefore its experience.
4. Raise the rollout to **100%**. Every demo account shows the new checkout.
5. Select **Rollback** on the flag. The configuration returns to 25% as a new version, and exactly the accounts from step 2 see the new checkout again.
6. The audit panel lists one entry per step, including the rollback.

Eight accounts are far too small a sample for the included share to match the configured percentage. The counts in the preview are computed by the evaluator, not projected from the rollout.

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

There is no authentication, role-based authorization, persistent database, durable audit storage, payment-provider integration, flag-platform integration, deployment pipeline, or production operating model. The evaluator runs inside the same process as the admin panel: it demonstrates local deterministic evaluation for a synthetic consumer, not configuration distribution to real clients, streaming updates, SDK behavior, or proven enterprise scale. The checkout is an illustration — it collects no payment details, calls no provider, and moves no money. The loopback server and request safeguards do not make this suitable for production or real customer data.

This baseline was built locally with Devin. Publishing it to GitHub is not evidence of Devin Cloud execution. Cloud execution, production readiness, and performance at scale have not been demonstrated by this repository.
