# Connect Local GitHub Repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax tracking.

**Goal:** Implement issue #2 with the smallest tested Python stdlib slice.

**Architecture:** One module owns connection behavior and persistence. Tests inject fake GitHub and keychain boundaries; no mocks, no network, no dependency install.

**Tech Stack:** Python 3.12 stdlib, unittest, sqlite3.

## Global Constraints
- Implement issue #2 only.
- Tokens must go through a keychain boundary and never be stored in SQLite.
- Arbor must not clone repos, install hooks, add remotes, or mutate repo config.
- Use TDD: tests fail before implementation.

---

### Task 1: Connection Core

**Files:**
- Create: `arbor/__init__.py`
- Create: `arbor/connect.py`
- Create: `tests/test_connect.py`

**Interfaces:**
- Produces: `connect_repository(path: Path, token: str, db_path: Path, keychain: Keychain, github: GithubApi, remote_name: str | None = None) -> RepositoryRecord`
- Produces: `ensure_clean_for_execution(path: Path) -> None`

- [ ] **Step 1: Write failing tests**
Create tests for remote detection, metadata persistence, keychain-only token storage, clean repo enforcement, and no repo mutation.

- [ ] **Step 2: Run tests and verify failure**
Run: `PYTHONPATH=. python3 -m unittest tests.test_connect -v`
Expected: import failure for missing `arbor.connect`.

- [ ] **Step 3: Implement minimal module**
Implement dataclasses, protocols, subprocess git reads, GitHub URL parsing, SQLite upsert, keychain call, GitHub API boundary call, and clean-tree check.

- [ ] **Step 4: Run tests pass**
Run: `PYTHONPATH=. python3 -m unittest tests.test_connect -v`
Expected: all tests pass.

