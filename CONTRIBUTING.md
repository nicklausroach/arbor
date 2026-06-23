# Contributing

Thanks for contributing to Arbor. This guide covers how to clone the repo,
get a local development environment running, and verify your changes.

> **Note:** this repo is an npm workspaces monorepo with `server` and `web`
> packages. An earlier version of this guide described a single Python
> project — that was based on a stripped-down snapshot of the repo and no
> longer matches `main`.

## Prerequisites

- **Node.js** `>=22` and **npm**
- **git**

## Clone and install

```bash
git clone git@github.com:nicklausroach/arbor.git
cd arbor
npm install
```

`npm install` at the repo root installs dependencies for both workspaces
(`server` and `web`).

## Project structure

- `server/` — Express + TypeScript API (planner, scheduler, runner, GitHub
  integration). Run with `tsx`, tested with `vitest`.
- `web/` — React + Vite frontend that talks to the server's API.
- `docs/agents/` — conventions for agents working in this repo (issue
  tracker, triage labels, domain docs).
- `AGENTS.md` — pointers into `docs/agents/`.

## Development

The root `package.json` defines scripts that proxy into each workspace:

```bash
npm run dev:server   # starts the API server (tsx watch, http://localhost:4310)
npm run dev:web      # starts the Vite dev server for the frontend
```

The web dev server proxies `/api` requests to `http://localhost:4310`, so if
you're working on a feature that touches both the UI and the API, run both
dev servers at once in separate terminals:

```bash
# terminal 1
npm run dev:server

# terminal 2
npm run dev:web
```

Then open the URL Vite prints (typically `http://localhost:5173`).

If you only need the API (e.g. for backend-only changes), `npm run dev:server`
on its own is enough — you can exercise it directly with `curl` or any HTTP
client.

## Running tests

Tests use `vitest` and currently only exist for the `server` workspace:

```bash
npm test
```

This runs `vitest run` inside `server`. There is no test suite for `web` yet.

## Verifying your setup

After `npm install`, confirm everything works end-to-end:

1. `npm test` — should report all server tests passing.
2. `npm run dev:server` — should print `arbor server listening on
   http://localhost:4310` with no errors; stop it with `Ctrl+C`.
3. `npm run dev:web` — should print a local Vite URL; open it in a browser
   and confirm the app loads without console errors. Stop it with `Ctrl+C`.

If all three succeed, your environment is set up correctly.

## Working with issues

Issues are tracked in GitHub Issues for `nicklausroach/arbor`. Use the `gh`
CLI from your checkout — see `docs/agents/issue-tracker.md` for conventions.
