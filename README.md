# Feature flag admin — built with Devin

A small internal tool: an admin panel for feature flags, plus a preview showing which customers actually get the new experience. Built with Devin as part of an assessment on whether a fintech team should build internal tools with Devin instead of Power Apps.

It runs locally with test data. It is a demo, not production software.

## Why this and not KYC

The client has three Power Apps tools: a KYC review queue, a refunds dashboard, and a feature flag panel. The build allowance was about two hours.

I picked feature flags because it's the smallest of the three and you can see the whole thing work end to end: change a setting, watch a customer's screen change, undo it. A KYC queue would have been a screen with nothing behind it — the hard parts are customer documents, access rules, audit trails, and verification providers, none of which fit in two hours.

That choice is the argument: Devin is a good fit for small internal tools like this one. The bigger tools are a real engineering project plus ongoing maintenance, so they're worth keeping where they are until there's a clear reason to move them.

## Run it

Needs Python 3.11+ and Node 22.12+.

```sh
npm ci
npm run build
python3 -m backend.app
```

Open http://127.0.0.1:8000. Use `--port 8080` for a different port.

## Try the demo

Set both views to **Staging**, then use **New checkout flow**:

1. Turn the flag **off** — every test account sees the old checkout.
2. Turn it on at **25%** — Cedar gets the new checkout, Aurora doesn't.
3. Hit **Refresh decisions** — nothing shifts around. Same accounts, same result.
4. Go to **100%** — everyone gets it.
5. **Roll back** — it returns to 25% and the same accounts as step 2 get it again.

Every change needs a reason and shows up in the history. The checkout is fake — the order button is disabled and nothing is charged.

## How it works

React frontend, one Python server. The server holds the flag settings, decides which accounts are in the rollout, and serves the UI. The frontend just displays what the backend decided.

Each account gets a fixed bucket from a hash of the flag key, environment, and account id. An account is in the rollout if its bucket falls under the percentage. Because the percentage isn't part of the hash, going from 25% to 100% only adds accounts, and rolling back gives you the same group as before.

Changes check a version number so two edits can't silently overwrite each other. Rollback writes a new entry rather than deleting the old one.

## What it doesn't do

No login, no database, no real integrations, no deployment setup. State is in memory and resets when you restart the server. It hasn't been connected to or tested against any real external API, and nothing here demonstrates compliance with anything.

## Also in here

- [Slides](presentation/decision-brief.pdf) — the five-minute walkthrough
- [Key decisions](docs/key-decisions.pdf) — one page on scope and tradeoffs
- [The Devin Cloud PR](https://github.com/aiden-lee11/northstar-operations-poc/pull/1) — the evaluator and customer preview

`legacy/refunds/` is an earlier refunds dashboard, kept for reference. It isn't part of the app.

## Tests

```sh
npm test
python3 -m unittest discover -s backend/tests -t . -v
```
