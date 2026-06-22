# Ticket DAG Revision UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Implement plan task-by-task. Steps use checkbox (`- [ ]`) syntax tracking.

**Goal:** Implement issue #4's valid ticket DAG revision loop and tiny local web UI.

**Architecture:** Keep `arbor.drafting` as the source of truth for draft persistence, graph validation, edit operations, merge/split, stable IDs, and immutable valid versions. Add `arbor.ui` as a stdlib HTTP server with one page plus JSON endpoints. Add `serve-draft` to `arbor.__main__`.

**Tech Stack:** Python 3.12, stdlib `sqlite3`, `http.server`, `json`, `urllib`; pytest.

## Global Constraints
- No new dependencies.
- Direct edits and LLM revisions must validate before version creation.
- Invalid graph states must not mutate the latest valid draft.
- Keep implementation boring and small.

---

### Task 1: Graph revision engine

**Files:**
- Modify: `arbor/drafting.py`
- Test: `tests/test_drafting.py`

**Interfaces:**
- Add `GraphRevisionError(ValueError)`.
- Add `GraphNode`, `GraphEdge`, `TicketGraph`, `RevisionResult` dataclasses.
- Add `DraftStore.latest_version(project_id: int) -> DraftVersion`.
- Add `DraftStore.save_revision(project_id: int, draft: ProjectDraft, raw_output: str = "direct edit") -> DraftVersion`.
- Add `DraftStore.apply_edit(project_id: int, operation: str, payload: dict[str, Any]) -> DraftVersion`.
- Add `DraftStore.apply_llm_revision(project_id: int, raw_output: str) -> RevisionResult`.
- Add `render_ticket_graph(draft: ProjectDraft) -> TicketGraph`.

- [ ] **Step 1: Write failing graph tests**
  - Test cycles, missing dependencies, orphan root clusters.
  - Test valid version creation increments only for valid drafts.
  - Test merge creates new ID, preserves external dependencies/dependents, dedupes criteria, removes self-edges.
  - Test split inherits dependencies, moves dependents to last piece, supports internal ordering.
  - Test invalid LLM output returns previous draft and no new version.

- [ ] **Step 2: Run red tests**
  - Run: `pytest tests/test_drafting.py -q`
  - Expected: failures for missing new API.

- [ ] **Step 3: Implement minimal graph engine**
  - Extend validation in `_validate_dependencies`.
  - Add edit helpers in `DraftStore`.
  - Keep merge/split deterministic and dependency-preserving.
  - Keep stable ID behavior for simple title edits.

- [ ] **Step 4: Run green tests**
  - Run: `pytest tests/test_drafting.py -q`
  - Expected: pass.

---

### Task 2: Tiny web UI

**Files:**
- Create: `arbor/ui.py`
- Modify: `arbor/__main__.py`
- Test: `tests/test_ui.py`

**Interfaces:**
- Add `make_handler(db_path: Path, project_id: int) -> type[BaseHTTPRequestHandler]`.
- Add `serve(db_path: Path, project_id: int, host: str = "127.0.0.1", port: int = 8765) -> None`.
- CLI: `python -m arbor serve-draft --db DB --project-id ID [--host HOST] [--port PORT]`.

- [ ] **Step 1: Write failing UI tests**
  - Start `HTTPServer(("127.0.0.1", 0), make_handler(...))` in a thread.
  - `GET /api/graph` returns latest graph JSON with nodes and edges.
  - `POST /api/edit` applies a rename and creates a new version.
  - Invalid dependency edit returns HTTP 400 and version count remains unchanged.

- [ ] **Step 2: Run red tests**
  - Run: `pytest tests/test_ui.py -q`
  - Expected: failure because `arbor.ui` does not exist.

- [ ] **Step 3: Implement stdlib server**
  - Serve inline HTML on `/`.
  - Serve graph JSON on `/api/graph`.
  - Apply edit JSON on `/api/edit`.
  - Return JSON errors with `400` for invalid edits.

- [ ] **Step 4: Wire CLI**
  - Add `serve-draft` subcommand in `arbor.__main__`.

- [ ] **Step 5: Run green tests**
  - Run: `pytest tests/test_ui.py tests/test_drafting.py -q`
  - Expected: pass.

---

### Task 3: Final verification and PR

**Files:**
- All modified files.

- [ ] **Step 1: Run full test suite**
  - Run: `pytest -q`
  - Expected: all tests pass.

- [ ] **Step 2: Request code review**
  - Dispatch reviewer with issue #4 acceptance criteria and changed files.
  - Fix Critical/Important findings.

- [ ] **Step 3: Create pull request**
  - Push branch.
  - Run: `gh pr create --fill --body ...`.
