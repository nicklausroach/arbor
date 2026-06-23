# Research: project structure and dependencies (for CONTRIBUTING.md)

This document is the research deliverable for issue #15. It exists to inform
the upcoming `CONTRIBUTING.md` work (#16, #17).

## Key finding: the ticket's assumptions do not match this repo

Issues #15-#17 describe a Node.js monorepo with `server`/`web` workspaces,
`vitest`, `npm`, and `package.json`/`tsconfig.json` files. **None of that
exists in this repository, on `main` or any other branch.** There is no
`package.json`, no `tsconfig.json`, no `vitest.config.ts`, no `.nvmrc`, and no
`node_modules`/JS tooling anywhere in git history. This repo has always been a
Python project. The `CONTRIBUTING.md` tickets should be corrected to describe
the actual Python setup documented below rather than the assumed Node.js one.

## Current state of `main`

As of commits `7613624` ("wipe") and `de06085` ("remove other docs"), `main`
has been stripped down to:

```
.gitignore
AGENTS.md
docs/agents/domain.md
docs/agents/issue-tracker.md
docs/agents/triage-labels.md
```

The previous Python source (`arbor/` package, `tests/`, `pyproject.toml`) was
deleted in the wipe and has not been restored on `main`. There is currently no
installable package and no test suite on `main` to document setup steps for.
The most recent working snapshot of the project (still present on the
`tinted-couch` branch) is described below, since it's the best available
picture of what contributors set up before the wipe and what is likely to
return.

## Prerequisite software (pre-wipe snapshot, `tinted-couch` branch)

- **Python**: `>=3.12`, declared in `pyproject.toml` (`requires-python`). No
  `.nvmrc` or Node version applies — this is not a Node project.
- **Package manager**: standard `pip`/`pyproject.toml` (PEP 621), no `npm`,
  `pnpm`, or `yarn` lockfiles present.
- No `package.json` exists anywhere in history.

## Workspace structure

There are no `server`/`web` workspaces. The project is a single Python
package:

- `arbor/` — the package (`__init__.py`, `__main__.py`, `connect.py`,
  `drafting.py`, `repo.py`, `ui.py` on `tinted-couch`).
- `tests/` — pytest test modules (`test_connect.py`, `test_drafting.py`,
  `test_ui.py`).
- CLI entry point defined in `arbor/__main__.py` via `argparse`, with
  subcommands `draft-project` and `serve-draft`.

## Test framework

**pytest**, not vitest. Configuration lives in `pyproject.toml`:

```toml
[tool.pytest.ini_options]
pythonpath = ["."]
```

No `vitest.config.ts` or equivalent exists.

## Environment variables / configuration files

- No `.env`, `.env.example`, or similar files found anywhere in git history.
- No environment variables are referenced in the source on `tinted-couch`.
- `.gitignore` only excludes Python artifacts (`__pycache__/`, `*.py[cod]`,
  `.pytest_cache/`, `*.sqlite`), confirming this is a Python-only project
  (the `*.sqlite` entry suggests a local SQLite file is used for the draft
  store, created at runtime rather than configured via env vars).

## Existing docs to reference

- `AGENTS.md` — agent skill pointers (issue tracker conventions, triage
  labels, domain docs). Relevant for an "agent contributors" section if the
  contributing guide covers AI agents working in this repo.
- `docs/agents/issue-tracker.md` — GitHub Issues conventions and `gh` CLI
  usage; useful for a "how we track work" section.
- `docs/agents/triage-labels.md` — triage label meanings.
- `docs/agents/domain.md` — points to `CONTEXT.md` and `docs/adr/` "when they
  exist"; neither currently exists in this repo.
- No `README.md`, `CONTEXT.md`, or `docs/adr/` exist on `main` to reference.

## Recommendation for #16/#17

Before writing `CONTRIBUTING.md`, either:
1. Confirm whether the Python project (`tinted-couch` snapshot) is being
   restored to `main`, and base the guide on Python/pytest setup, or
2. If a Node.js rewrite is actually planned, treat that as new scope and
   update #16/#17's acceptance criteria accordingly — there is no existing
   Node.js code to document.
