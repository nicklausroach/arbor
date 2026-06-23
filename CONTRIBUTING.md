# Contributing

Thanks for contributing to Arbor. This guide covers how to clone the repo and
get a local development environment running.

> **Note:** this repo is a single Python project, not a Node.js monorepo.
> Earlier drafts of this guide assumed `npm`/`server`+`web` workspaces; that
> doesn't match this codebase. See `docs/contributing-research.md` for the
> audit that corrected this.

## Prerequisites

- **Python** `>=3.12`
- **pip** (bundled with Python)
- **git**

There is no Node.js, npm, or JavaScript tooling in this repo — you only need
the Python toolchain above.

## Clone and install

```bash
git clone git@github.com:nicklausroach/arbor.git
cd arbor
```

This is a single Python package (no workspaces to install separately). If a
`pyproject.toml` is present at the repo root, install it in editable mode:

```bash
pip install -e .
```

If you're working from a checkout where the package has been stripped down
to docs-only (no `pyproject.toml` yet), there's nothing to install until the
package is restored — see `docs/contributing-research.md` for the most
recent known-good snapshot.

## Project structure

- `arbor/` — the Python package (CLI entry point, core modules).
- `tests/` — `pytest` test modules.
- `docs/agents/` — conventions for agents working in this repo (issue
  tracker, triage labels, domain docs).
- `AGENTS.md` — pointers into `docs/agents/`.

There are no `server`/`web` workspaces; everything lives under the single
`arbor/` package.

## Running tests

Tests use `pytest`, configured via `[tool.pytest.ini_options]` in
`pyproject.toml`:

```bash
pytest
```

## Working with issues

Issues are tracked in GitHub Issues for `nicklausroach/arbor`. Use the `gh`
CLI from your checkout — see `docs/agents/issue-tracker.md` for conventions.
